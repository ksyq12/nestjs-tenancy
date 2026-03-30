import { withTenant } from './with-tenant';

export interface IsolationTestOptions {
  /** The field name that holds the tenant ID. @default 'tenant_id' */
  tenantIdField?: string;
}

/**
 * Asserts that a Prisma model enforces tenant isolation between two tenants.
 *
 * Executes `findMany()` concurrently as both tenants and verifies that
 * no rows from tenant A appear in tenant B's results, and vice versa.
 *
 * Usage in E2E tests:
 * ```typescript
 * await expectTenantIsolation(prisma.user, 'tenant-a-uuid', 'tenant-b-uuid');
 * ```
 *
 * @param prismaModel - A Prisma model delegate with a `findMany` method
 * @param tenantA - First tenant ID
 * @param tenantB - Second tenant ID
 * @param options - Optional configuration
 * @throws Error if tenant isolation is violated
 */
export async function expectTenantIsolation(
  prismaModel: { findMany: (args?: any) => Promise<any[]> },
  tenantA: string,
  tenantB: string,
  options?: IsolationTestOptions,
): Promise<void> {
  const field = options?.tenantIdField ?? 'tenant_id';

  const [rowsA, rowsB] = await Promise.all([
    withTenant(tenantA, () => prismaModel.findMany()),
    withTenant(tenantB, () => prismaModel.findMany()),
  ]);

  // Verify all rows belong to the querying tenant (catches third-party leaks too)
  const foreignInA = rowsA.filter((r: any) => r[field] !== tenantA);
  const foreignInB = rowsB.filter((r: any) => r[field] !== tenantB);

  if (foreignInA.length > 0) {
    const foreignIds = [...new Set(foreignInA.map((r: any) => r[field]))];
    throw new Error(
      `Tenant isolation violation: tenant ${tenantA} query returned ` +
      `${foreignInA.length} row(s) belonging to other tenant(s): ${foreignIds.join(', ')}`,
    );
  }
  if (foreignInB.length > 0) {
    const foreignIds = [...new Set(foreignInB.map((r: any) => r[field]))];
    throw new Error(
      `Tenant isolation violation: tenant ${tenantB} query returned ` +
      `${foreignInB.length} row(s) belonging to other tenant(s): ${foreignIds.join(', ')}`,
    );
  }
}
