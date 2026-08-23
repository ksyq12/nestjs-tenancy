import type { TenantContextDiagnostics } from '../diagnostics/tenant-context-diagnostics';
import { TenancyContext } from '../services/tenancy-context';

export interface TenantResourceKeyOptions {
  /** Resource kind used in diagnostics. */
  transport: 'redis' | 'search';
  /** Stable cache, index, or resource name included in diagnostics. */
  resource?: string;
  /** Prefix for generated keys. @default 'tenant' */
  prefix?: string;
  /** Separator between encoded key parts. @default ':' */
  separator?: string;
  /** Opt-in missing-context diagnostics. */
  diagnostics?: TenantContextDiagnostics;
}

/** Creates collision-safe tenant-scoped identifiers for Redis and search resources. */
export class TenantResourceKey {
  private readonly prefix: string;
  private readonly separator: string;

  constructor(
    private readonly context: TenancyContext,
    private readonly options: TenantResourceKeyOptions,
  ) {
    this.prefix = options.prefix ?? 'tenant';
    this.separator = options.separator ?? ':';
  }

  create(key: string): string | null {
    const tenantId = this.context.getTenantId();
    if (!tenantId) {
      this.options.diagnostics?.report({
        transport: this.options.transport,
        operation: 'key',
        ...(this.options.resource ? { resource: this.options.resource } : {}),
      });
      return null;
    }

    return [
      this.prefix,
      `${tenantId.length}${this.separator}${tenantId}`,
      key,
    ].join(this.separator);
  }
}
