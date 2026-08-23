import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, Subscription } from 'rxjs';
import { TenancyContext } from '../services/tenancy-context';
import { DEFAULT_PROPAGATION_HEADER, DEFAULT_BULL_DATA_KEY, DEFAULT_GRPC_METADATA_KEY } from '../tenancy.constants';
import type { TenantContextDiagnostics } from '../diagnostics/tenant-context-diagnostics';

type RpcTransport = 'kafka' | 'bull' | 'grpc';

interface TenantContextInterceptorDiagnosticOptions {
  diagnostics?: TenantContextDiagnostics;
  /** Stable topic, queue, service, or handler name included in diagnostics. */
  resource?: string;
}

/**
 * Options for `TenantContextInterceptor`.
 *
 * When `transport` is specified, only the matching transport key is accepted.
 * When `transport` is omitted, all keys are available for duck-typing fallback.
 */
export type TenantContextInterceptorOptions =
  TenantContextInterceptorDiagnosticOptions & (
  | { transport: 'kafka'; kafkaHeaderName?: string }
  | { transport: 'bull'; bullDataKey?: string }
  | { transport: 'grpc'; grpcMetadataKey?: string }
  | { transport?: undefined; kafkaHeaderName?: string; bullDataKey?: string; grpcMetadataKey?: string }
  );

/**
 * NestJS interceptor that restores tenant context from incoming microservice messages.
 *
 * Designed for **RPC transports only** (Kafka, Bull, gRPC). HTTP requests are
 * skipped because `TenantMiddleware` + `TenancyGuard` already handle HTTP
 * tenant extraction as part of `TenancyModule`.
 *
 * Wraps the handler execution inside `TenancyContext.run()`, ensuring
 * that all downstream code (services, Prisma extension, etc.) has access
 * to the tenant context through AsyncLocalStorage.
 *
 * For best results, set the `transport` option explicitly to avoid duck-typing
 * ambiguity when multiple RPC transports share similar context shapes.
 *
 * @example
 * ```typescript
 * // Global interceptor for Kafka consumers
 * app.useGlobalInterceptors(
 *   new TenantContextInterceptor(new TenancyContext(), { transport: 'kafka' }),
 * );
 *
 * // Bull processor with explicit transport
 * @UseInterceptors(new TenantContextInterceptor(new TenancyContext(), { transport: 'bull' }))
 * @Controller()
 * export class OrderProcessor { ... }
 * ```
 */
@Injectable()
export class TenantContextInterceptor implements NestInterceptor {
  private readonly kafkaHeaderName: string;
  private readonly bullDataKey: string;
  private readonly grpcMetadataKey: string;
  private readonly transport?: RpcTransport;
  private readonly diagnostics?: TenantContextDiagnostics;
  private readonly resource?: string;

  constructor(
    private readonly context: TenancyContext,
    options?: TenantContextInterceptorOptions,
  ) {
    // Cast to access all fields uniformly — the union constrains callers,
    // but internally we read every key with defaults.
    const opts = (options ?? {}) as {
      kafkaHeaderName?: string; bullDataKey?: string;
      grpcMetadataKey?: string; transport?: RpcTransport;
      diagnostics?: TenantContextDiagnostics; resource?: string;
    };
    this.kafkaHeaderName = opts.kafkaHeaderName ?? DEFAULT_PROPAGATION_HEADER;
    this.bullDataKey = opts.bullDataKey ?? DEFAULT_BULL_DATA_KEY;
    this.grpcMetadataKey = opts.grpcMetadataKey ?? DEFAULT_GRPC_METADATA_KEY;
    this.transport = opts.transport;
    this.diagnostics = opts.diagnostics;
    this.resource = opts.resource;
  }

  intercept(executionContext: ExecutionContext, next: CallHandler): Observable<unknown> {
    const tenantId = this.extractTenantId(executionContext);

    if (!tenantId) {
      const transport = executionContext.getType() === 'rpc'
        ? this.transport ?? this.detectTransport(executionContext)
        : null;
      if (transport) {
        this.diagnostics?.report({
          transport,
          operation: 'consume',
          ...(this.resource ? { resource: this.resource } : {}),
        });
      }
      return next.handle();
    }

    return new Observable((subscriber) => {
      let sub: Subscription | undefined;
      try {
        this.context.run(tenantId, () => {
          sub = next.handle().subscribe(subscriber);
        });
      } catch (err) {
        subscriber.error(err);
      }
      return () => sub?.unsubscribe();
    });
  }

  private extractTenantId(executionContext: ExecutionContext): string | null {
    const type = executionContext.getType();

    // HTTP is handled by TenantMiddleware + TenancyGuard — skip here.
    if (type === 'http') {
      return null;
    }

    if (type === 'rpc') {
      return this.extractFromRpc(executionContext);
    }

    return null;
  }

  private extractFromRpc(executionContext: ExecutionContext): string | null {
    const rpcContext = executionContext.switchToRpc();
    const data = rpcContext.getData();
    const ctx = rpcContext.getContext();

    // Explicit transport mode — no duck-typing needed
    if (this.transport) {
      switch (this.transport) {
        case 'kafka':
          return this.extractFromKafkaContext(ctx);
        case 'grpc':
          return this.extractFromGrpcMetadata(ctx);
        case 'bull':
          return data && typeof data === 'object'
            ? this.extractFromBullData(data as Record<string, unknown>)
            : null;
      }
    }

    // Fallback: duck-typing detection
    // Kafka: context has getMessage() returning { headers: ... }
    if (typeof ctx?.getMessage === 'function') {
      return this.extractFromKafkaContext(ctx);
    }

    // gRPC: context has get()/set() methods; extraction validates array values.
    if (typeof ctx?.get === 'function' && typeof ctx?.set === 'function') {
      return this.extractFromGrpcMetadata(ctx);
    }

    // Bull: tenant ID key must actually exist in the job data
    if (data && typeof data === 'object' && this.bullDataKey in (data as Record<string, unknown>)) {
      return this.extractFromBullData(data as Record<string, unknown>);
    }

    return null;
  }

  private detectTransport(executionContext: ExecutionContext): RpcTransport | null {
    if (executionContext.getType() !== 'rpc') return null;

    const rpcContext = executionContext.switchToRpc();
    const data = rpcContext.getData();
    const ctx = rpcContext.getContext();

    if (typeof ctx?.getMessage === 'function') return 'kafka';
    if (typeof ctx?.get === 'function' && typeof ctx?.set === 'function') {
      return 'grpc';
    }
    if (
      data &&
      typeof data === 'object' &&
      this.bullDataKey in (data as Record<string, unknown>)
    ) {
      return 'bull';
    }
    return null;
  }

  private extractFromKafkaContext(ctx: { getMessage(): { headers?: Record<string, unknown> } }): string | null {
    const message = ctx.getMessage();
    const value = message?.headers?.[this.kafkaHeaderName];
    if (typeof value === 'string' && value.length > 0) return value;
    if (Buffer.isBuffer(value)) {
      const decoded = value.toString('utf-8');
      return decoded.length > 0 ? decoded : null;
    }
    return null;
  }

  private extractFromGrpcMetadata(metadata: { get(key: string): unknown }): string | null {
    const values = metadata.get(this.grpcMetadataKey);
    if (!Array.isArray(values) || values.length === 0) return null;
    const first = values[0];
    if (typeof first === 'string' && first.length > 0) return first;
    if (Buffer.isBuffer(first)) {
      const decoded = first.toString('utf-8');
      return decoded.length > 0 ? decoded : null;
    }
    return null;
  }

  private extractFromBullData(data: Record<string, unknown>): string | null {
    const value = data[this.bullDataKey];
    return typeof value === 'string' && value.length > 0 ? value : null;
  }
}
