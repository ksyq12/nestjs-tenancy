import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, Subscription } from 'rxjs';
import { TenancyContext } from '../services/tenancy-context';
import { DEFAULT_PROPAGATION_HEADER } from '../tenancy.constants';

export interface TenantContextInterceptorOptions {
  /** Kafka message header name. Defaults to 'X-Tenant-Id'. */
  kafkaHeaderName?: string;
  /** Bull job data key. Defaults to '__tenantId'. */
  bullDataKey?: string;
  /** gRPC metadata key. Defaults to 'x-tenant-id'. */
  grpcMetadataKey?: string;
  /**
   * Explicitly specify the transport type instead of using duck-typing detection.
   * Recommended to avoid false positives from ambiguous RPC context shapes.
   */
  transport?: 'kafka' | 'bull' | 'grpc';
}

const DEFAULT_BULL_DATA_KEY = '__tenantId';
const DEFAULT_GRPC_METADATA_KEY = 'x-tenant-id';

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
  private readonly transport?: 'kafka' | 'bull' | 'grpc';

  constructor(
    private readonly context: TenancyContext,
    options?: TenantContextInterceptorOptions,
  ) {
    this.kafkaHeaderName = options?.kafkaHeaderName ?? DEFAULT_PROPAGATION_HEADER;
    this.bullDataKey = options?.bullDataKey ?? DEFAULT_BULL_DATA_KEY;
    this.grpcMetadataKey = options?.grpcMetadataKey ?? DEFAULT_GRPC_METADATA_KEY;
    this.transport = options?.transport;
  }

  intercept(executionContext: ExecutionContext, next: CallHandler): Observable<unknown> {
    const tenantId = this.extractTenantId(executionContext);

    if (!tenantId) {
      return next.handle();
    }

    return new Observable((subscriber) => {
      let innerSub: Subscription;
      try {
        this.context.run(tenantId, () => {
          innerSub = next.handle().subscribe(subscriber);
        });
      } catch (err) {
        subscriber.error(err);
      }
      return () => innerSub?.unsubscribe();
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

    // gRPC: context has get()/set() methods (Metadata-like)
    if (typeof ctx?.get === 'function' && typeof ctx?.set === 'function') {
      return this.extractFromGrpcMetadata(ctx);
    }

    // Bull: tenant ID key must actually exist in the job data
    if (data && typeof data === 'object' && this.bullDataKey in (data as Record<string, unknown>)) {
      return this.extractFromBullData(data as Record<string, unknown>);
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

  private extractFromGrpcMetadata(metadata: { get(key: string): (string | Buffer)[] }): string | null {
    const values = metadata.get(this.grpcMetadataKey);
    if (!values || values.length === 0) return null;
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
