import { TenancyContext } from '../services/tenancy-context';
import { TenantContextCarrier } from '../interfaces/tenant-context-carrier.interface';
import { DEFAULT_BULL_DATA_KEY } from '../tenancy.constants';
import type { TenantContextDiagnostics } from '../diagnostics/tenant-context-diagnostics';

export interface BullPropagationOptions {
  /** Key name used to store tenant ID in job data. Defaults to '__tenantId'. */
  dataKey?: string;
  /** Opt-in missing-context diagnostics. */
  diagnostics?: TenantContextDiagnostics;
  /** Stable queue or job-family name included in diagnostics. */
  resource?: string;
}

/**
 * Bull/BullMQ tenant propagator.
 *
 * Injects the current tenant ID into job data on the producer side,
 * and extracts it on the consumer side. Uses a configurable key
 * (default: `__tenantId`) to avoid collisions with application data.
 *
 * No runtime dependency on `bullmq` — uses plain object types.
 *
 * @example
 * ```typescript
 * const propagator = new BullTenantPropagator(new TenancyContext());
 *
 * // Producer: inject tenant into job data
 * await queue.add('process', propagator.inject({ orderId: '123' }));
 *
 * // Consumer: extract tenant from job data
 * const tenantId = propagator.extract(job.data);
 * ```
 */
export class BullTenantPropagator
  implements TenantContextCarrier<Record<string, unknown>>
{
  private readonly dataKey: string;
  private readonly diagnostics?: TenantContextDiagnostics;
  private readonly resource?: string;

  constructor(
    private readonly context: TenancyContext,
    options?: BullPropagationOptions,
  ) {
    this.dataKey = options?.dataKey ?? DEFAULT_BULL_DATA_KEY;
    this.diagnostics = options?.diagnostics;
    this.resource = options?.resource;
  }

  inject(jobData: Record<string, unknown>): Record<string, unknown> {
    const tenantId = this.context.getTenantId();
    if (!tenantId) {
      this.diagnostics?.report({
        transport: 'bull',
        operation: 'inject',
        ...(this.resource ? { resource: this.resource } : {}),
      });
      return jobData;
    }
    if (this.dataKey in jobData && jobData[this.dataKey] !== tenantId) {
      throw new Error(
        `[BullTenantPropagator] Job data already contains "${this.dataKey}" with a different tenant ID`,
      );
    }
    return { ...jobData, [this.dataKey]: tenantId };
  }

  extract(jobData: Record<string, unknown>): string | null {
    const value = jobData[this.dataKey];
    if (typeof value === 'string' && value.length > 0) return value;
    this.diagnostics?.report({
      transport: 'bull',
      operation: 'extract',
      ...(this.resource ? { resource: this.resource } : {}),
    });
    return null;
  }
}
