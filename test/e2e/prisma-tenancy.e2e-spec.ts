import { Client } from 'pg';
import { TenancyContext } from '../../src/services/tenancy-context';
import { TenancyService } from '../../src/services/tenancy.service';

const TENANT_1 = '11111111-1111-1111-1111-111111111111';
const TENANT_2 = '22222222-2222-2222-2222-222222222222';
const TENANT_3 = '33333333-3333-3333-3333-333333333333';
const APP_ROLE = 'app_user';

// Non-superuser connection — RLS applies to this role
const APP_URL =
  process.env.APP_DATABASE_URL ?? 'postgresql://app_user:app_user@localhost:5433/tenancy_test';

async function selectUsersForTenant(client: Client, tenantId: string) {
  await client.query('BEGIN');

  try {
    await client.query(
      `SELECT set_config('app.current_tenant', $1, true)`,
      [tenantId],
    );
    const result = await client.query<{
      tenant_id: string;
      name: string;
    }>('SELECT tenant_id, name FROM users ORDER BY name');
    await client.query('COMMIT');
    return result.rows;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

/**
 * E2E tests verifying PostgreSQL RLS with real database.
 *
 * Setup/teardown handled by global-setup.ts / global-teardown.ts.
 * Key: RLS only applies to non-superuser roles. We use:
 * - `tenancy` (superuser) for setup/teardown (global)
 * - `app_user` (non-superuser) for all RLS queries
 */
describe('PostgreSQL RLS Integration', () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: APP_URL });
    await client.connect();
  });

  afterAll(async () => {
    await client.end();
  });

  it('should fail closed for app_user without tenant context', async () => {
    // Use a fresh connection that has never set the custom PostgreSQL setting.
    const noContextClient = new Client({ connectionString: APP_URL });
    await noContextClient.connect();

    try {
      const identity = await noContextClient.query<{
        role_name: string;
        tenant_id: string | null;
        rolsuper: boolean;
        rolbypassrls: boolean;
      }>(
        `SELECT current_user AS role_name,
                current_setting('app.current_tenant', true) AS tenant_id,
                role_info.rolsuper,
                role_info.rolbypassrls
           FROM pg_roles AS role_info
          WHERE role_info.rolname = current_user`,
      );
      expect(identity.rows[0]).toEqual({
        role_name: APP_ROLE,
        tenant_id: null,
        rolsuper: false,
        rolbypassrls: false,
      });

      const visible = await noContextClient.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM users',
      );
      expect(visible.rows[0].count).toBe(0);

      await expect(
        noContextClient.query(
          `INSERT INTO users (tenant_id, name, email)
           VALUES ($1, 'NoContext', 'no-context@bypass-test.com')`,
          [TENANT_1],
        ),
      ).rejects.toMatchObject({
        code: '42501',
        message: expect.stringMatching(/row-level security/i),
      });
    } finally {
      await noContextClient.end();
    }
  });

  it('should actively isolate tenant A and tenant B for app_user', async () => {
    const tenantARows = await selectUsersForTenant(client, TENANT_1);
    const tenantBRows = await selectUsersForTenant(client, TENANT_2);

    expect(tenantARows).toEqual([
      { tenant_id: TENANT_1, name: 'Alice' },
      { tenant_id: TENANT_1, name: 'Bob' },
    ]);
    expect(tenantBRows).toEqual([
      { tenant_id: TENANT_2, name: 'Charlie' },
      { tenant_id: TENANT_2, name: 'Diana' },
    ]);
  });

  it('should return only tenant 3 rows (single row)', async () => {
    await client.query('BEGIN');
    await client.query(`SET LOCAL "app.current_tenant" = '${TENANT_3}'`);
    const result = await client.query('SELECT * FROM users');
    await client.query('COMMIT');

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].name).toBe('Eve');
  });

  it('should return no rows without SET LOCAL (RLS enforced)', async () => {
    const result = await client.query('SELECT * FROM users');
    expect(result.rows).toHaveLength(0);
  });

  it('should not leak tenant context after COMMIT', async () => {
    await client.query('BEGIN');
    await client.query(`SET LOCAL "app.current_tenant" = '${TENANT_1}'`);
    const during = await client.query('SELECT count(*) as cnt FROM users');
    await client.query('COMMIT');

    expect(parseInt(during.rows[0].cnt)).toBe(2);

    // After commit, SET LOCAL is gone — no rows visible
    const after = await client.query('SELECT count(*) as cnt FROM users');
    expect(parseInt(after.rows[0].cnt)).toBe(0);
  });

  it('should isolate concurrent transactions', async () => {
    const client2 = new Client({ connectionString: APP_URL });
    await client2.connect();

    await client.query('BEGIN');
    await client.query(`SET LOCAL "app.current_tenant" = '${TENANT_1}'`);

    await client2.query('BEGIN');
    await client2.query(`SET LOCAL "app.current_tenant" = '${TENANT_2}'`);

    const result1 = await client.query('SELECT * FROM users');
    const result2 = await client2.query('SELECT * FROM users');

    await client.query('COMMIT');
    await client2.query('COMMIT');
    await client2.end();

    expect(result1.rows.every((r: any) => r.tenant_id === TENANT_1)).toBe(true);
    expect(result2.rows.every((r: any) => r.tenant_id === TENANT_2)).toBe(true);
    expect(result1.rows).toHaveLength(2);
    expect(result2.rows).toHaveLength(2);
  });
});

describe('TenancyContext + RLS Integration', () => {
  let client: Client;
  let context: TenancyContext;
  let service: TenancyService;

  beforeAll(async () => {
    client = new Client({ connectionString: APP_URL });
    await client.connect();
    context = new TenancyContext();
    service = new TenancyService(context);
  });

  afterAll(async () => {
    await client.end();
  });

  it('should use TenancyService tenant in SET LOCAL', async () => {
    await context.run(TENANT_1, async () => {
      const tenantId = service.getCurrentTenantOrThrow();

      await client.query('BEGIN');
      await client.query(
        `SET LOCAL "app.current_tenant" = '${tenantId}'`,
      );
      const result = await client.query('SELECT * FROM users');
      await client.query('COMMIT');

      expect(result.rows).toHaveLength(2);
      expect(
        result.rows.every((r: any) => r.tenant_id === TENANT_1),
      ).toBe(true);
    });
  });

  it('should return null tenant outside context', () => {
    expect(service.getCurrentTenant()).toBeNull();
  });
});

/**
 * RLS bypass attempt tests.
 *
 * These tests verify that RLS policies actively BLOCK unauthorized operations,
 * not just that isolation works in the happy path.
 */
describe('RLS Bypass Attempts', () => {
  let client: Client;
  let adminClient: Client;

  const ADMIN_URL =
    process.env.DATABASE_URL ?? 'postgresql://tenancy:tenancy@localhost:5433/tenancy_test';

  beforeAll(async () => {
    client = new Client({ connectionString: APP_URL });
    await client.connect();
    adminClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();
  });

  afterAll(async () => {
    // Cleanup any rows created by bypass tests
    await adminClient.query(`DELETE FROM users WHERE email LIKE '%@bypass-test.com'`);
    await adminClient.end();
    await client.end();
  });

  it('should reject INSERT with a different tenant_id than current context', async () => {
    await client.query('BEGIN');
    await client.query(`SET LOCAL "app.current_tenant" = '${TENANT_1}'`);

    // Attempt to insert a row with TENANT_2's tenant_id while in TENANT_1 context
    try {
      await client.query(
        `INSERT INTO users (tenant_id, name, email) VALUES ($1, 'Hacker', 'hacker@bypass-test.com')`,
        [TENANT_2],
      );
      await client.query('COMMIT');
      // If we get here, the insert was not blocked — fail the test
      fail('INSERT with mismatched tenant_id should have been rejected by RLS');
    } catch (e: any) {
      await client.query('ROLLBACK');
      // RLS policy violation
      expect(e.message).toMatch(/row-level security/i);
    }
  });

  it('should not UPDATE rows belonging to another tenant', async () => {
    await client.query('BEGIN');
    await client.query(`SET LOCAL "app.current_tenant" = '${TENANT_1}'`);

    // Attempt to update TENANT_2's rows — RLS should filter them out
    const result = await client.query(
      `UPDATE users SET name = 'Hacked' WHERE tenant_id = $1 RETURNING *`,
      [TENANT_2],
    );
    await client.query('COMMIT');

    // UPDATE succeeds but affects 0 rows — TENANT_2's rows are invisible
    expect(result.rowCount).toBe(0);

    // Verify TENANT_2's data is untouched (via superuser)
    const check = await adminClient.query(
      `SELECT name FROM users WHERE tenant_id = $1`,
      [TENANT_2],
    );
    expect(check.rows.every((r: any) => r.name !== 'Hacked')).toBe(true);
  });

  it('should not DELETE rows belonging to another tenant', async () => {
    await client.query('BEGIN');
    await client.query(`SET LOCAL "app.current_tenant" = '${TENANT_1}'`);

    // Attempt to delete TENANT_2's rows
    const result = await client.query(
      `DELETE FROM users WHERE tenant_id = $1 RETURNING *`,
      [TENANT_2],
    );
    await client.query('COMMIT');

    // DELETE succeeds but affects 0 rows
    expect(result.rowCount).toBe(0);

    // Verify TENANT_2's rows still exist
    const check = await adminClient.query(
      `SELECT count(*)::int as cnt FROM users WHERE tenant_id = $1`,
      [TENANT_2],
    );
    expect(check.rows[0].cnt).toBe(2);
  });

  it('should return no rows when tenant_id contains SQL injection attempt', async () => {
    await client.query('BEGIN');
    // set_config supports parameterized values — safe from SQL injection
    await client.query(
      `SELECT set_config('app.current_tenant', $1, true)`,
      ["' OR '1'='1"],
    );
    const result = await client.query('SELECT * FROM users');
    await client.query('COMMIT');

    // SQL injection string is treated as a literal tenant_id — matches no rows
    expect(result.rows).toHaveLength(0);
  });

  it('should enforce FORCE ROW LEVEL SECURITY for the actual table owner', async () => {
    const fixture = await adminClient.query<{
      table_owner: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
      rolsuper: boolean;
      rolbypassrls: boolean;
    }>(
      `SELECT owner.rolname AS table_owner,
              table_info.relrowsecurity,
              table_info.relforcerowsecurity,
              owner.rolsuper,
              owner.rolbypassrls
         FROM pg_class AS table_info
         JOIN pg_roles AS owner ON owner.oid = table_info.relowner
        WHERE table_info.oid = 'public.force_owner_users'::regclass`,
    );
    expect(fixture.rows[0]).toEqual({
      table_owner: APP_ROLE,
      relrowsecurity: true,
      relforcerowsecurity: true,
      rolsuper: false,
      rolbypassrls: false,
    });

    // The superuser confirms the fixture contains rows; a fresh app_user
    // connection then exercises queries as the actual table owner.
    const adminResult = await adminClient.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM force_owner_users',
    );
    expect(adminResult.rows[0].count).toBe(4);

    const ownerClient = new Client({ connectionString: APP_URL });
    await ownerClient.connect();
    try {
      const identity = await ownerClient.query<{ role_name: string }>(
        'SELECT current_user AS role_name',
      );
      expect(identity.rows[0].role_name).toBe(APP_ROLE);

      const withoutContext = await ownerClient.query<{ count: number }>(
        'SELECT count(*)::int AS count FROM force_owner_users',
      );
      expect(withoutContext.rows[0].count).toBe(0);

      await ownerClient.query('BEGIN');
      try {
        await ownerClient.query(
          `SELECT set_config('app.current_tenant', $1, true)`,
          [TENANT_1],
        );
        const tenantRows = await ownerClient.query<{
          tenant_id: string;
          name: string;
        }>('SELECT tenant_id, name FROM force_owner_users ORDER BY name');
        expect(tenantRows.rows).toEqual([
          { tenant_id: TENANT_1, name: 'Owner Alice' },
          { tenant_id: TENANT_1, name: 'Owner Bob' },
        ]);
        await ownerClient.query('COMMIT');
      } catch (error) {
        await ownerClient.query('ROLLBACK');
        throw error;
      }
    } finally {
      await ownerClient.end();
    }
  });
});
