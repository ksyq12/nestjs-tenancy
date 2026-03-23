import { TenancyService } from '../services/tenancy.service';
import { DEFAULT_DB_SETTING_KEY } from '../tenancy.constants';

export interface PrismaTenancyExtensionOptions {
  dbSettingKey?: string;
}

/**
 * Creates a Prisma Client Extension that sets the PostgreSQL RLS context
 * (SET LOCAL) before every query when a tenant context exists.
 *
 * Usage:
 * ```typescript
 * const prisma = new PrismaClient().$extends(
 *   createPrismaTenancyExtension(tenancyService)
 * );
 * ```
 *
 * SECURITY: tenantId is pre-validated by middleware (UUID by default).
 * PostgreSQL SET commands do not support bind parameters ($1),
 * so $executeRawUnsafe is used with the already-validated value.
 * SET LOCAL is scoped to the interactive transaction.
 */
export function createPrismaTenancyExtension(
  tenancyService: TenancyService,
  options?: PrismaTenancyExtensionOptions,
) {
  const settingKey = options?.dbSettingKey ?? DEFAULT_DB_SETTING_KEY;

  return {
    query: {
      async $allOperations(params: {
        args: any;
        query: (args: any) => Promise<any>;
        model?: string;
        operation: string;
        __prismaRawClient?: any;
      }) {
        const { args, query, model, operation, __prismaRawClient } = params;
        const tenantId = tenancyService.getCurrentTenant();

        if (!tenantId) {
          return query(args);
        }

        const rawClient = __prismaRawClient;

        if (!rawClient || !rawClient.$transaction) {
          return query(args);
        }

        return rawClient.$transaction(async (tx: any) => {
          await tx.$executeRawUnsafe(
            `SET LOCAL "${settingKey}" = '${tenantId}'`,
          );

          if (model && tx[model] && tx[model][operation]) {
            return tx[model][operation](args);
          }

          return query(args);
        });
      },
    },
  };
}
