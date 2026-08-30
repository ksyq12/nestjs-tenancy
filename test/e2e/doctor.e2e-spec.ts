import { Client } from 'pg';
import {
  DoctorCheck,
  DoctorClient,
  DoctorExitCode,
  DoctorResult,
  formatDoctorBatchResult,
  formatDoctorResult,
  runDoctor,
  runDoctorBatch,
} from '../../src/cli/doctor';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const APP_ROLE = 'app_user';
const APP_URL =
  process.env.APP_DATABASE_URL ??
  'postgresql://app_user:app_user@localhost:5433/tenancy_test';
const ADMIN_URL =
  process.env.DATABASE_URL ??
  'postgresql://tenancy:tenancy@localhost:5433/tenancy_test';

function check(result: DoctorResult, id: string): DoctorCheck {
  const found = result.checks.find((candidate) => candidate.id === id);
  expect(found).toBeDefined();
  return found as DoctorCheck;
}

describe('live PostgreSQL doctor', () => {
  it('reports the generated users catalog contract as healthy', async () => {
    const result = await runDoctor({
      url: APP_URL,
      table: 'public.users',
      role: APP_ROLE,
    });

    expect(result).toEqual(expect.objectContaining({
      schemaVersion: 1,
      status: 'healthy',
      exitCode: DoctorExitCode.HEALTHY,
      target: {
        schema: 'public',
        table: 'users',
        role: APP_ROLE,
        settingKey: 'app.current_tenant',
        tenantColumn: 'tenant_id',
        activeProbe: false,
      },
    }));
    expect(result.error).toBeUndefined();
    expect(result.summary.failed).toBe(0);
    expect(result.summary.warnings).toBe(0);
    expect(result.checks.filter(({ status }) => status === 'fail' || status === 'warn')).toEqual([]);
    expect(check(result, 'session.current_role')).toEqual(expect.objectContaining({
      status: 'pass',
      details: { currentUser: APP_ROLE, sessionUser: APP_ROLE },
    }));
    expect(check(result, 'catalog.rls_forced').status).toBe('pass');
    expect(check(result, 'policy.isolation_contract').status).toBe('pass');
    expect(check(result, 'policy.insert_contract').status).toBe('pass');
    expect(check(result, 'probe.active').status).toBe('skip');

    const json = formatDoctorResult(result, true);
    const parsed = JSON.parse(json) as DoctorResult;
    expect(parsed).toEqual(result);
    expect(Object.keys(parsed)).toEqual([
      'schemaVersion',
      'status',
      'exitCode',
      'target',
      'summary',
      'checks',
    ]);
    expect(Object.keys(parsed.summary)).toEqual([
      'passed',
      'failed',
      'warnings',
      'skipped',
    ]);
    expect(json).not.toContain('app_user:app_user');
  });

  it('passes no-context, tenant A/B, and transaction cleanup probes', async () => {
    const result = await runDoctor({
      url: APP_URL,
      table: 'public.users',
      role: APP_ROLE,
      active: true,
      tenantA: TENANT_A,
      tenantB: TENANT_B,
    });

    expect(result.status).toBe('healthy');
    expect(result.exitCode).toBe(DoctorExitCode.HEALTHY);
    expect(result.target?.activeProbe).toBe(true);
    expect(result.summary.failed).toBe(0);
    expect(result.summary.warnings).toBe(0);

    for (const id of [
      'probe.no_context',
      'probe.tenant_a',
      'probe.cleanup_after_commit',
      'probe.tenant_b',
      'probe.cleanup_after_rollback',
    ]) {
      expect(check(result, id).status).toBe('pass');
    }

    expect(check(result, 'probe.no_context').details).toEqual({
      settingEmpty: true,
      hasVisibleRows: false,
    });
    expect(check(result, 'probe.tenant_a').details).toEqual({
      hasVisibleRows: true,
      hasMismatchedRows: false,
    });
    expect(check(result, 'probe.cleanup_after_commit').details).toEqual({
      settingEmpty: true,
      hasVisibleRows: false,
    });
    expect(check(result, 'probe.tenant_b').details).toEqual({
      hasVisibleRows: true,
      hasMismatchedRows: false,
    });
    expect(check(result, 'probe.cleanup_after_rollback').details).toEqual({
      settingEmpty: true,
      hasVisibleRows: false,
    });
  });

  it('detects an unexpected permissive policy while the context guard keeps no-context fail-closed', async () => {
    const adminClient = new Client({ connectionString: ADMIN_URL });

    try {
      await adminClient.connect();

      try {
        await adminClient.query(`
          CREATE POLICY doctor_allow_all ON public.users
            AS PERMISSIVE
            FOR ALL
            TO PUBLIC
            USING (true)
            WITH CHECK (true)
        `);

        const result = await runDoctor({
          url: APP_URL,
          table: 'public.users',
          role: APP_ROLE,
          active: true,
          tenantA: TENANT_A,
          tenantB: TENANT_B,
        });

        expect(result.status).toBe('unhealthy');
        expect(result.exitCode).toBe(DoctorExitCode.FINDINGS);
        expect(check(result, 'policy.no_unexpected_permissive')).toEqual(
          expect.objectContaining({
            status: 'fail',
            details: { policies: ['doctor_allow_all'] },
          }),
        );
        expect(check(result, 'probe.no_context')).toEqual(
          expect.objectContaining({
            status: 'pass',
            details: {
              settingEmpty: true,
              hasVisibleRows: false,
            },
          }),
        );
        expect(check(result, 'probe.tenant_a')).toEqual(
          expect.objectContaining({
            status: 'fail',
            details: {
              hasVisibleRows: true,
              hasMismatchedRows: true,
            },
          }),
        );
      } finally {
        await adminClient.query(
          'DROP POLICY IF EXISTS doctor_allow_all ON public.users',
        );
      }
    } finally {
      await adminClient.end();
    }
  });

  it('returns a finding when the application role owns the target table', async () => {
    const result = await runDoctor({
      url: APP_URL,
      table: 'public.force_owner_users',
      role: APP_ROLE,
    });

    expect(result.status).toBe('unhealthy');
    expect(result.exitCode).toBe(DoctorExitCode.FINDINGS);
    expect(result.summary.failed).toBeGreaterThan(0);
    expect(check(result, 'catalog.application_role_not_owner')).toEqual(
      expect.objectContaining({
        status: 'fail',
        details: {
          owner: APP_ROLE,
          directOwner: true,
          ownerRightsActive: true,
        },
      }),
    );
  });

  it('aggregates active pass, drift, and a real statement-timeout error without losing peer results', async () => {
    const adminClient = new Client({ connectionString: ADMIN_URL });
    const lockClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();
    await lockClient.connect();

    try {
      await adminClient.query(`
        DROP TABLE IF EXISTS public.doctor_batch_error CASCADE;
        CREATE TABLE public.doctor_batch_error (
          id integer PRIMARY KEY,
          tenant_id text NOT NULL,
          name text NOT NULL
        );
        GRANT SELECT ON public.doctor_batch_error TO app_user;
        ALTER TABLE public.doctor_batch_error ENABLE ROW LEVEL SECURITY;
        ALTER TABLE public.doctor_batch_error FORCE ROW LEVEL SECURITY;
        CREATE INDEX tenancy_doctor_batch_error_tenant_id_idx
          ON public.doctor_batch_error (tenant_id);
        CREATE POLICY tenant_isolation_doctor_batch_error ON public.doctor_batch_error
          USING (tenant_id = current_setting('app.current_tenant', true)::text);
        CREATE POLICY tenant_insert_doctor_batch_error ON public.doctor_batch_error
          FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::text);
        CREATE POLICY tenant_context_guard_doctor_batch_error ON public.doctor_batch_error
          AS RESTRICTIVE
          USING (NULLIF(current_setting('app.current_tenant', true), '') IS NOT NULL)
          WITH CHECK (NULLIF(current_setting('app.current_tenant', true), '') IS NOT NULL);
        INSERT INTO public.doctor_batch_error (id, tenant_id, name) VALUES
          (1, '${TENANT_A}', 'Locked A'),
          (2, '${TENANT_B}', 'Locked B');
      `);
      await lockClient.query('BEGIN');
      await lockClient.query(
        'LOCK TABLE public.doctor_batch_error IN ACCESS EXCLUSIVE MODE',
      );

      const result = await runDoctorBatch({
        url: APP_URL,
        active: true,
        concurrency: 3,
        timeoutMs: 30_000,
        manifest: {
          schemaVersion: 1,
          defaults: {
            role: APP_ROLE,
            tenantA: TENANT_A,
            tenantB: TENANT_B,
          },
          tables: [
            { table: 'public.users' },
            { table: 'public.force_owner_users' },
            { table: 'public.doctor_batch_error' },
          ],
        },
      });

      expect(result.status).toBe('error');
      expect(result.exitCode).toBe(DoctorExitCode.ERROR);
      expect(result.summary.tables).toEqual({
        total: 3,
        healthy: 1,
        warning: 0,
        unhealthy: 1,
        errors: 1,
      });
      expect(result.results.map((item) => item.target?.table)).toEqual([
        'users', 'force_owner_users', 'doctor_batch_error',
      ]);
      expect(result.results[0]).toEqual(expect.objectContaining({ status: 'healthy' }));
      expect(result.results[1]).toEqual(expect.objectContaining({
        status: 'unhealthy',
        checks: expect.arrayContaining([
          expect.objectContaining({
            id: 'catalog.application_role_not_owner',
            status: 'fail',
          }),
        ]),
      }));
      expect(result.results[2]).toEqual(expect.objectContaining({
        status: 'error',
        error: expect.objectContaining({
          code: 'QUERY_FAILED',
          message: expect.stringContaining('statement timeout'),
        }),
      }));
      expect(formatDoctorBatchResult(result, true)).not.toContain('app_user:app_user');
    } finally {
      await lockClient.query('ROLLBACK');
      await lockClient.end();
      await adminClient.query('DROP TABLE IF EXISTS public.doctor_batch_error CASCADE');
      await adminClient.end();
    }
  }, 20_000);

  it('rolls back an active batch probe when its signal is aborted', async () => {
    const controller = new AbortController();
    let aborted = false;
    const clientFactory = (url: string): DoctorClient => {
      const client = new Client({ connectionString: url });
      return {
        connect: async () => {
          await client.connect();
        },
        query: async <Row extends Record<string, unknown>>(
          text: string,
          values?: readonly unknown[],
        ) => {
          const result = await client.query<Record<string, unknown>>(
            text,
            values ? [...values] : undefined,
          );
          if (text === 'BEGIN READ ONLY' && !aborted) {
            aborted = true;
            controller.abort();
          }
          return {
            rows: result.rows as Row[],
            rowCount: result.rowCount,
          };
        },
        end: async () => client.end(),
      };
    };

    const result = await runDoctorBatch({
      url: APP_URL,
      active: true,
      concurrency: 1,
      signal: controller.signal,
      manifest: {
        schemaVersion: 1,
        defaults: {
          role: APP_ROLE,
          tenantA: TENANT_A,
          tenantB: TENANT_B,
        },
        tables: [
          { table: 'public.users' },
          { table: 'public.force_owner_users' },
        ],
      },
    }, { clientFactory });

    expect(result.status).toBe('error');
    expect(result.error?.code).toBe('ABORTED');
    expect(result.results.map((item) => item.error?.code)).toEqual([
      'ABORTED', 'ABORTED',
    ]);

    const adminClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();
    try {
      const sessions = await adminClient.query<{ count: number }>(`
        SELECT count(*)::int AS count
        FROM pg_catalog.pg_stat_activity
        WHERE usename = 'app_user'
          AND state LIKE 'idle in transaction%'
      `);
      expect(sessions.rows[0].count).toBe(0);
    } finally {
      await adminClient.end();
    }
  });
});
