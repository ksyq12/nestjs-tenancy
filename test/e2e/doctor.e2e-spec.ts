import { Client } from 'pg';
import {
  DoctorCheck,
  DoctorExitCode,
  DoctorResult,
  formatDoctorResult,
  runDoctor,
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

  it('detects an unexpected permissive policy in the catalog and active probe', async () => {
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
            status: 'fail',
            details: {
              settingEmpty: true,
              hasVisibleRows: true,
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
});
