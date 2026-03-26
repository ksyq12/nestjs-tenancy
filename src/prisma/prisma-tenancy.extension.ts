import { Prisma } from '@prisma/client';
import { TenancyService } from '../services/tenancy.service';
import { DEFAULT_DB_SETTING_KEY } from '../tenancy.constants';

export interface PrismaTenancyExtensionOptions {
  dbSettingKey?: string;
  autoInjectTenantId?: boolean;
  tenantIdField?: string;
  sharedModels?: string[];
  /**
   * EXPERIMENTAL: Enable transparent interactive transaction support.
   * Relies on undocumented Prisma internals (__internalParams).
   * May break on Prisma upgrades. Use tenancyTransaction() for reliable support.
   */
  experimentalTransactionSupport?: boolean;
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
 * **Transaction limitation:**
 * This extension uses a batch `$transaction([set_config, query])` internally.
 * If the caller is already inside an interactive transaction (`$transaction(async (tx) => ...)`),
 * the `set_config` call runs in a separate connection and does NOT propagate into the
 * caller's transaction. RLS still enforces row-level isolation, but the PostgreSQL session
 * variable will not be set within the interactive transaction's connection.
 * For interactive transactions, call `set_config` manually as the first statement.
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
    let experimentalWarned = false;

    return baseClient.$extends({
      query: {
        $allModels: {
          async $allOperations({
            model,
            operation,
            args,
            query,
            ...rest
          }: {
            model: string;
            operation: string;
            args: any;
            query: (args: any) => Promise<any>;
            [key: string]: any;
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
                case 'createManyAndReturn':
                  if (Array.isArray(args.data)) {
                    args = {
                      ...args,
                      data: args.data.map((d: any) => ({ ...d, [tenantIdField]: tenantId })),
                    };
                  }
                  break;
                case 'upsert':
                  args = {
                    ...args,
                    create: { ...args.create, [tenantIdField]: tenantId },
                  };
                  break;
              }
            }

            const experimentalTx = options?.experimentalTransactionSupport ?? false;

            if (experimentalTx) {
              const txInfo = rest?.__internalParams?.transaction;

              if (txInfo?.kind === 'itx') {
                try {
                  const itxClient = (baseClient as any)._createItxClient?.(txInfo);
                  if (itxClient) {
                    await itxClient.$executeRaw`SELECT set_config(${settingKey}, ${tenantId}, TRUE)`;
                    return query(args);
                  }
                } catch {
                  // Fall through to batch transaction
                }

                if (!experimentalWarned) {
                  console.warn(
                    '[@nestarc/tenancy] experimentalTransactionSupport: ' +
                    'Prisma internal API not available. Falling back to batch transaction. ' +
                    'Use tenancyTransaction() for reliable interactive transaction support.',
                  );
                  experimentalWarned = true;
                }
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
