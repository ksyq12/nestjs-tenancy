import { Prisma } from '@prisma/client';
import { TenancyService } from '../services/tenancy.service';
import { DEFAULT_DB_SETTING_KEY } from '../tenancy.constants';

export interface PrismaTenancyExtensionOptions {
  dbSettingKey?: string;
  autoInjectTenantId?: boolean;
  tenantIdField?: string;
  sharedModels?: string[];
}

/**
 * Creates a Prisma Client Extension that sets the PostgreSQL RLS context
 * before every model query when a tenant context exists.
 *
 * Uses `Prisma.defineExtension` to access the base client via closure,
 * then wraps each query in a batch transaction:
 *   1. `SELECT set_config(key, tenantId, TRUE)` — sets the RLS variable (transaction-local)
 *   2. `query(args)` — the original query, now filtered by RLS
 *
 * SECURITY: Uses `$executeRaw` tagged template with bind parameters.
 * `set_config()` accepts parameterized values, unlike `SET LOCAL` which
 * requires string interpolation. This eliminates SQL injection risk entirely.
 *
 * Options:
 * - `dbSettingKey`: PostgreSQL session variable name (default: app.tenant_id)
 * - `autoInjectTenantId`: Automatically inject tenant ID into write operations
 * - `tenantIdField`: Field name to inject tenant ID into (default: tenant_id)
 * - `sharedModels`: Models that are shared across tenants (skips RLS and injection)
 *
 * Usage:
 * ```typescript
 * const prisma = new PrismaClient().$extends(
 *   createPrismaTenancyExtension(tenancyService)
 * );
 * ```
 */
export function createPrismaTenancyExtension(
  tenancyService: TenancyService,
  options?: PrismaTenancyExtensionOptions,
) {
  const settingKey = options?.dbSettingKey ?? DEFAULT_DB_SETTING_KEY;
  const sharedModels = new Set(options?.sharedModels ?? []);
  const autoInject = options?.autoInjectTenantId ?? false;
  const tenantIdField = options?.tenantIdField ?? 'tenant_id';

  return Prisma.defineExtension((prisma) => {
    // Prisma's defineExtension callback receives a Client type that
    // doesn't fully expose $executeRaw/$transaction in its generic form.
    // Cast to access these methods which are available at runtime.
    const baseClient = prisma as any;

    return baseClient.$extends({
      query: {
        $allModels: {
          async $allOperations({
            model,
            operation,
            args,
            query,
          }: {
            model: string;
            operation: string;
            args: any;
            query: (args: any) => Promise<any>;
          }) {
            const tenantId = tenancyService.getCurrentTenant();

            if (!tenantId || sharedModels.has(model)) {
              return query(args);
            }

            if (autoInject) {
              switch (operation) {
                case 'create':
                  args = { ...args, data: { ...args.data, [tenantIdField]: tenantId } };
                  break;
                case 'createMany':
                  args = {
                    ...args,
                    data: args.data.map((d: any) => ({ ...d, [tenantIdField]: tenantId })),
                  };
                  break;
                case 'upsert':
                  args = {
                    ...args,
                    create: { ...args.create, [tenantIdField]: tenantId },
                  };
                  break;
              }
            }

            const [, result] = await baseClient.$transaction([
              baseClient.$executeRaw`SELECT set_config(${settingKey}, ${tenantId}, TRUE)`,
              query(args),
            ]);

            return result;
          },
        },
      },
    });
  });
}
