import { Client } from 'pg';
import * as path from 'path';
import * as fs from 'fs';
import { TenancyContext } from '../../src/services/tenancy-context';
import { TenancyService } from '../../src/services/tenancy.service';
import { createPrismaTenancyExtension } from '../../src/prisma/prisma-tenancy.extension';
import { tenancyTransaction } from '../../src/prisma/tenancy-transaction';

const TENANT_1 = '11111111-1111-1111-1111-111111111111';
const TENANT_2 = '22222222-2222-2222-2222-222222222222';

const ADMIN_URL =
  process.env.DATABASE_URL ?? 'postgresql://tenancy:tenancy@localhost:5433/tenancy_test';
const APP_URL =
  process.env.APP_DATABASE_URL ?? 'postgresql://app_user:app_user@localhost:5433/tenancy_test';

/**
 * E2E test that verifies the Prisma extension actually applies RLS.
 *
 * This is the critical test that was missing: it proves that
 * createPrismaTenancyExtension + real PrismaClient + real PostgreSQL
 * correctly isolates tenant data via set_config() in batch transactions.
 */
describe('Prisma Extension + RLS Integration', () => {
  let adminClient: Client;
  let context: TenancyContext;
  let service: TenancyService;
  let PrismaClient: any;
  let prisma: any;

  beforeAll(async () => {
    // 1. Run setup SQL as superuser
    adminClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();

    const setupSql = fs.readFileSync(
      path.join(__dirname, 'setup.sql'),
      'utf-8',
    );
    await adminClient.query(setupSql);

    // 2. Import the generated Prisma client (prisma generate runs before jest via test:e2e script)
    const generatedPath = path.join(__dirname, 'generated');
    const prismaModule = require(generatedPath);
    PrismaClient = prismaModule.PrismaClient;

    // 4. Create extended Prisma client as app_user (RLS applies)
    context = new TenancyContext();
    service = new TenancyService(context);

    const basePrisma = new PrismaClient({
      datasourceUrl: APP_URL,
    });

    prisma = basePrisma.$extends(createPrismaTenancyExtension(service));

    await prisma.$connect();
  }, 30000);

  afterAll(async () => {
    if (prisma) await prisma.$disconnect();
    await adminClient.query('DROP TABLE IF EXISTS users CASCADE');
    await adminClient.query('DROP TABLE IF EXISTS countries CASCADE');
    await adminClient.end();
  });

  it('should return only tenant 1 rows through Prisma extension', async () => {
    const rows = await new Promise<any[]>((resolve, reject) => {
      context.run(TENANT_1, async () => {
        try {
          resolve(await prisma.user.findMany());
        } catch (e) {
          reject(e);
        }
      });
    });

    expect(rows).toHaveLength(2);
    expect(rows.every((r: any) => r.tenant_id === TENANT_1)).toBe(true);
    expect(rows.map((r: any) => r.name).sort()).toEqual(['Alice', 'Bob']);
  });

  it('should return only tenant 2 rows through Prisma extension', async () => {
    const rows = await new Promise<any[]>((resolve, reject) => {
      context.run(TENANT_2, async () => {
        try {
          resolve(await prisma.user.findMany());
        } catch (e) {
          reject(e);
        }
      });
    });

    expect(rows).toHaveLength(2);
    expect(rows.every((r: any) => r.tenant_id === TENANT_2)).toBe(true);
  });

  it('should return no rows without tenant context (RLS blocks)', async () => {
    // No context.run — getCurrentTenant() returns null — query passes through
    // RLS policy: tenant_id = current_setting('app.current_tenant', true)
    // With no setting, current_setting returns '' which matches no rows
    const rows = await prisma.user.findMany();
    expect(rows).toHaveLength(0);
  });

  it('should skip set_config when using withoutTenant()', async () => {
    const rows = await service.withoutTenant(async () => {
      return prisma.user.findMany();
    });

    // withoutTenant() makes tenantId null, extension skips set_config
    // RLS still applies (app_user role) — empty current_setting matches no rows
    expect(rows).toHaveLength(0);
  });

  it('should isolate tenants in concurrent requests', async () => {
    const [rows1, rows2] = await Promise.all([
      new Promise<any[]>((resolve, reject) => {
        context.run(TENANT_1, async () => {
          try {
            resolve(await prisma.user.findMany());
          } catch (e) {
            reject(e);
          }
        });
      }),
      new Promise<any[]>((resolve, reject) => {
        context.run(TENANT_2, async () => {
          try {
            resolve(await prisma.user.findMany());
          } catch (e) {
            reject(e);
          }
        });
      }),
    ]);

    expect(rows1.every((r: any) => r.tenant_id === TENANT_1)).toBe(true);
    expect(rows2.every((r: any) => r.tenant_id === TENANT_2)).toBe(true);
    expect(rows1).toHaveLength(2);
    expect(rows2).toHaveLength(2);
  });
});

describe('Prisma Extension v0.2.0 Features', () => {
  let adminClient: Client;
  let context: TenancyContext;
  let service: TenancyService;
  let prisma: any;

  beforeAll(async () => {
    adminClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();

    const setupSql = fs.readFileSync(path.join(__dirname, 'setup.sql'), 'utf-8');
    await adminClient.query(setupSql);

    const generatedPath = path.join(__dirname, 'generated');
    const prismaModule = require(generatedPath);
    const PrismaClient = prismaModule.PrismaClient;

    context = new TenancyContext();
    service = new TenancyService(context);

    const basePrisma = new PrismaClient({ datasourceUrl: APP_URL });
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
    // Cleanup auto-injected rows
    await adminClient.query(`DELETE FROM users WHERE name = 'AutoInject'`);
    if (prisma) await prisma.$disconnect();
    await adminClient.end();
  });

  it('should auto-inject tenant_id on create', async () => {
    const user = await new Promise<any>((resolve, reject) => {
      context.run(TENANT_1, async () => {
        try {
          resolve(
            await prisma.user.create({
              data: { name: 'AutoInject', email: 'auto@test.com' },
            }),
          );
        } catch (e) {
          reject(e);
        }
      });
    });

    expect(user.tenant_id).toBe(TENANT_1);
    expect(user.name).toBe('AutoInject');
  });

  it('should read shared table (Country) regardless of tenant context', async () => {
    const countries = await new Promise<any[]>((resolve, reject) => {
      context.run(TENANT_1, async () => {
        try {
          resolve(await prisma.country.findMany());
        } catch (e) {
          reject(e);
        }
      });
    });

    expect(countries).toHaveLength(2);
    expect(countries.map((c: any) => c.code).sort()).toEqual(['KR', 'US']);
  });

  it('should read shared table without tenant context', async () => {
    const countries = await prisma.country.findMany();
    expect(countries).toHaveLength(2);
  });
});

describe('tenancyTransaction() E2E', () => {
  let adminClient: Client;
  let context: TenancyContext;
  let service: TenancyService;
  let basePrisma: any;

  beforeAll(async () => {
    adminClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();
    const setupSql = fs.readFileSync(path.join(__dirname, 'setup.sql'), 'utf-8');
    await adminClient.query(setupSql);

    const PrismaClient = require(path.join(__dirname, 'generated')).PrismaClient;
    context = new TenancyContext();
    service = new TenancyService(context);
    basePrisma = new PrismaClient({ datasourceUrl: APP_URL });
    await basePrisma.$connect();
  }, 30000);

  afterAll(async () => {
    await adminClient.query(`DELETE FROM users WHERE name = 'TxTest'`);
    if (basePrisma) await basePrisma.$disconnect();
    await adminClient.end();
  });

  it('should apply RLS inside interactive transaction', async () => {
    const rows = await new Promise<any[]>((resolve, reject) => {
      context.run(TENANT_1, async () => {
        try {
          resolve(await tenancyTransaction(basePrisma, service, async (tx) => {
            return tx.user.findMany();
          }));
        } catch (e) { reject(e); }
      });
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r: any) => r.tenant_id === TENANT_1)).toBe(true);
  });

  it('should support writes in interactive transaction', async () => {
    const user = await new Promise<any>((resolve, reject) => {
      context.run(TENANT_1, async () => {
        try {
          resolve(await tenancyTransaction(basePrisma, service, async (tx) => {
            return tx.user.create({
              data: { name: 'TxTest', email: 'tx@test.com', tenant_id: TENANT_1 },
            });
          }));
        } catch (e) { reject(e); }
      });
    });
    expect(user.name).toBe('TxTest');
    expect(user.tenant_id).toBe(TENANT_1);
  });

  it('should isolate tenants in interactive transaction', async () => {
    const rows = await new Promise<any[]>((resolve, reject) => {
      context.run(TENANT_2, async () => {
        try {
          resolve(await tenancyTransaction(basePrisma, service, async (tx) => {
            return tx.user.findMany();
          }));
        } catch (e) { reject(e); }
      });
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r: any) => r.tenant_id === TENANT_2)).toBe(true);
  });
});
