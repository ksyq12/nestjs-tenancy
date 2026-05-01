import { TenancyContext } from '../services/tenancy-context';

/**
 * Runs a callback within a tenant context, handling async/await properly.
 *
 * Simplifies the common test pattern:
 * ```typescript
 * // Before (verbose)
 * await new Promise<void>((resolve) => {
 *   context.run('tenant-1', async () => {
 *     const result = await service.findAll();
 *     expect(result).toHaveLength(3);
 *     resolve();
 *   });
 * });
 *
 * // After (with helper)
 * const result = await withTenant('tenant-1', () => service.findAll());
 * expect(result).toHaveLength(3);
 * ```
 *
 * @param tenantId - The tenant ID to set in context
 * @param callback - The async function to execute within the tenant context
 * @param context - Optional TenancyContext instance (uses a new instance by default; works because AsyncLocalStorage is static)
 */
export async function withTenant<T>(
  tenantId: string,
  callback: () => T | Promise<T>,
  context?: TenancyContext,
): Promise<T> {
  const ctx = context ?? new TenancyContext();
  return ctx.run(tenantId, callback);
}
