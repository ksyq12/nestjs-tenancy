import type { TenantContextDiagnostics } from '../diagnostics/tenant-context-diagnostics';

export interface TenantCacheInterceptorOptions {
  /** Prefix for tenant-scoped cache entries. @default 'tenant' */
  tenantPrefix?: string;
  /** Prefix for intentionally shared cache entries. @default 'shared' */
  sharedPrefix?: string;
  /** Separator used between key parts. @default ':' */
  separator?: string;
  /** Hash tenant IDs before placing them in cache keys. @default false */
  hashTenantId?: boolean;
  /** Override the diagnostics service used for missing tenant context. */
  diagnostics?: TenantContextDiagnostics;
  /** Stable cache name included in diagnostics. */
  resource?: string;
}
