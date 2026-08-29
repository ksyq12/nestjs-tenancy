import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Client } from 'pg';

jest.mock('prompts', () => jest.fn());

import { runInit } from '../../src/cli/init';
import { runCheck } from '../../src/cli/check';
import {
  DoctorExitCode,
  DoctorResult,
  runDoctor,
} from '../../src/cli/doctor';

const ADMIN_URL =
  process.env.DATABASE_URL ??
  'postgresql://tenancy:tenancy@localhost:5433/tenancy_test';
const APP_URL =
  process.env.APP_DATABASE_URL ??
  'postgresql://app_user:app_user@localhost:5433/tenancy_test';
const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

function expectHealthyDoctor(result: DoctorResult): void {
  expect(result.status).toBe('healthy');
  expect(result.exitCode).toBe(DoctorExitCode.HEALTHY);
  for (const id of [
    'catalog.tenant_column_type',
    'policy.isolation_contract',
    'policy.insert_contract',
    'policy.context_guard_contract',
    'probe.no_context',
    'probe.tenant_a',
    'probe.cleanup_after_commit',
    'probe.tenant_b',
    'probe.cleanup_after_rollback',
  ]) {
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id, status: 'pass' }),
    ]));
  }
}

describe('CLI init tenant column policy types', () => {
  const prompts = require('prompts') as jest.Mock;

  beforeEach(() => {
    prompts.mockReset();
    prompts.mockResolvedValue({
      extractor: 'Header (X-Tenant-Id)',
      tenantFormat: 'UUID',
      dbSettingKey: 'app.generated_tenant',
      autoInject: true,
      sharedModels: '',
    });
  });

  it.each([
    {
      label: 'TEXT',
      schemaName: 'generated_m17_text',
      prismaType: 'String',
      postgresType: 'text',
      seedEmptyTenant: true,
      expectedPredicate:
        `"tenant_id" = current_setting('app.generated_tenant', true)::text`,
    },
    {
      label: 'UUID',
      schemaName: 'generated_m17_uuid',
      prismaType: 'String @db.Uuid',
      postgresType: 'uuid',
      seedEmptyTenant: false,
      expectedPredicate:
        `"tenant_id" = NULLIF(current_setting('app.generated_tenant', true), '')::uuid`,
    },
  ])(
    'runs init, applies SQL, and verifies $label isolation with doctor',
    async ({
      schemaName,
      prismaType,
      postgresType,
      seedEmptyTenant,
      expectedPredicate,
    }) => {
      const tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'tenancy-m17-init-'),
      );
      const admin = new Client({ connectionString: ADMIN_URL });
      await admin.connect();

      try {
        fs.writeFileSync(
          path.join(tmpDir, 'schema.prisma'),
          `datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Account {
  id       Int    @id
  tenantId ${prismaType} @map("tenant_id")
  name     String

  @@map("accounts")
  @@schema("${schemaName}")
}
`,
          'utf-8',
        );

        await admin.query(`
          DROP SCHEMA IF EXISTS ${schemaName} CASCADE;
          CREATE SCHEMA ${schemaName};
          CREATE TABLE ${schemaName}.accounts (
            id integer PRIMARY KEY,
            tenant_id ${postgresType} NOT NULL,
            name text NOT NULL
          );
          INSERT INTO ${schemaName}.accounts (id, tenant_id, name) VALUES
            (1, '${TENANT_A}', 'Tenant A'),
            (2, '${TENANT_B}', 'Tenant B')
            ${seedEmptyTenant ? ", (3, '', 'Empty tenant')" : ''};
        `);

        await expect(runInit({ cwd: tmpDir })).resolves.toBe('completed');
        const sql = fs.readFileSync(
          path.join(tmpDir, 'tenancy-setup.sql'),
          'utf-8',
        );
        const moduleSetup = fs.readFileSync(
          path.join(tmpDir, 'tenancy.module-setup.ts'),
          'utf-8',
        );
        expect(moduleSetup).toContain('tenantIdField: "tenantId"');
        expect(runCheck({
          cwd: tmpDir,
          dbSettingKey: 'app.generated_tenant',
        }).inSync).toBe(true);
        await admin.query(sql);
        expect(sql).toContain(expectedPredicate);
        expect(sql).toContain(
          `NULLIF(current_setting('app.generated_tenant', true), '') IS NOT NULL`,
        );

        const doctor = await runDoctor({
          url: APP_URL,
          table: `${schemaName}.accounts`,
          role: 'app_user',
          dbSettingKey: 'app.generated_tenant',
          active: true,
          tenantA: TENANT_A,
          tenantB: TENANT_B,
        });
        expectHealthyDoctor(doctor);

        if (seedEmptyTenant) {
          const app = new Client({ connectionString: APP_URL });
          await app.connect();
          try {
            await app.query('BEGIN');
            await app.query(
              'SELECT set_config($1, $2, true)',
              ['app.generated_tenant', TENANT_A],
            );
            await app.query('COMMIT');
            const resetSetting = await app.query<{ setting: string | null }>(
              `SELECT current_setting('app.generated_tenant', true) AS setting`,
            );
            expect(resetSetting.rows[0]?.setting).toBe('');
            await expect(app.query(
              `SELECT id FROM ${schemaName}.accounts ORDER BY id`,
            )).resolves.toEqual(expect.objectContaining({ rows: [] }));
            await expect(app.query(
              `INSERT INTO ${schemaName}.accounts (id, tenant_id, name) ` +
              `VALUES (4, '', 'No context insert')`,
            )).rejects.toMatchObject({ code: '42501' });
          } finally {
            await app.end();
          }
        }
      } finally {
        try {
          await admin.query('ROLLBACK');
          await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
        } finally {
          await admin.end();
          fs.rmSync(tmpDir, { recursive: true, force: true });
        }
      }
    },
  );
});
