// Use the global symbol registry so tokens remain equal if the package is loaded twice.
export const TENANCY_MODULE_OPTIONS = Symbol.for(
  '@nestarc/tenancy/TENANCY_MODULE_OPTIONS',
);
export const BYPASS_TENANCY_KEY = Symbol.for(
  '@nestarc/tenancy/BYPASS_TENANCY_KEY',
);
export const DEFAULT_DB_SETTING_KEY = 'app.current_tenant';
/**
 * Broad UUID-like validation used by the default tenant validator.
 *
 * This intentionally accepts any dashed 32-hex identifier, including UUID v7.
 * Consumers that need strict RFC version/variant checks can override
 * `validateTenantId`.
 */
export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Each transport uses its native casing convention.
export const DEFAULT_PROPAGATION_HEADER = 'X-Tenant-Id';
export const DEFAULT_BULL_DATA_KEY = '__tenantId';
export const DEFAULT_GRPC_METADATA_KEY = 'x-tenant-id';
