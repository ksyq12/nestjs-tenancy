import { Client } from 'pg';
import { generateSetupSql } from '../../src/cli/templates/setup-sql';

const ADMIN_URL =
  process.env.DATABASE_URL ??
  'postgresql://tenancy:tenancy@localhost:5433/tenancy_test';
const SCHEMA_NAME = 'tenant"ops';
const TABLE_NAME = 'ledger;archive';
const TENANT_COLUMN = 'tenant"id';

describe('generated setup SQL', () => {
  it('applies safely to mapped identifiers in disposable PostgreSQL', async () => {
    const client = new Client({ connectionString: ADMIN_URL });
    await client.connect();

    try {
      await client.query('DROP SCHEMA IF EXISTS "tenant""ops" CASCADE');
      await client.query(`
        CREATE SCHEMA "tenant""ops";
        CREATE TABLE "tenant""ops"."ledger;archive" (
          id integer PRIMARY KEY,
          "tenant""id" text NOT NULL
        );
      `);

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

      const policies = await client.query<{ policy_name: string }>(`
        SELECT p.polname AS policy_name
        FROM pg_catalog.pg_policy AS p
        JOIN pg_catalog.pg_class AS c ON c.oid = p.polrelid
        JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
        WHERE n.nspname = $1 AND c.relname = $2
        ORDER BY p.polname
      `, [SCHEMA_NAME, TABLE_NAME]);
      expect(policies.rows.map(({ policy_name }) => policy_name)).toEqual([
        'tenant_insert_tenant_ops_ledger_archive',
        'tenant_isolation_tenant_ops_ledger_archive',
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
        await client.query('DROP SCHEMA IF EXISTS "tenant""ops" CASCADE');
      } finally {
        await client.end();
      }
    }
  });
});
