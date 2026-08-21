import {
  DoctorClient,
  DoctorExitCode,
  DoctorQueryResult,
  DoctorResult,
  formatDoctorResult,
  parseDoctorArgs,
  runDoctor,
} from '../../src/cli/doctor';
import { runCli } from '../../src/cli';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';

interface MockState {
  currentUser: string;
  sessionUser: string;
  currentSuperuser: boolean;
  currentBypassRls: boolean;
  sessionSuperuser: boolean;
  sessionBypassRls: boolean;
  roleSuperuser: boolean;
  roleBypassRls: boolean;
  rlsEnabled: boolean;
  rlsForced: boolean;
  rlsActive: boolean;
  owner: string;
  columnExists: boolean;
  columnNotNull: boolean;
  columnTextCompatible: boolean;
  canSelect: boolean;
  reachableRoles: Array<Record<string, unknown>>;
  setMembershipUnsupported: boolean;
  extraPolicies: Array<Record<string, unknown>>;
  probe: Record<string, { has_visible: boolean; has_mismatch: boolean }>;
  noContextVisible: boolean;
  isolationExpression: string;
  insertExpression: string;
}

function healthyState(overrides: Partial<MockState> = {}): MockState {
  return {
    currentUser: 'app_user',
    sessionUser: 'app_user',
    currentSuperuser: false,
    currentBypassRls: false,
    sessionSuperuser: false,
    sessionBypassRls: false,
    roleSuperuser: false,
    roleBypassRls: false,
    rlsEnabled: true,
    rlsForced: true,
    rlsActive: true,
    owner: 'table_owner',
    columnExists: true,
    columnNotNull: true,
    columnTextCompatible: true,
    canSelect: true,
    reachableRoles: [],
    setMembershipUnsupported: false,
    extraPolicies: [],
    probe: {
      [TENANT_A]: { has_visible: true, has_mismatch: false },
      [TENANT_B]: { has_visible: true, has_mismatch: false },
    },
    noContextVisible: false,
    isolationExpression: "(tenant_id = (current_setting('app.current_tenant'::text, true))::text)",
    insertExpression: "(tenant_id = (current_setting('app.current_tenant'::text, true))::text)",
    ...overrides,
  };
}

function createClient(state: MockState): {
  client: DoctorClient;
  connect: jest.Mock;
  query: jest.Mock;
  end: jest.Mock;
} {
  const connect = jest.fn().mockResolvedValue(undefined);
  const end = jest.fn().mockResolvedValue(undefined);
  const query = jest.fn(async (
    sql: string,
    values: readonly unknown[] = [],
  ): Promise<DoctorQueryResult<Record<string, unknown>>> => {
    if (sql.includes('pg_catalog.pg_roles AS current_role')) {
      return { rows: [{
        current_user: state.currentUser,
        session_user: state.sessionUser,
        current_superuser: state.currentSuperuser,
        current_bypassrls: state.currentBypassRls,
        session_superuser: state.sessionSuperuser,
        session_bypassrls: state.sessionBypassRls,
        max_identifier_length: 63,
      }] };
    }
    if (sql.includes('SELECT rolname, rolsuper')) {
      return { rows: [{
        rolname: 'app_user',
        rolsuper: state.roleSuperuser,
        rolbypassrls: state.roleBypassRls,
        rolinherit: true,
        rolcanlogin: true,
      }] };
    }
    if (sql.includes('FROM pg_catalog.pg_class AS c')) {
      return { rows: [{
        table_oid: '42',
        schema_name: 'public',
        table_name: 'users',
        relkind: 'r',
        relrowsecurity: state.rlsEnabled,
        relforcerowsecurity: state.rlsForced,
        table_owner: state.owner,
        row_security_active: state.rlsActive,
        owner_rights_active: state.owner === 'app_user',
      }] };
    }
    if (sql.includes('FROM pg_catalog.pg_attribute AS a')) {
      return { rows: state.columnExists ? [{
        attribute_number: 2,
        data_type: 'text',
        not_null: state.columnNotNull,
        generated: '',
        identity: '',
        text_compatible: state.columnTextCompatible,
      }] : [] };
    }
    if (sql.includes('pg_catalog.has_table_privilege')) {
      return { rows: [{
        schema_usage: true,
        can_select: state.canSelect,
        can_insert: true,
        can_update: true,
        can_delete: true,
        can_truncate: false,
      }] };
    }
    if (sql.includes('FROM pg_catalog.pg_index AS i')) {
      return { rows: [{ has_tenant_index: true }] };
    }
    if (sql.includes('FROM pg_catalog.pg_policy AS p')) {
      return { rows: [
        {
          policy_name: 'tenant_insert_users',
          command: 'INSERT',
          permissive: true,
          roles: ['PUBLIC'],
          using_expression: null,
          with_check_expression: state.insertExpression,
        },
        {
          policy_name: 'tenant_isolation_users',
          command: 'ALL',
          permissive: true,
          roles: ['PUBLIC'],
          using_expression: state.isolationExpression,
          with_check_expression: null,
        },
        ...state.extraPolicies,
      ] };
    }
    if (sql.includes('pg_catalog.pg_has_role')) {
      if (values[2] === 'SET' && state.setMembershipUnsupported) {
        throw new Error('unrecognized privilege type: "SET"');
      }
      return { rows: state.reachableRoles };
    }
    if (sql === 'BEGIN READ ONLY' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      return { rows: [] };
    }
    if (sql.includes('pg_catalog.set_config($1, $2, false)')) {
      return { rows: [{ set_config: values[1] }] };
    }
    if (sql.includes('current_setting($1, true)')) {
      return { rows: [{ setting_value: null }] };
    }
    if (sql.includes('set_config($1, $2, true)')) {
      return { rows: [{ set_config: values[1] }] };
    }
    if (sql.includes('AS has_mismatch')) {
      return { rows: [state.probe[String(values[0])] ?? {
        has_visible: false,
        has_mismatch: false,
      }] };
    }
    if (sql.includes('AS has_visible')) {
      return { rows: [{ has_visible: state.noContextVisible }] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  const client = { connect, query, end } as unknown as DoctorClient;
  return { client, connect, query, end };
}

function baseOptions(active = false) {
  return {
    url: 'postgresql://app_user:secret@localhost/database',
    table: 'public.users',
    role: 'app_user',
    active,
    tenantA: active ? TENANT_A : undefined,
    tenantB: active ? TENANT_B : undefined,
  };
}

describe('runDoctor', () => {
  it('passes an exact generated catalog contract and always closes the client', async () => {
    const mock = createClient(healthyState());

    const result = await runDoctor(baseOptions(), {
      clientFactory: () => mock.client,
    });

    expect(result.status).toBe('healthy');
    expect(result.exitCode).toBe(DoctorExitCode.HEALTHY);
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'catalog.rls_forced', status: 'pass' }),
      expect.objectContaining({ id: 'policy.isolation_contract', status: 'pass' }),
      expect.objectContaining({ id: 'policy.insert_contract', status: 'pass' }),
      expect.objectContaining({ id: 'probe.active', status: 'skip' }),
    ]));
    expect(mock.connect).toHaveBeenCalledTimes(1);
    expect(mock.end).toHaveBeenCalledTimes(1);
    expect(mock.query).toHaveBeenCalledWith(
      expect.stringContaining('n.nspname = $1'),
      ['public', 'users', 'app_user'],
    );
  });

  it('runs read-only A/B and no-context probes on one client with bound values', async () => {
    const mock = createClient(healthyState());

    const result = await runDoctor(baseOptions(true), {
      clientFactory: () => mock.client,
    });

    expect(result.exitCode).toBe(DoctorExitCode.HEALTHY);
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'probe.no_context', status: 'pass' }),
      expect.objectContaining({ id: 'probe.tenant_a', status: 'pass' }),
      expect.objectContaining({ id: 'probe.cleanup_after_commit', status: 'pass' }),
      expect.objectContaining({ id: 'probe.tenant_b', status: 'pass' }),
      expect.objectContaining({ id: 'probe.cleanup_after_rollback', status: 'pass' }),
    ]));

    const calls = mock.query.mock.calls as Array<[string, readonly unknown[] | undefined]>;
    expect(calls.filter(([sql]) => sql === 'BEGIN READ ONLY')).toHaveLength(5);
    expect(calls).toContainEqual(['SELECT set_config($1, $2, true)', ['app.current_tenant', TENANT_A]]);
    expect(calls).toContainEqual(['SELECT set_config($1, $2, true)', ['app.current_tenant', TENANT_B]]);
    const probeSql = calls.find(([sql]) => sql.includes('AS has_mismatch'))?.[0] ?? '';
    expect(probeSql).toContain('FROM "public"."users"');
    expect(probeSql).not.toContain(TENANT_A);
    expect(probeSql).not.toContain(TENANT_B);
  });

  it('fails role, FORCE, owner reachability, and unexpected permissive policy risks', async () => {
    const mock = createClient(healthyState({
      roleBypassRls: true,
      rlsForced: false,
      rlsActive: false,
      reachableRoles: [{
        role_name: 'table_owner',
        superuser: false,
        bypassrls: false,
        reachable: true,
      }],
      extraPolicies: [{
        policy_name: 'allow_everything',
        command: 'ALL',
        permissive: true,
        roles: ['PUBLIC'],
        using_expression: 'true',
        with_check_expression: 'true',
      }],
    }));

    const result = await runDoctor(baseOptions(), { clientFactory: () => mock.client });

    expect(result.exitCode).toBe(DoctorExitCode.FINDINGS);
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'role.security_attributes', status: 'fail' }),
      expect.objectContaining({ id: 'catalog.rls_forced', status: 'fail' }),
      expect.objectContaining({ id: 'role.reachable_bypass_roles', status: 'fail' }),
      expect.objectContaining({ id: 'policy.no_unexpected_permissive', status: 'fail' }),
    ]));
  });

  it('uses pre-PostgreSQL-16 MEMBER semantics without a false warning', async () => {
    const mock = createClient(healthyState({ setMembershipUnsupported: true }));

    const result = await runDoctor(baseOptions(), { clientFactory: () => mock.client });

    expect(result.exitCode).toBe(DoctorExitCode.HEALTHY);
    expect(result.checks).toContainEqual(expect.objectContaining({
      id: 'role.reachable_bypass_roles',
      status: 'pass',
      details: { auditMode: 'MEMBER', roles: [] },
    }));
    expect(mock.query).toHaveBeenCalledWith(
      expect.stringContaining('pg_catalog.pg_has_role'),
      ['app_user', 'table_owner', 'MEMBER'],
    );
  });

  it('does not fold a quoted case-sensitive tenant column in policy expressions', async () => {
    const mock = createClient(healthyState({
      isolationExpression: "(tenant = (current_setting('app.current_tenant'::text, true))::text)",
      insertExpression: "(tenant = (current_setting('app.current_tenant'::text, true))::text)",
    }));

    const result = await runDoctor({
      ...baseOptions(),
      tenantColumn: 'Tenant',
    }, { clientFactory: () => mock.client });

    expect(result.exitCode).toBe(DoctorExitCode.FINDINGS);
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'policy.isolation_contract', status: 'fail' }),
      expect.objectContaining({ id: 'policy.insert_contract', status: 'fail' }),
    ]));
  });

  it('makes a tenant probe with no visible fixture rows inconclusive and non-zero', async () => {
    const mock = createClient(healthyState({
      probe: {
        [TENANT_A]: { has_visible: false, has_mismatch: false },
        [TENANT_B]: { has_visible: true, has_mismatch: false },
      },
    }));

    const result = await runDoctor(baseOptions(true), { clientFactory: () => mock.client });

    expect(result.status).toBe('warning');
    expect(result.exitCode).toBe(DoctorExitCode.FINDINGS);
    expect(result.checks).toContainEqual(expect.objectContaining({
      id: 'probe.tenant_a',
      status: 'warn',
    }));
  });

  it('returns an operational error, redacts the URL, and closes after connection failure', async () => {
    const url = 'postgresql://app_user:very-secret@localhost/database';
    const end = jest.fn().mockResolvedValue(undefined);
    const client = {
      connect: jest.fn().mockRejectedValue(new Error(`failed for ${url}`)),
      query: jest.fn(),
      end,
    } as unknown as DoctorClient;

    const result = await runDoctor({ ...baseOptions(), url }, { clientFactory: () => client });

    expect(result.exitCode).toBe(DoctorExitCode.ERROR);
    expect(result.error?.code).toBe('CONNECTION_FAILED');
    expect(result.error?.message).not.toContain('very-secret');
    expect(result.error?.message).toContain('[REDACTED_DATABASE_URL]');
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('rejects unsafe or incomplete option combinations before creating a client', async () => {
    const factory = jest.fn();
    const result = await runDoctor({
      url: 'postgresql://localhost/db',
      table: 'users',
      role: 'app_user',
      active: true,
      tenantA: TENANT_A,
    }, { clientFactory: factory });

    expect(result.error?.code).toBe('INVALID_OPTIONS');
    expect(result.exitCode).toBe(DoctorExitCode.ERROR);
    expect(factory).not.toHaveBeenCalled();
  });
});

describe('doctor CLI contract', () => {
  it('parses either separated/equal flags and preserves URL query equals signs', () => {
    const parsed = parseDoctorArgs([
      '--url=postgresql://localhost/db?options=a=b=c',
      '--table', 'public.users',
      '--role=app_user',
      '--active',
      `--tenant-a=${TENANT_A}`,
      '--tenant-b', TENANT_B,
      '--json',
    ], {});

    expect(parsed).toEqual({
      kind: 'options',
      options: expect.objectContaining({
        url: 'postgresql://localhost/db?options=a=b=c',
        table: 'public.users',
        role: 'app_user',
        active: true,
        json: true,
      }),
    });
  });

  it('strictly rejects unknown, duplicate, and incomplete active flags', () => {
    expect(parseDoctorArgs([
      '--table=public.users', '--role=app_user', '--wat',
    ], { DATABASE_URL: 'postgresql://localhost/db' })).toEqual(expect.objectContaining({ kind: 'error' }));
    expect(parseDoctorArgs([
      '--table=public.users', '--table=public.posts', '--role=app_user',
    ], { DATABASE_URL: 'postgresql://localhost/db' })).toEqual(expect.objectContaining({ kind: 'error' }));
    expect(parseDoctorArgs([
      '--table=public.users', '--role=app_user', '--active', `--tenant-a=${TENANT_A}`,
    ], { DATABASE_URL: 'postgresql://localhost/db' })).toEqual(expect.objectContaining({ kind: 'error' }));
  });

  it('never repeats a URL value from an unknown option in JSON errors', async () => {
    const output: string[] = [];
    const secretUrl = 'postgresql://app_user:do-not-print@localhost/db';

    const exitCode = await runCli([
      'doctor', `--database-url=${secretUrl}`, '--table=public.users', '--role=app_user', '--json',
    ], {}, {
      log: (message) => output.push(message),
      error: jest.fn(),
    });

    expect(exitCode).toBe(DoctorExitCode.ERROR);
    expect(output).toHaveLength(1);
    expect(output[0]).not.toContain('do-not-print');
    expect(JSON.parse(output[0]).error.message).toBe('Unknown doctor option: --database-url');
  });

  it('dispatches doctor, emits one JSON document, and returns the doctor exit code', async () => {
    const output: string[] = [];
    const errors: string[] = [];
    const expected = {
      schemaVersion: 1,
      status: 'healthy',
      exitCode: 0,
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
        { id: 'catalog.rls_enabled', category: 'catalog', status: 'pass', message: 'ok' },
        { id: 'probe.active', category: 'probe', status: 'skip', message: 'not requested' },
      ],
    } as DoctorResult;
    const runner = jest.fn().mockResolvedValue(expected);

    const exitCode = await runCli([
      'doctor', '--table=public.users', '--role=app_user', '--json',
    ], { DATABASE_URL: 'postgresql://app_user:secret@localhost/db' }, {
      log: (message) => output.push(message),
      error: (message) => errors.push(message),
    }, { runDoctor: runner });

    expect(exitCode).toBe(0);
    expect(output).toHaveLength(1);
    expect(errors).toHaveLength(0);
    expect(JSON.parse(output[0])).toEqual(expected);
    expect(output[0]).not.toContain('secret');
    expect(runner).toHaveBeenCalledWith(expect.objectContaining({
      table: 'public.users',
      role: 'app_user',
    }));
  });

  it('renders stable human and JSON summaries without a URL', async () => {
    const mock = createClient(healthyState());
    const result = await runDoctor(baseOptions(), { clientFactory: () => mock.client });

    expect(formatDoctorResult(result, false)).toContain('[PASS] catalog.rls_enabled');
    expect(formatDoctorResult(result, false)).not.toContain('secret');
    expect(JSON.parse(formatDoctorResult(result, true))).toEqual(result);
  });
});
