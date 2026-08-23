import { TenancyService } from '../services/tenancy.service';
import { DEFAULT_DB_SETTING_KEY } from '../tenancy.constants';

/**
 * Minimal transaction client shape required by `tenancyTransaction`.
 */
export interface PrismaTransactionContext {
  $executeRaw(
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown>;
}

/**
 * Structural type representing a Prisma-like client that supports
 * interactive transactions. `PrismaClient` satisfies this automatically.
 */
export interface PrismaTransactionClient<TTx extends PrismaTransactionContext = any> {
  $transaction<T>(
    fn: (tx: TTx) => Promise<T>,
    options?: Record<string, unknown>,
  ): Promise<T>;
}

export interface TenancyTransactionOptions {
  /**
   * Maximum time in milliseconds to wait for Prisma to start the transaction.
   * Forwarded to Prisma; enforcement depends on the selected Prisma runtime.
   */
  maxWait?: number;
  /** Maximum time in milliseconds the interactive transaction may run. */
  timeout?: number;
  /** PostgreSQL transaction isolation level. */
  isolationLevel?: 'ReadUncommitted' | 'ReadCommitted' | 'RepeatableRead' | 'Serializable';
  dbSettingKey?: string;
}

/**
 * Executes a Prisma interactive transaction with RLS tenant context.
 *
 * Runs `set_config()` as the first statement inside the interactive
 * transaction, ensuring the PostgreSQL session variable is set on the
 * same connection that executes the callback queries.
 *
 * @param prisma - PrismaClient instance (not extended — raw client)
 * @param tenancyService - TenancyService to read current tenant
 * @param callback - Function receiving the transaction client
 * @param options - Transaction wait/timeout, isolation level, and DB setting key
 */
export async function tenancyTransaction<
  T,
  TTx extends PrismaTransactionContext = any,
>(
  prisma: PrismaTransactionClient<TTx>,
  tenancyService: TenancyService,
  callback: (tx: TTx) => Promise<T>,
  options?: TenancyTransactionOptions,
): Promise<T> {
  const tenantId = tenancyService.getCurrentTenantOrThrow();
  const settingKey = options?.dbSettingKey ?? DEFAULT_DB_SETTING_KEY;

  return prisma.$transaction(
    async (tx: TTx) => {
      await tx.$executeRaw`SELECT set_config(${settingKey}, ${tenantId}, TRUE)`;
      return callback(tx);
    },
    {
      ...(options?.maxWait !== undefined && { maxWait: options.maxWait }),
      ...(options?.timeout !== undefined && { timeout: options.timeout }),
      ...(options?.isolationLevel !== undefined && {
        isolationLevel: options.isolationLevel,
      }),
    },
  );
}
