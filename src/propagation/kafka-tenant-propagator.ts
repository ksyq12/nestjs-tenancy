import { TenancyContext } from '../services/tenancy-context';
import { TenantPropagator } from '../interfaces/tenant-propagator.interface';
import { TenantContextCarrier } from '../interfaces/tenant-context-carrier.interface';
import { DEFAULT_PROPAGATION_HEADER } from '../tenancy.constants';
import type { TenantContextDiagnostics } from '../diagnostics/tenant-context-diagnostics';

export interface KafkaPropagationOptions {
  /** Header name for tenant ID in Kafka message headers. Defaults to 'X-Tenant-Id'. */
  headerName?: string;
  /** Opt-in missing-context diagnostics. */
  diagnostics?: TenantContextDiagnostics;
  /** Stable topic name included in diagnostics. */
  resource?: string;
}

/** Structural type for Kafka message — no dependency on kafkajs. */
export interface KafkaMessageLike {
  headers?: Record<string, string | Buffer | undefined>;
  [key: string]: unknown;
}

/**
 * Kafka tenant propagator.
 *
 * Implements both `TenantContextCarrier<KafkaMessageLike>` (for inject/extract)
 * and `TenantPropagator` (for getHeaders compatibility).
 *
 * Handles Kafka headers that may be `string` or `Buffer` on extraction.
 * No runtime dependency on `kafkajs` — uses structural types.
 *
 * @example
 * ```typescript
 * const propagator = new KafkaTenantPropagator(new TenancyContext());
 *
 * // Producer: inject tenant into message
 * await producer.send({
 *   topic: 'orders',
 *   messages: [propagator.inject({ value: JSON.stringify(payload) })],
 * });
 *
 * // Consumer: extract tenant from message
 * const tenantId = propagator.extract(message);
 * ```
 */
export class KafkaTenantPropagator
  implements TenantContextCarrier<KafkaMessageLike>, TenantPropagator
{
  private readonly headerName: string;
  private readonly diagnostics?: TenantContextDiagnostics;
  private readonly resource?: string;

  constructor(
    private readonly context: TenancyContext,
    options?: KafkaPropagationOptions,
  ) {
    this.headerName = options?.headerName ?? DEFAULT_PROPAGATION_HEADER;
    this.diagnostics = options?.diagnostics;
    this.resource = options?.resource;
  }

  inject(message: KafkaMessageLike): KafkaMessageLike {
    const tenantId = this.context.getTenantId();
    if (!tenantId) {
      this.reportMissing('inject');
      return message;
    }
    return {
      ...message,
      headers: { ...message.headers, [this.headerName]: tenantId },
    };
  }

  extract(message: KafkaMessageLike): string | null {
    const value = message.headers?.[this.headerName];
    if (typeof value === 'string' && value.length > 0) return value;
    if (Buffer.isBuffer(value)) {
      const decoded = value.toString('utf-8');
      if (decoded.length > 0) return decoded;
    }
    this.reportMissing('extract');
    return null;
  }

  getHeaders(): Record<string, string> {
    const tenantId = this.context.getTenantId();
    if (!tenantId) {
      this.reportMissing('inject');
      return {};
    }
    return { [this.headerName]: tenantId };
  }

  private reportMissing(operation: 'inject' | 'extract'): void {
    this.diagnostics?.report({
      transport: 'kafka',
      operation,
      ...(this.resource ? { resource: this.resource } : {}),
    });
  }
}
