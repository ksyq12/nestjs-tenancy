import { Client } from 'pg';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import * as path from 'path';
import { TenancyContext } from '../../src/services/tenancy-context';
import { TenancyService } from '../../src/services/tenancy.service';
import { createPrismaTenancyExtension } from '../../src/prisma/prisma-tenancy.extension';
import { tenancyTransaction } from '../../src/prisma/tenancy-transaction';
import { TenancyModule } from '../../src/tenancy.module';

const TENANT_1 = '11111111-1111-1111-1111-111111111111';
const TENANT_2 = '22222222-2222-2222-2222-222222222222';
const CUSTOM_SETTING_KEY = 'app.direct_custom_tenant';
const CUSTOM_SELECT_POLICY = 'ten_m03_direct_custom_tenant_select';
const CUSTOM_SELECT_GUARD_POLICY = 'ten_m03_direct_custom_tenant_guard';
const GENERATED_CONTEXT_GUARD_POLICY = 'tenant_context_guard_users';

const ADMIN_URL =
  process.env.DATABASE_URL ?? 'postgresql://tenancy:tenancy@localhost:5433/tenancy_test';
const APP_URL =
  process.env.APP_DATABASE_URL ?? 'postgresql://app_user:app_user@localhost:5433/tenancy_test';

function createClient(PrismaClient: any, connectionString: string) {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

// Shared admin client for cleanup within describe blocks
let sharedAdminClient: Client;

beforeAll(async () => {
  sharedAdminClient = new Client({ connectionString: ADMIN_URL });
  await sharedAdminClient.connect();
}, 30000);

afterAll(async () => {
  await sharedAdminClient.end();
});

/**
 * E2E test that verifies the Prisma extension actually applies RLS.
 *
 * This is the critical test that was missing: it proves that
 * createPrismaTenancyExtension + real PrismaClient + real PostgreSQL
 * correctly isolates tenant data via set_config() in batch transactions.
 */
describe('Prisma Extension + RLS Integration', () => {
  let context: TenancyContext;
  let service: TenancyService;
  let PrismaClient: any;
  let prisma: any;

  beforeAll(async () => {
    // Import the generated Prisma client (prisma generate runs before jest via test:e2e script)
    const generatedPath = path.join(__dirname, 'generated', 'client');
    const prismaModule = require(generatedPath);
    PrismaClient = prismaModule.PrismaClient;

    // Create extended Prisma client as app_user (RLS applies)
    context = new TenancyContext();
    service = new TenancyService(context);

    const basePrisma = createClient(PrismaClient, APP_URL);

    prisma = basePrisma.$extends(createPrismaTenancyExtension(service));

    await prisma.$connect();
  }, 30000);

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
  });

  it('should return only tenant 1 rows through Prisma extension', async () => {
    const rows = await context.run(TENANT_1, async () =>
      prisma.user.findMany(),
    );

    expect(rows).toHaveLength(2);
    expect(rows.every((r: any) => r.tenant_id === TENANT_1)).toBe(true);
    expect(rows.map((r: any) => r.name).sort()).toEqual(['Alice', 'Bob']);
  });

  it('should return only tenant 2 rows through Prisma extension', async () => {
    const rows = await context.run(TENANT_2, async () =>
      prisma.user.findMany(),
    );

    expect(rows).toHaveLength(2);
    expect(rows.every((r: any) => r.tenant_id === TENANT_2)).toBe(true);
  });

  it('should throw without tenant context by default', async () => {
    await expect(prisma.user.findMany()).rejects.toThrow(
      'Tenancy context is required',
    );
  });

  it('should skip set_config when using withoutTenant()', async () => {
    const rows = await service.withoutTenant(async () => {
      return prisma.user.findMany();
    });

    // withoutTenant() makes tenantId null, extension skips set_config
    // RLS still applies (app_user role) — NULL current_setting matches no rows
    expect(rows).toHaveLength(0);
  });

  it('should isolate tenants in concurrent requests', async () => {
    const [rows1, rows2] = await Promise.all([
      context.run(TENANT_1, async () => prisma.user.findMany()),
      context.run(TENANT_2, async () => prisma.user.findMany()),
    ]);

    expect(rows1.every((r: any) => r.tenant_id === TENANT_1)).toBe(true);
    expect(rows2.every((r: any) => r.tenant_id === TENANT_2)).toBe(true);
    expect(rows1).toHaveLength(2);
    expect(rows2).toHaveLength(2);
  });
});

describe('Prisma 7 canonical custom dbSettingKey integration', () => {
  let moduleRef: TestingModule;
  let context: TenancyContext;
  let service: TenancyService;
  let basePrisma: any;
  let prisma: any;

  beforeAll(async () => {
    // The custom permissive policy enables the configured key, while the
    // restrictive guard prevents the fixture's default-key policy from making
    // this regression pass if runtime configuration falls back to that key.
    await sharedAdminClient.query(`
      DROP POLICY IF EXISTS ${GENERATED_CONTEXT_GUARD_POLICY} ON users;
      DROP POLICY IF EXISTS ${CUSTOM_SELECT_GUARD_POLICY} ON users;
      DROP POLICY IF EXISTS ${CUSTOM_SELECT_POLICY} ON users;
      CREATE POLICY ${CUSTOM_SELECT_POLICY} ON users
        AS PERMISSIVE
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
      CREATE POLICY ${GENERATED_CONTEXT_GUARD_POLICY} ON users
        AS RESTRICTIVE
        USING (
          NULLIF(current_setting('${CUSTOM_SETTING_KEY}', true), '') IS NOT NULL
        )
        WITH CHECK (
          NULLIF(current_setting('${CUSTOM_SETTING_KEY}', true), '') IS NOT NULL
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

    const PrismaClient = require(path.join(__dirname, 'generated', 'client')).PrismaClient;
    basePrisma = createClient(PrismaClient, APP_URL);
    prisma = basePrisma.$extends(createPrismaTenancyExtension(service));
    await prisma.$connect();
  }, 30000);

  afterAll(async () => {
    try {
      if (basePrisma) await basePrisma.$disconnect();
    } finally {
      try {
        if (moduleRef) await moduleRef.close();
      } finally {
        await sharedAdminClient.query(`
          DROP POLICY IF EXISTS ${GENERATED_CONTEXT_GUARD_POLICY} ON users;
          DROP POLICY IF EXISTS ${CUSTOM_SELECT_GUARD_POLICY} ON users;
          DROP POLICY IF EXISTS ${CUSTOM_SELECT_POLICY} ON users;
          CREATE POLICY ${GENERATED_CONTEXT_GUARD_POLICY} ON users
            AS RESTRICTIVE
            USING (
              NULLIF(current_setting('app.current_tenant', true), '') IS NOT NULL
            )
            WITH CHECK (
              NULLIF(current_setting('app.current_tenant', true), '') IS NOT NULL
            );
        `);
      }
    }
  });

  it('uses the module key for extension tenant A/B and no-context RLS', async () => {
    const tenant1Rows = await context.run(TENANT_1, async () =>
      prisma.user.findMany({ orderBy: { name: 'asc' } }),
    );
    const tenant2Rows = await context.run(TENANT_2, async () =>
      prisma.user.findMany({ orderBy: { name: 'asc' } }),
    );
    const noContextRows = await service.withoutTenant(async () =>
      prisma.user.findMany(),
    );

    expect(tenant1Rows).toHaveLength(2);
    expect(tenant1Rows.every((row: any) => row.tenant_id === TENANT_1)).toBe(true);
    expect(tenant2Rows).toHaveLength(2);
    expect(tenant2Rows.every((row: any) => row.tenant_id === TENANT_2)).toBe(true);
    expect(noContextRows).toHaveLength(0);
  });

  it('uses the module key for helper tenant A/B and leaves no context behind', async () => {
    const findTenantRows = (tenantId: string) =>
      context.run(tenantId, () =>
        tenancyTransaction(basePrisma, service, async (tx: any) =>
          tx.user.findMany({ orderBy: { name: 'asc' } }),
        ),
      );

    const tenant1Rows = await findTenantRows(TENANT_1);
    const tenant2Rows = await findTenantRows(TENANT_2);
    const callback = jest.fn(async () => 'unexpected');

    expect(tenant1Rows).toHaveLength(2);
    expect(tenant1Rows.every((row: any) => row.tenant_id === TENANT_1)).toBe(true);
    expect(tenant2Rows).toHaveLength(2);
    expect(tenant2Rows.every((row: any) => row.tenant_id === TENANT_2)).toBe(true);
    await expect(
      tenancyTransaction(basePrisma, service, callback),
    ).rejects.toThrow(/tenant context/i);
    expect(callback).not.toHaveBeenCalled();
    expect(await basePrisma.user.findMany()).toHaveLength(0);
  });
});

describe('Prisma Extension v0.2.0 Features', () => {
  let context: TenancyContext;
  let service: TenancyService;
  let prisma: any;

  beforeAll(async () => {
    const generatedPath = path.join(__dirname, 'generated', 'client');
    const prismaModule = require(generatedPath);
    const PrismaClient = prismaModule.PrismaClient;

    context = new TenancyContext();
    service = new TenancyService(context);

    const basePrisma = createClient(PrismaClient, APP_URL);
    prisma = basePrisma.$extends(
      createPrismaTenancyExtension(service, {
        autoInjectTenantId: true,
        tenantIdField: 'tenant_id',
        sharedModels: ['Country'],
      }),
    );

    await prisma.$connect();
  }, 30000);

  afterAll(async () => {
    // Cleanup auto-injected rows created by this describe block
    await sharedAdminClient.query(`DELETE FROM users WHERE name = 'AutoInject'`);
    if (prisma) await prisma.$disconnect();
  });

  it('should auto-inject tenant_id on create', async () => {
    const user = await context.run(TENANT_1, async () =>
      prisma.user.create({
        data: { name: 'AutoInject', email: 'auto@test.com' },
      }),
    );

    expect(user.tenant_id).toBe(TENANT_1);
    expect(user.name).toBe('AutoInject');
  });

  it('should read shared table (Country) regardless of tenant context', async () => {
    const countries = await context.run(TENANT_1, async () =>
      prisma.country.findMany(),
    );

    expect(countries).toHaveLength(2);
    expect(countries.map((c: any) => c.code).sort()).toEqual(['KR', 'US']);
  });

  it('should read shared table without tenant context', async () => {
    const countries = await prisma.country.findMany();
    expect(countries).toHaveLength(2);
  });
});

describe('tenancyTransaction() E2E', () => {
  let context: TenancyContext;
  let service: TenancyService;
  let basePrisma: any;

  beforeAll(async () => {
    const PrismaClient = require(path.join(__dirname, 'generated', 'client')).PrismaClient;
    context = new TenancyContext();
    service = new TenancyService(context);
    basePrisma = createClient(PrismaClient, APP_URL);
    await basePrisma.$connect();
  }, 30000);

  afterAll(async () => {
    // Cleanup rows created by this describe block
    await sharedAdminClient.query(`DELETE FROM users WHERE name = 'TxTest'`);
    if (basePrisma) await basePrisma.$disconnect();
  });

  it('should apply RLS inside interactive transaction', async () => {
    const rows = await context.run(TENANT_1, async () =>
      tenancyTransaction(basePrisma, service, async (tx) => {
        return tx.user.findMany();
      }),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r: any) => r.tenant_id === TENANT_1)).toBe(true);
  });

  it('should support writes in interactive transaction', async () => {
    const user = await context.run(TENANT_1, async () =>
      tenancyTransaction(basePrisma, service, async (tx) => {
        return tx.user.create({
          data: { name: 'TxTest', email: 'tx@test.com', tenant_id: TENANT_1 },
        });
      }),
    );
    expect(user.name).toBe('TxTest');
    expect(user.tenant_id).toBe(TENANT_1);
  });

  it('should isolate tenants in interactive transaction', async () => {
    const rows = await context.run(TENANT_2, async () =>
      tenancyTransaction(basePrisma, service, async (tx) => {
        return tx.user.findMany();
      }),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r: any) => r.tenant_id === TENANT_2)).toBe(true);
  });
});

describe('interactiveTransactionSupport E2E', () => {
  let context: TenancyContext;
  let service: TenancyService;
  let prisma: any;

  beforeAll(async () => {
    const PrismaClient = require(path.join(__dirname, 'generated', 'client')).PrismaClient;
    context = new TenancyContext();
    service = new TenancyService(context);

    const basePrisma = createClient(PrismaClient, APP_URL);
    prisma = basePrisma.$extends(
      createPrismaTenancyExtension(service, {
        interactiveTransactionSupport: true,
      }),
    );

    await prisma.$connect();
  }, 30000);

  afterAll(async () => {
    await sharedAdminClient.query(`DELETE FROM users WHERE name = 'ItxTest'`);
    if (prisma) await prisma.$disconnect();
  });

  it('should apply RLS inside interactive transaction with ITX support', async () => {
    const rows = await context.run(TENANT_1, async () =>
      prisma.$transaction(async (tx: any) => {
        return tx.user.findMany();
      }),
    );

    expect(rows).toHaveLength(2);
    expect(rows.every((r: any) => r.tenant_id === TENANT_1)).toBe(true);
  });

  it('should isolate tenants in interactive transaction with ITX support', async () => {
    const rows = await context.run(TENANT_2, async () =>
      prisma.$transaction(async (tx: any) => {
        return tx.user.findMany();
      }),
    );

    expect(rows).toHaveLength(2);
    expect(rows.every((r: any) => r.tenant_id === TENANT_2)).toBe(true);
  });

  it('should support writes in interactive transaction with ITX support', async () => {
    const user = await context.run(TENANT_1, async () =>
      prisma.$transaction(async (tx: any) => {
        return tx.user.create({
          data: { name: 'ItxTest', email: 'itx@test.com', tenant_id: TENANT_1 },
        });
      }),
    );

    expect(user.name).toBe('ItxTest');
    expect(user.tenant_id).toBe(TENANT_1);
  });
});
