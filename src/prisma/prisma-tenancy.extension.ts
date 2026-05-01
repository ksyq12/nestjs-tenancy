import { Prisma } from '@prisma/client';
import { TenancyService } from '../services/tenancy.service';
import { TenancyContextRequiredError } from '../errors/tenancy-context-required.error';
import { DEFAULT_DB_SETTING_KEY } from '../tenancy.constants';

type PrismaRawExecutor = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<unknown>;

interface PrismaInternalClient {
  $extends(extension: unknown): unknown;
  $transaction<T extends readonly unknown[]>(queries: T): Promise<unknown[]>;
  $executeRaw: PrismaRawExecutor;
  _createItxClient?: (txInfo: unknown) => { $executeRaw: PrismaRawExecutor };
}

interface PrismaOperationContext {
  model: string;
  operation: string;
  args: Record<string, any>;
  query: (args: Record<string, any>) => Promise<unknown>;
  __internalParams?: {
    transaction?: {
      kind?: string;
      [key: string]: unknown;
    };
  };
}

export interface PrismaTenancyExtensionOptions {
  dbSettingKey?: string;
  autoInjectTenantId?: boolean;
  tenantIdField?: string;
  sharedModels?: string[];
  /**
   * When true, throws `TenancyContextRequiredError` if a query is executed
   * without a tenant context (unless the model is in `sharedModels` or
   * `withoutTenant()` was used to explicitly bypass).
   *
   * Prevents accidental data exposure when RLS policies are misconfigured.
   * @default true
   */
  failClosed?: boolean;
  /**
   * Enable transparent interactive transaction support.
   *
   * When enabled, the extension detects interactive transactions
   * (`$transaction(async (tx) => ...)`) and sets the RLS context
   * on the transaction's connection directly.
   *
   * Relies on Prisma internal APIs (`__internalParams`, `_createItxClient`).
   * Compatibility is validated at extension creation time — an error is thrown
   * immediately if the current Prisma version does not support this feature.
   *
   * For an alternative that uses only public Prisma APIs, see `tenancyTransaction()`.
   *
   * @default false
   */
  interactiveTransactionSupport?: boolean;
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
 * - `dbSettingKey`: PostgreSQL session variable name (default: app.current_tenant)
 * - `autoInjectTenantId`: Automatically inject tenant ID into write operations
 * - `tenantIdField`: Field name to inject tenant ID into (default: tenant_id)
 * - `sharedModels`: Models that are shared across tenants (skips RLS and injection)
 * - `failClosed`: Throw when model queries run without tenant context (default: true)
 *
 * **Interactive transactions:**
 * By default, the batch `$transaction([set_config, query])` does not propagate into
 * interactive transactions (`$transaction(async (tx) => ...)`). Two solutions:
 * 1. Enable `interactiveTransactionSupport: true` for transparent handling (uses Prisma internals).
 * 2. Use the standalone `tenancyTransaction()` helper (public APIs only).
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
  const failClosedMode = options?.failClosed ?? true;

  const itxSupport = options?.interactiveTransactionSupport === true;

  return Prisma.defineExtension((prisma): any => {
    // Prisma's defineExtension callback receives a Client type that
    // doesn't fully expose $executeRaw/$transaction in its generic form.
    // Cast to access these methods which are available at runtime.
    const baseClient = prisma as unknown as PrismaInternalClient;

    if (itxSupport && typeof baseClient._createItxClient !== 'function') {
      throw new Error(
        '[@nestarc/tenancy] `interactiveTransactionSupport` requires Prisma internal API ' +
        '`_createItxClient` which is not available in this Prisma version. ' +
        'Either upgrade/downgrade Prisma, or use `tenancyTransaction()` instead.',
      );
    }

    return baseClient.$extends({
      query: {
        $allModels: {
          async $allOperations({
            model,
            operation,
            args,
            query,
            __internalParams,
          }: PrismaOperationContext) {
            const tenantId = tenancyService.getCurrentTenant();

            if (sharedModels.has(model)) {
              return query(args);
            }

            if (!tenantId) {
              if (tenancyService.isTenantBypassed() || !failClosedMode) {
                return query(args);
              }
              throw new TenancyContextRequiredError(model, operation);
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
                      data: args.data.map((d: Record<string, unknown>) => ({ ...d, [tenantIdField]: tenantId })),
                    };
                  } else if (args.data && typeof args.data === 'object') {
                    args = { ...args, data: { ...args.data, [tenantIdField]: tenantId } };
                  }
                  break;
                case 'upsert':
                  args = {
                    ...args,
                    create: { ...args.create, [tenantIdField]: tenantId },
                    update: stripTenantField(args.update, tenantIdField),
                  };
                  break;
              }
            }

            if (itxSupport) {
              const txInfo = __internalParams?.transaction;

              if (txInfo?.kind === 'itx') {
                const itxClient = baseClient._createItxClient!(txInfo);
                await itxClient.$executeRaw`SELECT set_config(${settingKey}, ${tenantId}, TRUE)`;
                return query(args);
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

function stripTenantField(
  update: Record<string, any> | undefined,
  tenantIdField: string,
): Record<string, any> | undefined {
  if (!update || typeof update !== 'object' || Array.isArray(update)) {
    return update;
  }

  const safeUpdate = { ...update };
  delete safeUpdate[tenantIdField];
  return safeUpdate;
}
