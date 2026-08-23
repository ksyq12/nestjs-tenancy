import type { TenantContextDiagnostics } from '../diagnostics/tenant-context-diagnostics';
import { TenancyContext } from '../services/tenancy-context';

export interface TenantSearchScope {
  tenantId: string;
  index: string;
}

/** Vendor-neutral search contract. Adapters must apply both scope fields. */
export interface TenantSearchAdapter<TQuery, TResult> {
  search(scope: TenantSearchScope, query: TQuery): Promise<TResult>;
}

export interface TenantSearchOptions {
  /** Logical or physical index name. */
  index: string;
  /** Opt-in missing-context diagnostics. */
  diagnostics?: TenantContextDiagnostics;
}

/**
 * Resolves tenant scope before invoking a vendor-specific search adapter.
 * The adapter is never called without a tenant. `ignore` and `warn` return
 * `null`; `throw` raises `TenantContextMissingError`.
 */
export class TenantSearch<TQuery, TResult> {
  constructor(
    private readonly context: TenancyContext,
    private readonly adapter: TenantSearchAdapter<TQuery, TResult>,
    private readonly options: TenantSearchOptions,
  ) {}

  async search(query: TQuery): Promise<TResult | null> {
    const tenantId = this.context.getTenantId();
    if (!tenantId) {
      this.options.diagnostics?.report({
        transport: 'search',
        operation: 'search',
        resource: this.options.index,
      });
      return null;
    }

    return this.adapter.search(
      { tenantId, index: this.options.index },
      query,
    );
  }
}
