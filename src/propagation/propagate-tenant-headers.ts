import { TenancyContext } from '../services/tenancy-context';
import { DEFAULT_PROPAGATION_HEADER } from '../tenancy.constants';

/**
 * Returns HTTP headers containing the current tenant ID for service-to-service propagation.
 *
 * Works with any HTTP client (fetch, axios, got, undici, node:http) — no dependencies required.
 * Returns an empty object when no tenant context is available.
 *
 * Uses the static `AsyncLocalStorage` from `TenancyContext`, so it works anywhere in
 * the call stack without dependency injection.
 *
 * @param headerName - Header name for tenant ID (default: 'X-Tenant-Id')
 * @returns Object with tenant header, or empty object if no tenant context
 *
 * @example
 * ```typescript
 * // With fetch
 * const res = await fetch('/api/orders', {
 *   headers: { ...propagateTenantHeaders() },
 * });
 *
 * // With axios
 * const res = await axios.get('/api/orders', {
 *   headers: propagateTenantHeaders(),
 * });
 *
 * // With @nestjs/axios HttpService
 * this.httpService.get('/api/orders', {
 *   headers: propagateTenantHeaders(),
 * });
 * ```
 */
const _ctx = new TenancyContext();

export function propagateTenantHeaders(
  headerName: string = DEFAULT_PROPAGATION_HEADER,
): Record<string, string> {
  const tenantId = _ctx.getTenantId();
  if (!tenantId) return {};
  return { [headerName]: tenantId };
}
