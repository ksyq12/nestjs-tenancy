import { createHash } from 'crypto';
import * as path from 'path';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';
import { createPrismaTenancyExtension } from '../../../src/prisma/prisma-tenancy.extension';
import { tenancyTransaction } from '../../../src/prisma/tenancy-transaction';
import { TenancyContext } from '../../../src/services/tenancy-context';
import { TenancyService } from '../../../src/services/tenancy.service';
import { TenancyModule } from '../../../src/tenancy.module';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const CUSTOM_SETTING_KEY = 'app.pgbouncer_custom_tenant';
const CUSTOM_SELECT_POLICY = 'ten_m03_custom_tenant_select';
const CUSTOM_SELECT_GUARD_POLICY = 'ten_m03_custom_tenant_guard';

const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://tenancy:tenancy@localhost:5433/tenancy_test';
const APP_DATABASE_URL =
  process.env.APP_DATABASE_URL ??
  'postgresql://app_user:app_user@localhost:6432/tenancy_test';
const PGBOUNCER_ADMIN_URL =
  process.env.PGBOUNCER_ADMIN_URL ??
  'postgresql://tenancy:tenancy@localhost:6432/pgbouncer';
const PGBOUNCER_SESSION_DATABASE_URL =
  process.env.PGBOUNCER_SESSION_DATABASE_URL ??
  'postgresql://app_user:app_user@localhost:6433/tenancy_test';
const PGBOUNCER_SESSION_ADMIN_URL =
  process.env.PGBOUNCER_SESSION_ADMIN_URL ??
  'postgresql://tenancy:tenancy@localhost:6433/pgbouncer';
const PARALLEL_APP_DATABASE_URL =
  process.env.PARALLEL_APP_DATABASE_URL ??
  'postgresql://app_user:app_user@localhost:6434/tenancy_test';
const PARALLEL_PGBOUNCER_ADMIN_URL =
  process.env.PARALLEL_PGBOUNCER_ADMIN_URL ??
  'postgresql://tenancy:tenancy@localhost:6434/pgbouncer';

const GENERATED_ADAPTER_CLIENT = path.join(
  __dirname,
  '..',
  'generated',
  'client',
);
const GENERATED_V6_NATIVE_CLIENT = path.join(
  __dirname,
  '..',
  'generated-v6-native',
);

const PRISMA_VERSION = String(require('@prisma/client/package.json').version);
const PRISMA_MAJOR = Number.parseInt(PRISMA_VERSION.split('.')[0], 10);
const describePrisma6Native = PRISMA_MAJOR === 6 ? describe : describe.skip;
const itPrisma7Adapter = PRISMA_MAJOR >= 7 ? it : it.skip;
const itPrisma6Adapter = PRISMA_MAJOR === 6 ? it : it.skip;

const PROBE_SQL = `
  SELECT pg_backend_pid()::int AS backend_pid,
         NULLIF(current_setting('app.current_tenant', true), '') AS tenant_setting,
         (SELECT count(*)::int FROM users) AS visible_count
`;

const SLOW_PROBE_SQL = `
  WITH hold AS MATERIALIZED (SELECT pg_sleep(0.10))
  SELECT pg_backend_pid()::int AS backend_pid,
         NULLIF(current_setting('app.current_tenant', true), '') AS tenant_setting,
         (SELECT count(*)::int FROM users) AS visible_count
    FROM hold
`;

interface Probe {
  backend_pid: number;
  tenant_setting: string | null;
  visible_count: number;
}

interface TenantResult {
  rows: Array<{ tenant_id: string; name: string }>;
  probe: Probe;
}

type PrismaConstructor = new (options: Record<string, unknown>) => any;
type PrismaPgConstructor = new (
  config: Record<string, unknown>,
  options?: Record<string, unknown>,
) => any;

function loadAdapterPrismaClient(): PrismaConstructor {
  return require(GENERATED_ADAPTER_CLIENT).PrismaClient as PrismaConstructor;
}

function createAdapterClient(
  connectionString: string,
  maxConnections = 16,
  adapterOptions?: Record<string, unknown>,
): any {
  const PrismaClient = loadAdapterPrismaClient();
  const Adapter = PrismaPg as unknown as PrismaPgConstructor;
  const adapter = new Adapter(
    { connectionString, max: maxConnections },
    adapterOptions,
  );
  return new PrismaClient({ adapter });
}

async function queryProbe(queryable: any): Promise<Probe> {
  const rows = (await queryable.$queryRawUnsafe(PROBE_SQL)) as Probe[];
  expect(rows).toHaveLength(1);
  return rows[0];
}

async function querySlowProbe(queryable: any): Promise<Probe> {
  const rows = (await queryable.$queryRawUnsafe(SLOW_PROBE_SQL)) as Probe[];
  expect(rows).toHaveLength(1);
  return rows[0];
}

async function runTenantProbe(
  prisma: any,
  context: TenancyContext,
  service: TenancyService,
  tenantId: string,
  holdSeconds = 0,
): Promise<TenantResult> {
  return context.run(tenantId, () =>
    tenancyTransaction(prisma, service, async (tx: any) => {
      if (holdSeconds > 0) {
        await tx.$queryRawUnsafe(
          `SELECT 1::int AS slept FROM pg_sleep(${holdSeconds.toFixed(3)})`,
        );
      }

      const rows = (await tx.user.findMany({
        orderBy: { name: 'asc' },
        select: { tenant_id: true, name: true },
      })) as TenantResult['rows'];

      return { rows, probe: await queryProbe(tx) };
    }),
  );
}

function expectTenantResult(result: TenantResult, tenantId: string): void {
  expect(result.rows).toHaveLength(2);
  expect(result.rows.every((row) => row.tenant_id === tenantId)).toBe(true);
  expect(result.probe).toMatchObject({
    tenant_setting: tenantId,
    visible_count: 2,
  });
}

function expectNoContext(probe: Probe): void {
  expect(probe.tenant_setting).toBeNull();
  expect(probe.visible_count).toBe(0);
}

function expectOneBackend(probes: Probe[]): void {
  expect(new Set(probes.map((probe) => probe.backend_pid)).size).toBe(1);
}

function expectSupportedPgBouncerVersion(version: string): void {
  const match = version.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  expect(match).not.toBeNull();

  if (!match) return;

  const major = Number(match[1]);
  const minor = Number(match[2]);
  expect(major > 1 || (major === 1 && minor >= 21)).toBe(true);
}

function databaseNameFromUrl(connectionString: string): string {
  const databaseName = decodeURIComponent(
    new URL(connectionString).pathname.replace(/^\//, ''),
  );

  if (!/^[A-Za-z_][A-Za-z0-9_$]*$/.test(databaseName)) {
    throw new Error(
      `PgBouncer RECONNECT requires a simple database name; received ${databaseName}`,
    );
  }

  return databaseName;
}

async function expectMaxWaitStartFailure(
  prisma: any,
  context: TenancyContext,
  service: TenancyService,
): Promise<void> {
  const callback = jest.fn(async () => 'unexpected');
  let releaseHolder!: () => void;
  let markHolderStarted!: () => void;
  const holderStarted = new Promise<void>((resolve) => {
    markHolderStarted = resolve;
  });
  const holderRelease = new Promise<void>((resolve) => {
    releaseHolder = resolve;
  });

  await prisma.$connect();
  try {
    const holder = context.run(TENANT_A, () =>
      tenancyTransaction(prisma, service, async (tx: any) => {
        await queryProbe(tx);
        markHolderStarted();
        await holderRelease;
      }),
    );
    await holderStarted;

    const fallbackRelease = setTimeout(releaseHolder, 1_000);
    try {
      await expect(
        context.run(TENANT_B, () =>
          tenancyTransaction(prisma, service, callback, { maxWait: 50 }),
        ),
      ).rejects.toThrow(/P2028|start.*transaction|transaction.*start|timeout/i);
      expect(callback).not.toHaveBeenCalled();
    } finally {
      clearTimeout(fallbackRelease);
      releaseHolder();
      await holder;
    }

    expectNoContext(await queryProbe(prisma));
  } finally {
    releaseHolder();
    await prisma.$disconnect();
  }
}

jest.setTimeout(30_000);

let directAdmin: Client;

beforeAll(async () => {
  directAdmin = new Client({ connectionString: DATABASE_URL });
  await directAdmin.connect();
});

afterAll(async () => {
  await directAdmin.query(
    `DELETE FROM users WHERE email LIKE 'pgbouncer-%@test.invalid'`,
  );
  await directAdmin.end();
});

describe('PgBouncer configuration contract', () => {
  let admin: Client;

  beforeAll(async () => {
    admin = new Client({ connectionString: PGBOUNCER_ADMIN_URL });
    await admin.connect();
  });

  afterAll(async () => {
    await admin.end();
  });

  it('runs a supported transaction-mode pool with prepared statements enabled', async () => {
    const config = await admin.query<{ key: string; value: string }>(
      'SHOW CONFIG',
    );
    const values = new Map(config.rows.map((row) => [row.key, row.value]));

    expect(values.get('pool_mode')).toBe('transaction');
    expect(Number(values.get('default_pool_size'))).toBe(1);
    expect(Number(values.get('max_db_connections'))).toBe(1);
    expect(Number(values.get('max_prepared_statements'))).toBe(200);

    const version = await admin.query<{ version: string }>('SHOW VERSION');
    expect(version.rows).toHaveLength(1);
    expect(version.rows[0].version).toBe('PgBouncer 1.25.2');
    expectSupportedPgBouncerVersion(version.rows[0].version);
  });
});

describe(`tenancyTransaction() through PrismaPg ${PRISMA_VERSION}`, () => {
  let context: TenancyContext;
  let service: TenancyService;
  let prisma: any;

  beforeAll(async () => {
    context = new TenancyContext();
    service = new TenancyService(context);
    prisma = createAdapterClient(APP_DATABASE_URL, 24);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('reuses one physical backend for tenant A, tenant B, then no context', async () => {
    const tenantA = await runTenantProbe(
      prisma,
      context,
      service,
      TENANT_A,
    );
    const tenantB = await runTenantProbe(
      prisma,
      context,
      service,
      TENANT_B,
    );
    const noContext = await queryProbe(prisma);

    expectTenantResult(tenantA, TENANT_A);
    expectTenantResult(tenantB, TENANT_B);
    expectNoContext(noContext);
    expectOneBackend([tenantA.probe, tenantB.probe, noContext]);
  });

  it('cleans transaction-local state after commit', async () => {
    const email = 'pgbouncer-commit@test.invalid';
    let transactionProbe: Probe | undefined;

    try {
      await context.run(TENANT_A, () =>
        tenancyTransaction(prisma, service, async (tx: any) => {
          await tx.user.create({
            data: {
              tenant_id: TENANT_A,
              name: 'PgBouncerCommit',
              email,
            },
          });
          transactionProbe = await queryProbe(tx);
        }),
      );

      const committed = await directAdmin.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM users WHERE email = $1',
        [email],
      );
      expect(committed.rows[0].count).toBe(1);
    } finally {
      await directAdmin.query('DELETE FROM users WHERE email = $1', [email]);
    }

    const noContext = await queryProbe(prisma);
    expect(transactionProbe).toBeDefined();
    expectNoContext(noContext);
    expect(noContext.backend_pid).toBe(transactionProbe?.backend_pid);
  });

  it('rolls back and cleans state after a callback error', async () => {
    const email = 'pgbouncer-callback-error@test.invalid';
    const callbackError = new Error('intentional callback failure');
    let transactionProbe: Probe | undefined;

    await expect(
      context.run(TENANT_A, () =>
        tenancyTransaction(prisma, service, async (tx: any) => {
          await tx.user.create({
            data: {
              tenant_id: TENANT_A,
              name: 'PgBouncerCallbackError',
              email,
            },
          });
          transactionProbe = await queryProbe(tx);
          throw callbackError;
        }),
      ),
    ).rejects.toBe(callbackError);

    const rolledBack = await directAdmin.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM users WHERE email = $1',
      [email],
    );
    const noContext = await queryProbe(prisma);

    expect(rolledBack.rows[0].count).toBe(0);
    expect(transactionProbe).toBeDefined();
    expectNoContext(noContext);
    expect(noContext.backend_pid).toBe(transactionProbe?.backend_pid);
  });

  it('rolls back and cleans state after a database error', async () => {
    const email = 'pgbouncer-database-error@test.invalid';
    let transactionProbe: Probe | undefined;

    await expect(
      context.run(TENANT_B, () =>
        tenancyTransaction(prisma, service, async (tx: any) => {
          await tx.user.create({
            data: {
              tenant_id: TENANT_B,
              name: 'PgBouncerDatabaseError',
              email,
            },
          });
          transactionProbe = await queryProbe(tx);
          await tx.$queryRawUnsafe('SELECT 1 / 0');
        }),
      ),
    ).rejects.toThrow(/division by zero|22012/i);

    const rolledBack = await directAdmin.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM users WHERE email = $1',
      [email],
    );
    const noContext = await queryProbe(prisma);

    expect(rolledBack.rows[0].count).toBe(0);
    expect(transactionProbe).toBeDefined();
    expectNoContext(noContext);
    expect(noContext.backend_pid).toBe(transactionProbe?.backend_pid);
  });

  it('rolls back and cleans state after an interactive transaction timeout', async () => {
    const email = 'pgbouncer-timeout@test.invalid';
    let transactionProbe: Probe | undefined;

    await expect(
      context.run(TENANT_A, () =>
        tenancyTransaction(
          prisma,
          service,
          async (tx: any) => {
            await tx.user.create({
              data: {
                tenant_id: TENANT_A,
                name: 'PgBouncerTimeout',
                email,
              },
            });
            transactionProbe = await queryProbe(tx);
            await tx.$queryRawUnsafe(
              'SELECT 1::int AS slept FROM pg_sleep(0.25)',
            );
          },
          { timeout: 75 },
        ),
      ),
    ).rejects.toThrow(/P2028|transaction.*(closed|expired)|timeout/i);

    const rolledBack = await directAdmin.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM users WHERE email = $1',
      [email],
    );
    const noContext = await queryProbe(prisma);

    expect(rolledBack.rows[0].count).toBe(0);
    expect(transactionProbe).toBeDefined();
    expectNoContext(noContext);
  });

  it('runs with the requested PostgreSQL isolation level', async () => {
    const isolationLevel = await context.run(TENANT_B, () =>
      tenancyTransaction(
        prisma,
        service,
        async (tx: any) => {
          const rows = (await tx.$queryRawUnsafe(
            `SELECT current_setting('transaction_isolation') AS isolation_level`,
          )) as Array<{ isolation_level: string }>;
          return rows[0].isolation_level;
        },
        { isolationLevel: 'Serializable' },
      ),
    );

    expect(isolationLevel).toBe('serializable');
    expectNoContext(await queryProbe(prisma));
  });

  it('rejects an invalid setting key before entering the callback', async () => {
    const callback = jest.fn(async () => 'unexpected');

    await expect(
      context.run(TENANT_A, () =>
        tenancyTransaction(prisma, service, callback, {
          dbSettingKey: 'server_version',
        }),
      ),
    ).rejects.toThrow('Invalid database setting key');

    expect(callback).not.toHaveBeenCalled();
    expectNoContext(await queryProbe(prisma));
  });

  itPrisma7Adapter('honors maxWait when transaction start is blocked', async () => {
    const contendedPrisma = createAdapterClient(APP_DATABASE_URL, 1);
    await expectMaxWaitStartFailure(contendedPrisma, context, service);
  });

  itPrisma6Adapter('documents that Prisma 6 PrismaPg does not enforce maxWait', async () => {
    const contendedPrisma = createAdapterClient(APP_DATABASE_URL, 1);
    const callback = jest.fn(async () => 'continued-after-wait');
    let releaseHolder!: () => void;
    let markHolderStarted!: () => void;
    const holderStarted = new Promise<void>((resolve) => {
      markHolderStarted = resolve;
    });
    const holderRelease = new Promise<void>((resolve) => {
      releaseHolder = resolve;
    });

    await contendedPrisma.$connect();
    try {
      const holder = context.run(TENANT_A, () =>
        tenancyTransaction(contendedPrisma, service, async (tx: any) => {
          await queryProbe(tx);
          markHolderStarted();
          await holderRelease;
        }),
      );
      await holderStarted;

      const startedAt = Date.now();
      const releaseTimer = setTimeout(releaseHolder, 150);
      let result: string;
      try {
        result = await context.run(TENANT_B, () =>
          tenancyTransaction(contendedPrisma, service, callback, {
            maxWait: 50,
          }),
        );
      } finally {
        clearTimeout(releaseTimer);
        releaseHolder();
        await holder;
      }

      expect(result).toBe('continued-after-wait');
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(100);
      expect(callback).toHaveBeenCalledTimes(1);
      expectNoContext(await queryProbe(contendedPrisma));
    } finally {
      releaseHolder();
      await contendedPrisma.$disconnect();
    }
  });

  it('isolates high client concurrency while pool size one queues work', async () => {
    const results = await Promise.all(
      Array.from({ length: 24 }, (_, index) => {
        const tenantId = index % 2 === 0 ? TENANT_A : TENANT_B;
        return runTenantProbe(prisma, context, service, tenantId, 0.015).then(
          (result) => ({ tenantId, result }),
        );
      }),
    );

    for (const { tenantId, result } of results) {
      expectTenantResult(result, tenantId);
    }
    expectOneBackend(results.map(({ result }) => result.probe));
  });
});

describe(`canonical custom dbSettingKey through PrismaPg ${PRISMA_VERSION}`, () => {
  interface CustomSettingProbe {
    custom_setting: string | null;
    default_setting: string | null;
    visible_count: number;
  }

  let moduleRef: TestingModule;
  let context: TenancyContext;
  let service: TenancyService;
  let basePrisma: any;
  let prisma: any;

  async function queryCustomSettingProbe(
    queryable: any,
  ): Promise<CustomSettingProbe> {
    const rows = (await queryable.$queryRawUnsafe(`
      SELECT NULLIF(current_setting('${CUSTOM_SETTING_KEY}', true), '') AS custom_setting,
             NULLIF(current_setting('app.current_tenant', true), '') AS default_setting,
             (SELECT count(*)::int FROM users) AS visible_count
    `)) as CustomSettingProbe[];
    expect(rows).toHaveLength(1);
    return rows[0];
  }

  async function runHelperProbe(tenantId: string): Promise<{
    rows: Array<{ tenant_id: string; name: string }>;
    probe: CustomSettingProbe;
  }> {
    return context.run(tenantId, () =>
      tenancyTransaction(basePrisma, service, async (tx: any) => ({
        rows: await tx.user.findMany({
          orderBy: { name: 'asc' },
          select: { tenant_id: true, name: true },
        }),
        probe: await queryCustomSettingProbe(tx),
      })),
    );
  }

  beforeAll(async () => {
    // The permissive policy grants rows through the custom key. The matching
    // restrictive guard prevents the fixture's default-key policy from making
    // this regression pass if runtime configuration falls back to the default.
    await directAdmin.query(`
      DROP POLICY IF EXISTS ${CUSTOM_SELECT_POLICY} ON users;
      DROP POLICY IF EXISTS ${CUSTOM_SELECT_GUARD_POLICY} ON users;
      CREATE POLICY ${CUSTOM_SELECT_POLICY} ON users
        FOR SELECT
        USING (
          tenant_id = current_setting('${CUSTOM_SETTING_KEY}', true)::text
        );
      CREATE POLICY ${CUSTOM_SELECT_GUARD_POLICY} ON users
        AS RESTRICTIVE
        FOR SELECT
        USING (
          tenant_id = current_setting('${CUSTOM_SETTING_KEY}', true)::text
        );
    `);

    moduleRef = await Test.createTestingModule({
      imports: [
        TenancyModule.forRoot({
          tenantExtractor: 'x-tenant-id',
          dbSettingKey: CUSTOM_SETTING_KEY,
        }),
      ],
    }).compile();
    context = moduleRef.get(TenancyContext);
    service = moduleRef.get(TenancyService);
    basePrisma = createAdapterClient(APP_DATABASE_URL);
    prisma = basePrisma.$extends(createPrismaTenancyExtension(service));
    await prisma.$connect();
  });

  afterAll(async () => {
    try {
      if (basePrisma) await basePrisma.$disconnect();
    } finally {
      try {
        if (moduleRef) await moduleRef.close();
      } finally {
        await directAdmin.query(`
          DROP POLICY IF EXISTS ${CUSTOM_SELECT_GUARD_POLICY} ON users;
          DROP POLICY IF EXISTS ${CUSTOM_SELECT_POLICY} ON users;
        `);
      }
    }
  });

  it('uses the module key for extension tenant A/B and no-context RLS', async () => {
    const tenantA = await context.run(TENANT_A, async () =>
      await prisma.user.findMany({ orderBy: { name: 'asc' } }),
    );
    const tenantB = await context.run(TENANT_B, async () =>
      await prisma.user.findMany({ orderBy: { name: 'asc' } }),
    );
    const noContextRows = await service.withoutTenant(async () =>
      await prisma.user.findMany(),
    );

    expect(tenantA).toHaveLength(2);
    expect(tenantA.every((row: any) => row.tenant_id === TENANT_A)).toBe(true);
    expect(tenantB).toHaveLength(2);
    expect(tenantB.every((row: any) => row.tenant_id === TENANT_B)).toBe(true);
    expect(noContextRows).toHaveLength(0);
    expect(await queryCustomSettingProbe(basePrisma)).toEqual({
      custom_setting: null,
      default_setting: null,
      visible_count: 0,
    });
  });

  it('uses the module key for helper tenant A/B and cleans no-context state', async () => {
    const tenantA = await runHelperProbe(TENANT_A);
    const tenantB = await runHelperProbe(TENANT_B);
    const callback = jest.fn(async () => 'unexpected');

    for (const [result, tenantId] of [
      [tenantA, TENANT_A],
      [tenantB, TENANT_B],
    ] as const) {
      expect(result.rows).toHaveLength(2);
      expect(result.rows.every((row) => row.tenant_id === tenantId)).toBe(true);
      expect(result.probe).toEqual({
        custom_setting: tenantId,
        default_setting: null,
        visible_count: 2,
      });
    }

    await expect(
      tenancyTransaction(basePrisma, service, callback),
    ).rejects.toThrow(/tenant context/i);
    expect(callback).not.toHaveBeenCalled();
    expect(await queryCustomSettingProbe(basePrisma)).toEqual({
      custom_setting: null,
      default_setting: null,
      visible_count: 0,
    });
  });
});

describe('default batch Prisma tenancy extension through PgBouncer', () => {
  let context: TenancyContext;
  let service: TenancyService;
  let basePrisma: any;
  let prisma: any;

  beforeAll(async () => {
    context = new TenancyContext();
    service = new TenancyService(context);
    basePrisma = createAdapterClient(APP_DATABASE_URL);
    prisma = basePrisma.$extends(createPrismaTenancyExtension(service));
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('isolates A and B and fails closed at the database after an explicit bypass', async () => {
    const tenantA = await context.run(TENANT_A, async () =>
      await prisma.user.findMany({ orderBy: { name: 'asc' } }),
    );
    const tenantB = await context.run(TENANT_B, async () =>
      await prisma.user.findMany({ orderBy: { name: 'asc' } }),
    );
    const noContextRows = await service.withoutTenant(async () =>
      await prisma.user.findMany(),
    );
    const noContextProbe = await queryProbe(basePrisma);

    expect(tenantA).toHaveLength(2);
    expect(tenantA.every((row: any) => row.tenant_id === TENANT_A)).toBe(true);
    expect(tenantB).toHaveLength(2);
    expect(tenantB.every((row: any) => row.tenant_id === TENANT_B)).toBe(true);
    expect(noContextRows).toHaveLength(0);
    expectNoContext(noContextProbe);
  });
});

describe('transparent interactiveTransactionSupport through PgBouncer', () => {
  let context: TenancyContext;
  let service: TenancyService;
  let basePrisma: any;
  let prisma: any;

  beforeAll(async () => {
    context = new TenancyContext();
    service = new TenancyService(context);
    basePrisma = createAdapterClient(APP_DATABASE_URL);
    prisma = basePrisma.$extends(
      createPrismaTenancyExtension(service, {
        interactiveTransactionSupport: true,
      }),
    );
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function transparentProbe(tenantId: string): Promise<TenantResult> {
    return context.run(tenantId, () =>
      prisma.$transaction(async (tx: any) => {
        const rows = (await tx.user.findMany({
          orderBy: { name: 'asc' },
          select: { tenant_id: true, name: true },
        })) as TenantResult['rows'];
        return { rows, probe: await queryProbe(tx) };
      }),
    );
  }

  it('keeps its transparent interactive transaction on the tenant backend', async () => {
    const tenantA = await transparentProbe(TENANT_A);
    const tenantB = await transparentProbe(TENANT_B);
    const noContext = await queryProbe(basePrisma);

    expectTenantResult(tenantA, TENANT_A);
    expectTenantResult(tenantB, TENANT_B);
    expectNoContext(noContext);
    expectOneBackend([tenantA.probe, tenantB.probe, noContext]);
  });
});

describe('PrismaPg named prepared statements through PgBouncer', () => {
  it('reuses deterministic statement names when the adapter supports them', async () => {
    const generatedNames: string[] = [];
    const statementNameGenerator = (query: { sql?: string }): string => {
      const sql = query.sql ?? '';
      const name = `tenancy_${createHash('sha256')
        .update(sql)
        .digest('hex')
        .slice(0, 24)}`;
      generatedNames.push(name);
      return name;
    };
    const prisma = createAdapterClient(APP_DATABASE_URL, 4, {
      statementNameGenerator,
    });
    const context = new TenancyContext();
    const service = new TenancyService(context);

    await prisma.$connect();
    try {
      const results = [];
      for (const tenantId of [TENANT_A, TENANT_B, TENANT_A, TENANT_B]) {
        results.push(
          await context.run(tenantId, () =>
            tenancyTransaction(prisma, service, async (tx: any) => {
              const users = await tx.user.findMany({
                orderBy: { name: 'asc' },
              });
              const prepared = (await tx.$queryRawUnsafe(
                'SELECT count(*)::int AS count FROM pg_prepared_statements',
              )) as Array<{ count: number }>;
              return { tenantId, users, preparedCount: prepared[0].count };
            }),
          ),
        );
      }

      for (const result of results) {
        expect(result.users).toHaveLength(2);
        expect(
          result.users.every(
            (row: any) => row.tenant_id === result.tenantId,
          ),
        ).toBe(true);
      }

      // Older Prisma 6 adapters may accept but ignore the second constructor
      // argument. A callback invocation is the runtime capability signal.
      if (PRISMA_MAJOR >= 7) {
        expect(generatedNames.length).toBeGreaterThan(0);
      }
      if (generatedNames.length > 0) {
        expect(new Set(generatedNames).size).toBeLessThan(
          generatedNames.length,
        );
        expect(results.every((result) => result.preparedCount > 0)).toBe(true);
      }
    } finally {
      await prisma.$disconnect();
    }
  });
});

describe('parallel transaction-mode pool', () => {
  let context: TenancyContext;
  let service: TenancyService;
  let prisma: any;

  beforeAll(async () => {
    context = new TenancyContext();
    service = new TenancyService(context);
    prisma = createAdapterClient(PARALLEL_APP_DATABASE_URL, 24);
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('uses both physical backends under overlap and cleans both afterward', async () => {
    const results = await Promise.all(
      Array.from({ length: 24 }, (_, index) => {
        const tenantId = index % 2 === 0 ? TENANT_A : TENANT_B;
        return runTenantProbe(prisma, context, service, tenantId, 0.040).then(
          (result) => ({ tenantId, result }),
        );
      }),
    );

    for (const { tenantId, result } of results) {
      expectTenantResult(result, tenantId);
    }

    const transactionPids = new Set(
      results.map(({ result }) => result.probe.backend_pid),
    );
    expect(transactionPids.size).toBe(2);

    const noContext = await Promise.all([
      querySlowProbe(prisma),
      querySlowProbe(prisma),
    ]);
    noContext.forEach(expectNoContext);
    expect(new Set(noContext.map((probe) => probe.backend_pid))).toEqual(
      transactionPids,
    );
  });

  it('reconnects server backends and starts clean on new physical sessions', async () => {
    const before = await Promise.all([
      querySlowProbe(prisma),
      querySlowProbe(prisma),
    ]);
    const oldPids = new Set(before.map((probe) => probe.backend_pid));
    expect(oldPids.size).toBe(2);
    before.forEach(expectNoContext);

    const admin = new Client({
      connectionString: PARALLEL_PGBOUNCER_ADMIN_URL,
    });
    await admin.connect();
    try {
      const databaseName = databaseNameFromUrl(PARALLEL_APP_DATABASE_URL);
      await admin.query(`RECONNECT ${databaseName}`);
    } finally {
      await admin.end();
    }

    const replacements = await Promise.all([
      querySlowProbe(prisma),
      querySlowProbe(prisma),
    ]);
    replacements.forEach(expectNoContext);
    const newPids = new Set(
      replacements.map((probe) => probe.backend_pid),
    );
    expect(newPids.size).toBe(2);
    for (const pid of newPids) {
      expect(oldPids.has(pid)).toBe(false);
    }

    const tenantA = await runTenantProbe(prisma, context, service, TENANT_A);
    const noContext = await queryProbe(prisma);

    expectTenantResult(tenantA, TENANT_A);
    expectNoContext(noContext);
    expect(newPids.has(tenantA.probe.backend_pid)).toBe(true);
    expect(newPids.has(noContext.backend_pid)).toBe(true);
  });
});

describe('session-mode negative contract', () => {
  it('pins the only backend until the first logical client disconnects', async () => {
    const admin = new Client({ connectionString: PGBOUNCER_SESSION_ADMIN_URL });
    const first = new Client({
      connectionString: PGBOUNCER_SESSION_DATABASE_URL,
    });
    const second = new Client({
      connectionString: PGBOUNCER_SESSION_DATABASE_URL,
    });
    let firstEnded = false;

    await admin.connect();
    await first.connect();
    await second.connect();

    try {
      const config = await admin.query<{ key: string; value: string }>(
        'SHOW CONFIG',
      );
      const values = new Map(config.rows.map((row) => [row.key, row.value]));
      expect(values.get('pool_mode')).toBe('session');
      expect(Number(values.get('default_pool_size'))).toBe(1);
      expect(Number(values.get('max_db_connections'))).toBe(1);

      const firstPid = await first.query<{ backend_pid: number }>(
        'SELECT pg_backend_pid()::int AS backend_pid',
      );
      let secondFinished = false;
      const secondQuery = second
        .query<{ backend_pid: number }>(
          'SELECT pg_backend_pid()::int AS backend_pid',
        )
        .then((result) => {
          secondFinished = true;
          return result;
        });

      let waitingClients = 0;
      for (let attempt = 0; attempt < 25 && waitingClients === 0; attempt++) {
        const pools = await admin.query<{
          database: string;
          user: string;
          cl_waiting: string | number;
        }>('SHOW POOLS');
        const applicationPool = pools.rows.find(
          (row) => row.database === 'tenancy_test' && row.user === 'app_user',
        );
        waitingClients = Number(applicationPool?.cl_waiting ?? 0);
        if (waitingClients === 0) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      expect(waitingClients).toBeGreaterThan(0);
      expect(secondFinished).toBe(false);

      await first.end();
      firstEnded = true;
      const secondPid = await secondQuery;
      expect(secondPid.rows[0].backend_pid).toBe(
        firstPid.rows[0].backend_pid,
      );
    } finally {
      if (!firstEnded) await first.end();
      await second.end();
      await admin.end();
    }
  });
});

describePrisma6Native('Prisma 6 native-engine PgBouncer lane', () => {
  let NativePrismaClient: PrismaConstructor;
  let context: TenancyContext;
  let service: TenancyService;
  let prisma: any;

  beforeAll(async () => {
    NativePrismaClient = require(GENERATED_V6_NATIVE_CLIENT)
      .PrismaClient as PrismaConstructor;
    context = new TenancyContext();
    service = new TenancyService(context);
    prisma = new NativePrismaClient({ datasourceUrl: APP_DATABASE_URL });
    await prisma.$connect();
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('runs helper tenant A, tenant B, and no-context on one backend', async () => {
    const tenantA = await runTenantProbe(
      prisma,
      context,
      service,
      TENANT_A,
    );
    const tenantB = await runTenantProbe(
      prisma,
      context,
      service,
      TENANT_B,
    );
    const noContext = await queryProbe(prisma);

    expectTenantResult(tenantA, TENANT_A);
    expectTenantResult(tenantB, TENANT_B);
    expectNoContext(noContext);
    expectOneBackend([tenantA.probe, tenantB.probe, noContext]);
  });

  it('rolls back callback failures and returns a clean backend', async () => {
    const email = 'pgbouncer-v6-native-rollback@test.invalid';
    const callbackError = new Error('intentional v6 native callback failure');
    let transactionProbe: Probe | undefined;

    await expect(
      context.run(TENANT_A, () =>
        tenancyTransaction(prisma, service, async (tx: any) => {
          await tx.user.create({
            data: {
              tenant_id: TENANT_A,
              name: 'PgBouncerV6NativeRollback',
              email,
            },
          });
          transactionProbe = await queryProbe(tx);
          throw callbackError;
        }),
      ),
    ).rejects.toBe(callbackError);

    const rolledBack = await directAdmin.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM users WHERE email = $1',
      [email],
    );
    const noContext = await queryProbe(prisma);

    expect(rolledBack.rows[0].count).toBe(0);
    expect(transactionProbe).toBeDefined();
    expectNoContext(noContext);
    expect(noContext.backend_pid).toBe(transactionProbe?.backend_pid);
  });

  it('honors maxWait when the native connection pool is exhausted', async () => {
    const contendedUrl = new URL(APP_DATABASE_URL);
    contendedUrl.searchParams.set('connection_limit', '1');
    const contendedPrisma = new NativePrismaClient({
      datasourceUrl: contendedUrl.toString(),
    });

    await expectMaxWaitStartFailure(contendedPrisma, context, service);
  });

  it('keeps transparent interactive transactions isolated', async () => {
    const extended = prisma.$extends(
      createPrismaTenancyExtension(service, {
        interactiveTransactionSupport: true,
      }),
    );

    const runTransparent = (tenantId: string): Promise<TenantResult> =>
      context.run(tenantId, () =>
        extended.$transaction(async (tx: any) => {
          const rows = (await tx.user.findMany({
            orderBy: { name: 'asc' },
            select: { tenant_id: true, name: true },
          })) as TenantResult['rows'];
          return { rows, probe: await queryProbe(tx) };
        }),
      );

    const tenantA = await runTransparent(TENANT_A);
    const tenantB = await runTransparent(TENANT_B);
    const noContext = await queryProbe(prisma);

    expectTenantResult(tenantA, TENANT_A);
    expectTenantResult(tenantB, TENANT_B);
    expectNoContext(noContext);
    expectOneBackend([tenantA.probe, tenantB.probe, noContext]);
  });
});
