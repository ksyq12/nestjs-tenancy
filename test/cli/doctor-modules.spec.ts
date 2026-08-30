import {
  doctorChecksResult,
  DoctorCheck,
  DoctorClient,
  DoctorExitCode,
  formatDoctorCliError,
  formatDoctorResult,
  ValidatedDoctorOptions,
} from '../../src/cli/doctor-contract';
import { auditDoctorDatabase } from '../../src/cli/doctor-catalog';
import {
  contextGuardExpressionMatchesGeneratedContract,
  expressionMatchesGeneratedContract,
} from '../../src/cli/doctor-policy';
import { runActiveDoctorProbes } from '../../src/cli/doctor-probe';

const OPTIONS: ValidatedDoctorOptions = {
  url: 'postgresql://app_user:secret@localhost/database',
  schema: 'public',
  table: 'users',
  role: 'app_user',
  dbSettingKey: 'app.current_tenant',
  tenantColumn: 'tenant_id',
  active: false,
};

describe('doctor module boundaries', () => {
  it('preserves policy matcher golden vectors and fails closed for unknown syntax', () => {
    expect(expressionMatchesGeneratedContract(
      "(tenant_id = (current_setting('app.current_tenant'::text, true))::text)",
      'tenant_id',
      'app.current_tenant',
      'text',
    )).toBe(true);
    expect(expressionMatchesGeneratedContract(
      "(\"Tenant\" = (NULLIF(pg_catalog.current_setting('app.current_tenant'::text, true), ''::text))::uuid)",
      'Tenant',
      'app.current_tenant',
      'uuid',
    )).toBe(true);
    expect(contextGuardExpressionMatchesGeneratedContract(
      "(NULLIF(current_setting('app.current_tenant'::text, true), ''::text) IS NOT NULL)",
      'app.current_tenant',
    )).toBe(true);

    for (const expression of [
      null,
      '$not_a_policy_expression$',
      "tenant_id = current_setting('app.current_tenant', true) OR true",
      "tenant_id = current_setting('other.current_tenant', true)",
      '"unterminated',
    ]) {
      expect(expressionMatchesGeneratedContract(
        expression,
        'tenant_id',
        'app.current_tenant',
        'text',
      )).toBe(false);
    }
  });

  it('fails closed for malformed tenant and context-guard token shapes', () => {
    for (const expression of [
      "'tenant_id' = current_setting('app.current_tenant', true)",
      'tenant_id = current_setting(true, true)',
      "tenant_id = current_setting('app.current_tenant' true)",
    ]) {
      expect(expressionMatchesGeneratedContract(
        expression,
        'tenant_id',
        'app.current_tenant',
        'text',
      )).toBe(false);
    }
    expect(expressionMatchesGeneratedContract(
      "tenant_id = NULLIF(current_setting('app.current_tenant', true) '')::uuid",
      'tenant_id',
      'app.current_tenant',
      'uuid',
    )).toBe(false);

    for (const expression of [
      "NULLIF(current_setting(true, true), '') IS NOT NULL",
      "NULLIF(current_setting('app.current_tenant' true), '') IS NOT NULL",
      "NULLIF(current_setting('app.current_tenant', false), '') IS NOT NULL",
      "NULLIF(current_setting('app.current_tenant', true) '') IS NOT NULL",
      "NULLIF(current_setting('app.current_tenant', true), '') = NOT NULL",
      "NULLIF(current_setting('app.current_tenant', true), '') IS false NULL",
      "NULLIF(current_setting('app.current_tenant', true), '') IS NOT false",
      "NULLIF(current_setting('app.current_tenant', true), '') IS NOT NULL true",
    ]) {
      expect(contextGuardExpressionMatchesGeneratedContract(
        expression,
        'app.current_tenant',
      )).toBe(false);
    }
  });

  it('preserves the result, JSON, text, and exit-code golden contract', () => {
    const result = doctorChecksResult({
      schema: 'public',
      table: 'users',
      role: 'app_user',
      settingKey: 'app.current_tenant',
      tenantColumn: 'tenant_id',
      activeProbe: false,
    }, [
      { id: 'catalog.ok', category: 'catalog', status: 'pass', message: 'ok' },
      { id: 'probe.active', category: 'probe', status: 'skip', message: 'not requested' },
    ]);

    expect(result).toEqual({
      schemaVersion: 1,
      status: 'healthy',
      exitCode: DoctorExitCode.HEALTHY,
      target: {
        schema: 'public',
        table: 'users',
        role: 'app_user',
        settingKey: 'app.current_tenant',
        tenantColumn: 'tenant_id',
        activeProbe: false,
      },
      summary: { passed: 1, failed: 0, warnings: 0, skipped: 1 },
      checks: [
        { id: 'catalog.ok', category: 'catalog', status: 'pass', message: 'ok' },
        { id: 'probe.active', category: 'probe', status: 'skip', message: 'not requested' },
      ],
    });
    expect(JSON.parse(formatDoctorResult(result, true))).toEqual(result);
    expect(formatDoctorResult(result, false)).toBe([
      '@nestarc/tenancy doctor',
      'Target: public.users | role=app_user | setting=app.current_tenant',
      'Mode: catalog audit only',
      '',
      '[PASS] catalog.ok: ok',
      '[SKIP] probe.active: not requested',
      '',
      'Status: HEALTHY | pass=1 fail=0 warn=0 skip=1',
    ].join('\n'));
    expect(JSON.parse(formatDoctorCliError('bad', true).toString()).exitCode)
      .toBe(DoctorExitCode.ERROR);
  });

  it('runs catalog-only analysis without entering a probe transaction', async () => {
    const queries: string[] = [];
    const client = {
      connect: jest.fn(),
      end: jest.fn(),
      query: jest.fn(async (sql: string) => {
        queries.push(sql);
        if (sql.includes('pg_catalog.pg_roles AS current_role')) {
          return { rows: [{
            current_user: 'app_user',
            session_user: 'app_user',
            current_superuser: false,
            current_bypassrls: false,
            session_superuser: false,
            session_bypassrls: false,
            max_identifier_length: 63,
          }] };
        }
        if (sql.includes('SELECT rolname, rolsuper')) return { rows: [] };
        if (sql.includes('FROM pg_catalog.pg_class AS c')) return { rows: [] };
        return { rows: [] };
      }),
    } as unknown as DoctorClient;
    const checks: DoctorCheck[] = [];

    await auditDoctorDatabase(client, OPTIONS, checks);

    expect(checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'session.current_role', status: 'pass' }),
      expect.objectContaining({ id: 'role.exists', status: 'fail' }),
      expect.objectContaining({ id: 'catalog.table_exists', status: 'fail' }),
      expect.objectContaining({ id: 'catalog.dependent_checks', status: 'skip' }),
    ]));
    expect(queries).not.toContain('BEGIN READ ONLY');
  });

  it('runs active probes through their independent read-only transaction boundary', async () => {
    const calls: Array<[string, readonly unknown[] | undefined]> = [];
    const client = {
      connect: jest.fn(),
      end: jest.fn(),
      query: jest.fn(async (sql: string, values?: readonly unknown[]) => {
        calls.push([sql, values]);
        if (sql.includes('current_setting($1, true)')) {
          return { rows: [{ setting_value: null }] };
        }
        if (sql.includes('AS has_mismatch')) {
          return { rows: [{ has_visible: true, has_mismatch: false }] };
        }
        if (sql.includes('AS has_visible')) {
          return { rows: [{ has_visible: false }] };
        }
        return { rows: [] };
      }),
    } as unknown as DoctorClient;
    const checks: DoctorCheck[] = [];

    await runActiveDoctorProbes(client, {
      ...OPTIONS,
      active: true,
      tenantA: 'tenant-a',
      tenantB: 'tenant-b',
    }, checks, 'text');

    expect(checks.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: 'probe.no_context', status: 'pass' },
      { id: 'probe.tenant_a', status: 'pass' },
      { id: 'probe.cleanup_after_commit', status: 'pass' },
      { id: 'probe.tenant_b', status: 'pass' },
      { id: 'probe.cleanup_after_rollback', status: 'pass' },
    ]);
    expect(calls.filter(([sql]) => sql === 'BEGIN READ ONLY')).toHaveLength(5);
    expect(calls.filter(([sql]) => sql === 'COMMIT')).toHaveLength(1);
    expect(calls.filter(([sql]) => sql === 'ROLLBACK')).toHaveLength(4);
  });
});
