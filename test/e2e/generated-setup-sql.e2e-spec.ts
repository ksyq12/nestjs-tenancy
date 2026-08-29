import { Client } from 'pg';
import { generateSetupSql } from '../../src/cli/templates/setup-sql';
import {
  DoctorExitCode,
  DoctorResult,
  runDoctor,
} from '../../src/cli/doctor';
import { quoteSqlIdentifier } from '../../src/postgres-safety';

const ADMIN_URL =
  process.env.DATABASE_URL ??
  'postgresql://tenancy:tenancy@localhost:5433/tenancy_test';
const SCHEMA_NAME = 'tenant\\"ops';
const TABLE_NAME = 'Ledger$tenancy_policy$;archive';
const TENANT_COLUMN = 'tenant"id';
const SCHEMA_SQL = quoteSqlIdentifier(SCHEMA_NAME);
const TABLE_SQL = quoteSqlIdentifier(TABLE_NAME);
const TENANT_COLUMN_SQL = quoteSqlIdentifier(TENANT_COLUMN);
const APP_ROLE = 'app_user';
const APP_URL =
  process.env.APP_DATABASE_URL ??
  'postgresql://app_user:app_user@localhost:5433/tenancy_test';
const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

function expectHealthyDoctor(result: DoctorResult): void {
  expect(result.status).toBe('healthy');
  expect(result.exitCode).toBe(DoctorExitCode.HEALTHY);
  for (const id of [
    'catalog.rls_forced',
    'policy.isolation_contract',
    'policy.insert_contract',
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

describe('generated setup SQL', () => {
  it('applies twice safely to mapped identifiers in disposable PostgreSQL', async () => {
    const client = new Client({ connectionString: ADMIN_URL });
    await client.connect();

    try {
      await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA_SQL} CASCADE`);
      await client.query(`
        CREATE SCHEMA ${SCHEMA_SQL};
        CREATE TABLE ${SCHEMA_SQL}.${TABLE_SQL} (
          id integer PRIMARY KEY,
          ${TENANT_COLUMN_SQL} text NOT NULL
        );
      `);
      await client.query('SET standard_conforming_strings = off');

      const sql = generateSetupSql({
        models: [{
          modelName: 'LedgerEntry',
          schemaName: SCHEMA_NAME,
          tableName: TABLE_NAME,
        }],
        dbSettingKey: 'app.generated_tenant',
        sharedModels: [],
        tenantIdField: TENANT_COLUMN,
      });
      await client.query(sql);

      const initialPolicies = await client.query<{
        oid: string;
        policy_name: string;
      }>(`
        SELECT p.oid::text AS oid, p.polname AS policy_name
        FROM pg_catalog.pg_policy AS p
        JOIN pg_catalog.pg_class AS c ON c.oid = p.polrelid
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2
        ORDER BY p.polname
      `, [SCHEMA_NAME, TABLE_NAME]);
      await client.query(sql);

      const table = await client.query<{
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
        can_select: boolean;
        can_insert: boolean;
        can_update: boolean;
        can_delete: boolean;
      }>(`
        SELECT
          c.relrowsecurity,
          c.relforcerowsecurity,
          pg_catalog.has_table_privilege('app_user', c.oid, 'SELECT') AS can_select,
          pg_catalog.has_table_privilege('app_user', c.oid, 'INSERT') AS can_insert,
          pg_catalog.has_table_privilege('app_user', c.oid, 'UPDATE') AS can_update,
          pg_catalog.has_table_privilege('app_user', c.oid, 'DELETE') AS can_delete
        FROM pg_catalog.pg_class AS c
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2
      `, [SCHEMA_NAME, TABLE_NAME]);
      expect(table.rows).toEqual([{
        relrowsecurity: true,
        relforcerowsecurity: true,
        can_select: true,
        can_insert: true,
        can_update: true,
        can_delete: true,
      }]);

      const schemaGrant = await client.query<{ has_usage: boolean }>(
        `SELECT pg_catalog.has_schema_privilege(
          'app_user', $1, 'USAGE'
        ) AS has_usage`,
        [SCHEMA_NAME],
      );
      expect(schemaGrant.rows[0]?.has_usage).toBe(true);

      const policies = await client.query<{
        oid: string;
        policy_name: string;
      }>(`
        SELECT p.oid::text AS oid, p.polname AS policy_name
        FROM pg_catalog.pg_policy AS p
        JOIN pg_catalog.pg_class AS c ON c.oid = p.polrelid
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2
        ORDER BY p.polname
      `, [SCHEMA_NAME, TABLE_NAME]);
      expect(policies.rows).toEqual(initialPolicies.rows);
      expect(policies.rows.map(({ policy_name }) => policy_name)).toEqual([
        'tenant_context_guard_tenant__ops_ledger_tenancy_po_e35173f6f2dc',
        'tenant_insert_tenant__ops_ledger_tenancy_policy__a_4e1d1fe89a31',
        'tenant_isolation_tenant__ops_ledger_tenancy_policy_919ed50e5791',
      ]);

      const index = await client.query<{ has_tenant_index: boolean }>(`
        SELECT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_index AS i
          JOIN pg_catalog.pg_class AS c ON c.oid = i.indrelid
          JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
          JOIN pg_catalog.pg_attribute AS a
            ON a.attrelid = c.oid
           AND a.attname = $3
           AND a.attnum = ANY(i.indkey)
          WHERE n.nspname = $1 AND c.relname = $2
        ) AS has_tenant_index
      `, [SCHEMA_NAME, TABLE_NAME, TENANT_COLUMN]);
      expect(index.rows[0]?.has_tenant_index).toBe(true);
    } finally {
      try {
        await client.query('ROLLBACK');
        await client.query('RESET standard_conforming_strings');
        await client.query(`DROP SCHEMA IF EXISTS ${SCHEMA_SQL} CASCADE`);
      } finally {
        await client.end();
      }
    }
  });

  it('targets public instead of a search_path shadow and reapplies safely', async () => {
    const shadowSchema = 'generated_m16a_shadow';
    const tableName = 'm16a_search_path_accounts';
    const client = new Client({ connectionString: ADMIN_URL });
    await client.connect();

    try {
      await client.query(`
        DROP TABLE IF EXISTS public.${tableName} CASCADE;
        DROP SCHEMA IF EXISTS ${shadowSchema} CASCADE;
        CREATE SCHEMA ${shadowSchema};
        CREATE TABLE public.${tableName} (
          id integer PRIMARY KEY,
          tenant_id text NOT NULL
        );
        CREATE TABLE ${shadowSchema}.${tableName} (
          id integer PRIMARY KEY,
          tenant_id text NOT NULL
        );
        SET search_path TO ${shadowSchema}, public;
      `);

      const sql = generateSetupSql({
        models: [{
          modelName: 'SearchPathAccount',
          tableName,
        }],
        dbSettingKey: 'app.generated_tenant',
        sharedModels: [],
        tenantIdField: 'tenant_id',
      });
      await client.query(sql);
      await client.query(sql);

      const relations = await client.query<{
        schema_name: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
        policy_count: number;
        can_select: boolean;
      }>(`
        SELECT
          n.nspname AS schema_name,
          c.relrowsecurity,
          c.relforcerowsecurity,
          (
            SELECT count(*)::int
            FROM pg_catalog.pg_policy AS p
            WHERE p.polrelid = c.oid
          ) AS policy_count,
          pg_catalog.has_table_privilege(
            'app_user', c.oid, 'SELECT'
          ) AS can_select
        FROM pg_catalog.pg_class AS c
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname IN ($1, 'public')
          AND c.relname = $2
          AND c.relkind = 'r'
        ORDER BY n.nspname
      `, [shadowSchema, tableName]);
      expect(relations.rows).toEqual([
        {
          schema_name: shadowSchema,
          relrowsecurity: false,
          relforcerowsecurity: false,
          policy_count: 0,
          can_select: false,
        },
        {
          schema_name: 'public',
          relrowsecurity: true,
          relforcerowsecurity: true,
          policy_count: 3,
          can_select: true,
        },
      ]);
    } finally {
      try {
        await client.query('ROLLBACK');
        await client.query('RESET search_path');
        await client.query(`DROP TABLE IF EXISTS public.${tableName} CASCADE`);
        await client.query(`DROP SCHEMA IF EXISTS ${shadowSchema} CASCADE`);
      } finally {
        await client.end();
      }
    }
  });

  it('preserves policy drift on reapply until replacement is explicit', async () => {
    const schemaName = 'generated_m16a';
    const tableName = 'accounts';
    const settingKey = 'app.generated_tenant';
    const isolationPolicy = 'tenant_isolation_generated_m16a_accounts';
    const client = new Client({ connectionString: ADMIN_URL });
    await client.connect();

    try {
      await client.query(`
        DROP SCHEMA IF EXISTS ${schemaName} CASCADE;
        CREATE SCHEMA ${schemaName};
        CREATE TABLE ${schemaName}.${tableName} (
          id integer PRIMARY KEY,
          tenant_id text NOT NULL
        );
        INSERT INTO ${schemaName}.${tableName} (id, tenant_id) VALUES
          (1, '${TENANT_A}'),
          (2, '${TENANT_B}');
      `);

      const sql = generateSetupSql({
        models: [{
          modelName: 'Account',
          schemaName,
          tableName,
        }],
        dbSettingKey: settingKey,
        sharedModels: [],
        tenantIdField: 'tenant_id',
      });

      await client.query(sql);
      const healthyAfterFirstApply = await runDoctor({
        url: APP_URL,
        table: `${schemaName}.${tableName}`,
        role: APP_ROLE,
        dbSettingKey: settingKey,
        active: true,
        tenantA: TENANT_A,
        tenantB: TENANT_B,
      });
      expectHealthyDoctor(healthyAfterFirstApply);

      await client.query(sql);

      const healthyAfterReapply = await runDoctor({
        url: APP_URL,
        table: `${schemaName}.${tableName}`,
        role: APP_ROLE,
        dbSettingKey: settingKey,
        active: true,
        tenantA: TENANT_A,
        tenantB: TENANT_B,
      });
      expectHealthyDoctor(healthyAfterReapply);

      await client.query(
        `ALTER POLICY ${isolationPolicy} ON ${schemaName}.${tableName} USING (true)`,
      );
      await client.query(sql);

      const driftAfterReapply = await runDoctor({
        url: APP_URL,
        table: `${schemaName}.${tableName}`,
        role: APP_ROLE,
        dbSettingKey: settingKey,
      });
      expect(driftAfterReapply.status).toBe('unhealthy');
      expect(driftAfterReapply.exitCode).toBe(DoctorExitCode.FINDINGS);
      expect(driftAfterReapply.checks).toEqual(expect.arrayContaining([
        expect.objectContaining({
          id: 'policy.isolation_contract',
          status: 'fail',
        }),
      ]));

      const explicitReplacementSql = sql.replace(
        '\nBEGIN;\n',
        `\nBEGIN;\nDROP POLICY ${isolationPolicy} ON ${schemaName}.${tableName};\n`,
      );
      expect(explicitReplacementSql).not.toBe(sql);
      await client.query(explicitReplacementSql);

      const healthyAfterExplicitReplacement = await runDoctor({
        url: APP_URL,
        table: `${schemaName}.${tableName}`,
        role: APP_ROLE,
        dbSettingKey: settingKey,
        active: true,
        tenantA: TENANT_A,
        tenantB: TENANT_B,
      });
      expectHealthyDoctor(healthyAfterExplicitReplacement);
    } finally {
      try {
        await client.query('ROLLBACK');
        await client.query(`DROP SCHEMA IF EXISTS generated_m16a CASCADE`);
      } finally {
        await client.end();
      }
    }
  });

  it('applies normalization collisions and long names without generated-name collisions', async () => {
    const schemaName = 'generated_m16b';
    const schemaSql = quoteSqlIdentifier(schemaName);
    const commonPrefix = 'a'.repeat(58);
    const models = [
      { modelName: 'DashedAuditLog', schemaName, tableName: 'audit-logs' },
      { modelName: 'UnderscoredAuditLog', schemaName, tableName: 'audit_logs' },
      { modelName: 'LongAccountA', schemaName, tableName: `${commonPrefix}a` },
      { modelName: 'LongAccountB', schemaName, tableName: `${commonPrefix}b` },
    ];
    const client = new Client({ connectionString: ADMIN_URL });
    await client.connect();

    try {
      await client.query(`DROP SCHEMA IF EXISTS ${schemaSql} CASCADE`);
      await client.query(`CREATE SCHEMA ${schemaSql}`);
      for (const model of models) {
        await client.query(`
          CREATE TABLE ${schemaSql}.${quoteSqlIdentifier(model.tableName)} (
            id integer,
            tenant_id text NOT NULL
          )
        `);
      }

      const sql = generateSetupSql({
        models,
        dbSettingKey: 'app.generated_tenant',
        sharedModels: [],
        tenantIdField: 'tenant_id',
      });
      await client.query(sql);
      await client.query(sql);

      const generatedObjects = await client.query<{
        table_name: string;
        index_names: string[];
        policy_names: string[];
      }>(`
        SELECT
          c.relname AS table_name,
          COALESCE(
            pg_catalog.array_agg(DISTINCT index_class.relname::text)
              FILTER (WHERE index_class.oid IS NOT NULL),
            ARRAY[]::text[]
          ) AS index_names,
          COALESCE(
            pg_catalog.array_agg(DISTINCT p.polname::text)
              FILTER (WHERE p.oid IS NOT NULL),
            ARRAY[]::text[]
          ) AS policy_names
        FROM pg_catalog.pg_class AS c
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        LEFT JOIN pg_catalog.pg_index AS i ON i.indrelid = c.oid
        LEFT JOIN pg_catalog.pg_class AS index_class ON index_class.oid = i.indexrelid
        LEFT JOIN pg_catalog.pg_policy AS p ON p.polrelid = c.oid
        WHERE n.nspname = $1
          AND c.relname = ANY($2::text[])
          AND c.relkind = 'r'
        GROUP BY c.relname
        ORDER BY c.relname
      `, [schemaName, models.map((model) => model.tableName)]);

      expect(generatedObjects.rows).toHaveLength(models.length);
      expect(generatedObjects.rows.every(
        ({ index_names, policy_names }) =>
          index_names.length === 1 && policy_names.length === 3,
      )).toBe(true);

      const indexNames = generatedObjects.rows.flatMap(({ index_names }) => index_names);
      const policyNames = generatedObjects.rows.flatMap(({ policy_names }) => policy_names);
      expect(new Set(indexNames).size).toBe(models.length);
      expect(new Set(policyNames).size).toBe(models.length * 3);
      expect([...indexNames, ...policyNames].every(
        (identifier) => Buffer.byteLength(identifier, 'utf8') <= 63,
      )).toBe(true);

      for (const model of models) {
        const doctor = await runDoctor({
          url: APP_URL,
          table: `${schemaName}.${model.tableName}`,
          role: APP_ROLE,
          dbSettingKey: 'app.generated_tenant',
        });
        expect(doctor.status).toBe('healthy');
        expect(doctor.checks).toEqual(expect.arrayContaining([
          expect.objectContaining({
            id: 'policy.isolation_exists',
            status: 'pass',
          }),
          expect.objectContaining({
            id: 'policy.insert_exists',
            status: 'pass',
          }),
        ]));
      }
    } finally {
      try {
        await client.query('ROLLBACK');
        await client.query(`DROP SCHEMA IF EXISTS ${schemaSql} CASCADE`);
      } finally {
        await client.end();
      }
    }
  });

  it('rolls back earlier generated changes when a later model fails', async () => {
    const schemaName = 'generated_m16a_rollback';
    const readyTable = 'ready_accounts';
    const missingModelMarker = '\n-- MissingAccount\n';
    const client = new Client({ connectionString: ADMIN_URL });
    await client.connect();

    try {
      await client.query(`
        DROP SCHEMA IF EXISTS ${schemaName} CASCADE;
        CREATE SCHEMA ${schemaName};
        CREATE TABLE ${schemaName}.${readyTable} (
          id integer,
          tenant_id text NOT NULL
        );
      `);

      const sql = generateSetupSql({
        models: [
          {
            modelName: 'ReadyAccount',
            schemaName,
            tableName: readyTable,
          },
          {
            modelName: 'MissingAccount',
            schemaName,
            tableName: 'missing_accounts',
          },
        ],
        dbSettingKey: 'app.generated_tenant',
        sharedModels: [],
        tenantIdField: 'tenant_id',
      });
      const failureStart = sql.indexOf(missingModelMarker);
      expect(failureStart).toBeGreaterThan(0);

      await client.query(sql.slice(0, failureStart));
      await expect(client.query(sql.slice(failureStart))).rejects.toThrow(
        /missing_accounts.+does not exist/i,
      );
      await client.query('ROLLBACK');

      const table = await client.query<{
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
        can_select: boolean;
      }>(`
        SELECT
          c.relrowsecurity,
          c.relforcerowsecurity,
          pg_catalog.has_table_privilege(
            'app_user', c.oid, 'SELECT'
          ) AS can_select
        FROM pg_catalog.pg_class AS c
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2
      `, [schemaName, readyTable]);
      expect(table.rows).toEqual([{
        relrowsecurity: false,
        relforcerowsecurity: false,
        can_select: false,
      }]);

      const generatedObjects = await client.query<{ object_count: string }>(`
        SELECT (
          SELECT count(*)
          FROM pg_catalog.pg_policy AS p
          JOIN pg_catalog.pg_class AS c ON c.oid = p.polrelid
          JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relname = $2
        ) + (
          SELECT count(*)
          FROM pg_catalog.pg_index AS i
          JOIN pg_catalog.pg_class AS c ON c.oid = i.indrelid
          JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
          WHERE n.nspname = $1 AND c.relname = $2
        ) AS object_count
      `, [schemaName, readyTable]);
      expect(generatedObjects.rows[0]?.object_count).toBe('0');

      const schemaGrant = await client.query<{ has_usage: boolean }>(`
        SELECT pg_catalog.has_schema_privilege(
          'app_user', $1, 'USAGE'
        ) AS has_usage
      `, [schemaName]);
      expect(schemaGrant.rows[0]?.has_usage).toBe(false);
    } finally {
      try {
        await client.query('ROLLBACK');
        await client.query(
          `DROP SCHEMA IF EXISTS generated_m16a_rollback CASCADE`,
        );
      } finally {
        await client.end();
      }
    }
  });
});
