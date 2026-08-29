import {
  DoctorClient,
  DoctorExitCode,
  DoctorQueryResult,
  DoctorResult,
  doctorHelp,
  formatDoctorCliError,
  formatDoctorResult,
  parseDoctorArgs,
  runDoctor,
} from '../../src/cli/doctor';
import { generateRelationNames } from '../../src/cli/generated-name';

jest.mock('pg', () => ({ Client: jest.fn() }));

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const URL = 'postgresql://app_user:secret@localhost/database';
const GENERATED_EXPRESSION =
  "(tenant_id = (current_setting('app.current_tenant'::text, true))::text)";
const UUID_CATALOG_EXPRESSION =
  "(tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::uuid)";
const CONTEXT_GUARD_EXPRESSION =
  "(NULLIF(current_setting('app.current_tenant'::text, true), ''::text) IS NOT NULL)";

type Row = Record<string, unknown>;

interface ClientState {
  session: Row | undefined;
  role: Row | undefined;
  table: Row | undefined;
  column: Row | undefined;
  privileges: Row | undefined;
  index: Row | undefined;
  policies: Row[];
  reachableRoles: Row[];
  setMembershipUnsupported: boolean;
  settingRows: Array<Row | undefined>;
  visibleRows: Array<Row | undefined>;
  tenantRows: Record<string, Row | undefined>;
  failQuery?: (sql: string, values: readonly unknown[], call: number) => unknown;
  endError?: unknown;
}

function isolationPolicy(overrides: Row = {}): Row {
  return {
    policy_name: 'tenant_isolation_users',
    command: 'ALL',
    permissive: true,
    roles: ['PUBLIC'],
    using_expression: GENERATED_EXPRESSION,
    with_check_expression: null,
    ...overrides,
  };
}

function insertPolicy(overrides: Row = {}): Row {
  return {
    policy_name: 'tenant_insert_users',
    command: 'INSERT',
    permissive: true,
    roles: ['PUBLIC'],
    using_expression: null,
    with_check_expression: GENERATED_EXPRESSION,
    ...overrides,
  };
}

function contextGuardPolicy(overrides: Row = {}): Row {
  return {
    policy_name: 'tenant_context_guard_users',
    command: 'ALL',
    permissive: false,
    roles: ['PUBLIC'],
    using_expression: CONTEXT_GUARD_EXPRESSION,
    with_check_expression: CONTEXT_GUARD_EXPRESSION,
    ...overrides,
  };
}

function healthyState(overrides: Partial<ClientState> = {}): ClientState {
  return {
    session: {
      current_user: 'app_user',
      session_user: 'app_user',
      current_superuser: false,
      current_bypassrls: false,
      session_superuser: false,
      session_bypassrls: false,
      max_identifier_length: 63,
    },
    role: {
      rolname: 'app_user',
      rolsuper: false,
      rolbypassrls: false,
      rolinherit: true,
      rolcanlogin: true,
    },
    table: {
      table_oid: '42',
      schema_name: 'public',
      table_name: 'users',
      relkind: 'r',
      relrowsecurity: true,
      relforcerowsecurity: true,
      table_owner: 'table_owner',
      row_security_active: true,
      owner_rights_active: false,
    },
    column: {
      attribute_number: 2,
      data_type: 'text',
      not_null: true,
      generated: '',
      identity: '',
      policy_type: 'text',
    },
    privileges: {
      schema_usage: true,
      can_select: true,
      can_insert: true,
      can_update: true,
      can_delete: true,
      can_truncate: false,
    },
    index: { has_tenant_index: true },
    policies: [insertPolicy(), isolationPolicy(), contextGuardPolicy()],
    reachableRoles: [],
    setMembershipUnsupported: false,
    settingRows: [],
    visibleRows: [],
    tenantRows: {
      [TENANT_A]: { has_visible: true, has_mismatch: false },
      [TENANT_B]: { has_visible: true, has_mismatch: false },
    },
    ...overrides,
  };
}

function createClient(overrides: Partial<ClientState> = {}): {
  client: DoctorClient;
  connect: jest.Mock;
  query: jest.Mock;
  end: jest.Mock;
} {
  const state = healthyState(overrides);
  let settingIndex = 0;
  let visibleIndex = 0;
  const connect = jest.fn().mockResolvedValue(undefined);
  const end = state.endError === undefined
    ? jest.fn().mockResolvedValue(undefined)
    : jest.fn().mockRejectedValue(state.endError);
  const query = jest.fn(async (
    sql: string,
    values: readonly unknown[] = [],
  ): Promise<DoctorQueryResult<Row>> => {
    const failure = state.failQuery?.(sql, values, query.mock.calls.length);
    if (failure !== undefined) throw failure;

    if (sql.includes('pg_catalog.pg_roles AS current_role')) {
      return { rows: state.session ? [state.session] : [] };
    }
    if (sql.includes('SELECT rolname, rolsuper')) {
      return { rows: state.role ? [state.role] : [] };
    }
    if (sql.includes('FROM pg_catalog.pg_class AS c')) {
      return { rows: state.table ? [state.table] : [] };
    }
    if (sql.includes('FROM pg_catalog.pg_attribute AS a')) {
      return { rows: state.column ? [state.column] : [] };
    }
    if (sql.includes('pg_catalog.has_table_privilege')) {
      return { rows: state.privileges ? [state.privileges] : [] };
    }
    if (sql.includes('FROM pg_catalog.pg_policy AS p')) {
      return { rows: state.policies };
    }
    if (sql.includes('pg_catalog.pg_has_role')) {
      if (values[2] === 'SET' && state.setMembershipUnsupported) {
        throw new Error('SET membership unsupported');
      }
      return { rows: state.reachableRoles };
    }
    if (sql.includes('FROM pg_catalog.pg_index AS i')) {
      return { rows: state.index ? [state.index] : [] };
    }
    if (sql.includes('current_setting($1, true)')) {
      const row = state.settingRows[settingIndex++];
      return { rows: row ? [row] : [] };
    }
    if (sql.includes('AS has_mismatch')) {
      const row = state.tenantRows[String(values[0])];
      return { rows: row ? [row] : [] };
    }
    if (sql.includes('AS has_visible')) {
      const row = state.visibleRows[visibleIndex++];
      return { rows: row ? [row] : [] };
    }
    if (
      sql === 'BEGIN READ ONLY' ||
      sql === 'COMMIT' ||
      sql === 'ROLLBACK' ||
      sql.includes('set_config($1, $2')
    ) {
      return { rows: [] };
    }
    throw new Error(`Unexpected query: ${sql}`);
  });

  return {
    client: { connect, query, end } as unknown as DoctorClient,
    connect,
    query,
    end,
  };
}

function options(active = false) {
  return {
    url: URL,
    table: 'public.users',
    role: 'app_user',
    active,
    tenantA: active ? TENANT_A : undefined,
    tenantB: active ? TENANT_B : undefined,
  };
}

function checksById(result: DoctorResult): Record<string, string> {
  return Object.fromEntries(result.checks.map((check) => [check.id, check.status]));
}

describe('doctor operational and dependency coverage', () => {
  it('reports and redacts a client-factory failure', async () => {
    const result = await runDoctor(options(), {
      clientFactory: () => {
        throw new Error(`driver failed for ${URL}; password=hunter2`);
      },
    });

    expect(result).toEqual(expect.objectContaining({
      status: 'error',
      exitCode: DoctorExitCode.ERROR,
      error: expect.objectContaining({ code: 'DRIVER_UNAVAILABLE' }),
    }));
    expect(result.error?.message).toContain('[REDACTED_DATABASE_URL]');
    expect(result.error?.message).toContain('password=[REDACTED]');
    expect(result.error?.message).not.toContain('hunter2');
  });

  it('uses the default pg client factory and ignores a close failure', async () => {
    const mock = createClient({ endError: new Error('close failed') });
    const Client = jest.requireMock('pg').Client as jest.Mock;
    Client.mockImplementationOnce(() => mock.client);

    const result = await runDoctor(options());

    expect(result.status).toBe('healthy');
    expect(Client).toHaveBeenCalledWith(expect.objectContaining({
      connectionString: URL,
      application_name: '@nestarc/tenancy doctor',
      connectionTimeoutMillis: 10_000,
    }));
    expect(mock.end).toHaveBeenCalledTimes(1);
  });

  it('maps a default pg constructor failure to DRIVER_UNAVAILABLE', async () => {
    const Client = jest.requireMock('pg').Client as jest.Mock;
    Client.mockImplementationOnce(() => {
      throw 'pg exploded';
    });

    const result = await runDoctor(options());

    expect(result.error).toEqual(expect.objectContaining({
      code: 'DRIVER_UNAVAILABLE',
      message: expect.stringContaining('pg exploded'),
    }));
  });

  it('returns a partial QUERY_FAILED result when catalog querying fails', async () => {
    const mock = createClient({
      failQuery: (sql) => sql.includes('pg_catalog.pg_attribute')
        ? new Error(`query failed for postgresql://user:leak@host/db`)
        : undefined,
    });

    const result = await runDoctor(options(), { clientFactory: () => mock.client });

    expect(result.error?.code).toBe('QUERY_FAILED');
    expect(result.error?.message).toBe('query failed for [REDACTED_DATABASE_URL]');
    expect(result.checks.length).toBeGreaterThan(0);
    expect(mock.end).toHaveBeenCalledTimes(1);
  });

  it('fails when PostgreSQL returns no session row', async () => {
    const mock = createClient({ session: undefined });

    const result = await runDoctor(options(), { clientFactory: () => mock.client });

    expect(result.error).toEqual({
      code: 'QUERY_FAILED',
      message: 'PostgreSQL did not return current role information.',
    });
  });

  it('preserves the active-probe error when emergency rollback also fails', async () => {
    let normalRollbacks = 0;
    const mock = createClient({
      failQuery: (sql, values) => {
        if (sql === 'ROLLBACK') {
          normalRollbacks += 1;
          return normalRollbacks > 1 ? new Error('rollback failed') : undefined;
        }
        return sql === 'SELECT set_config($1, $2, true)' && values[1] === TENANT_A
          ? new Error('tenant probe failed')
          : undefined;
      },
    });

    const result = await runDoctor(options(true), { clientFactory: () => mock.client });

    expect(result.error).toEqual({ code: 'QUERY_FAILED', message: 'tenant probe failed' });
    expect(mock.query).toHaveBeenCalledWith('ROLLBACK');
  });
});

describe('doctor missing prerequisites and security findings', () => {
  it('skips active catalog and probe work when the expected role is missing', async () => {
    const mock = createClient({ role: undefined });

    const result = await runDoctor(options(true), { clientFactory: () => mock.client });

    expect(checksById(result)).toEqual(expect.objectContaining({
      'role.exists': 'fail',
      'catalog.table_exists': 'pass',
      'catalog.dependent_checks': 'skip',
      'probe.active': 'skip',
    }));
    expect(result.checks.find((check) => check.id === 'catalog.dependent_checks')?.message)
      .toContain('application role is missing');
  });

  it('skips dependent catalog work without adding an inactive probe when the table is missing', async () => {
    const mock = createClient({ table: undefined });

    const result = await runDoctor(options(), { clientFactory: () => mock.client });

    expect(checksById(result)).toEqual(expect.objectContaining({
      'role.exists': 'pass',
      'catalog.table_exists': 'fail',
      'catalog.dependent_checks': 'skip',
    }));
    expect(result.checks.some((check) => check.id === 'probe.active')).toBe(false);
    expect(result.checks.find((check) => check.id === 'catalog.dependent_checks')?.message)
      .toContain('table is missing');
  });

  it('reports session, role, table, owner, column, index, and grant failures together', async () => {
    const mock = createClient({
      session: {
        ...healthyState().session,
        current_user: 'wrong_user',
        current_bypassrls: true,
        session_bypassrls: true,
      },
      role: {
        ...healthyState().role,
        rolbypassrls: true,
        rolcanlogin: false,
      },
      table: {
        ...healthyState().table,
        relrowsecurity: false,
        relforcerowsecurity: false,
        row_security_active: false,
        table_owner: 'app_user',
        owner_rights_active: true,
      },
      column: {
        ...healthyState().column,
        not_null: false,
        policy_type: null,
        identity: 'd',
      },
      index: { has_tenant_index: false },
      privileges: undefined,
    });

    const result = await runDoctor(options(true), { clientFactory: () => mock.client });
    const checks = checksById(result);

    expect(checks).toEqual(expect.objectContaining({
      'session.current_role': 'fail',
      'session.current_role_security': 'fail',
      'session.login_role_security': 'fail',
      'role.security_attributes': 'fail',
      'role.can_login': 'fail',
      'catalog.rls_enabled': 'fail',
      'catalog.rls_forced': 'fail',
      'catalog.rls_active': 'fail',
      'catalog.application_role_not_owner': 'fail',
      'catalog.tenant_column_not_null': 'fail',
      'catalog.tenant_index': 'fail',
      'catalog.tenant_column_type': 'fail',
      'catalog.tenant_column_generated': 'fail',
      'catalog.table_privileges': 'fail',
      'probe.active': 'skip',
    }));
  });

  it('covers SUPERUSER security attributes and a generated tenant column', async () => {
    const mock = createClient({
      session: {
        ...healthyState().session,
        current_superuser: true,
        session_superuser: true,
      },
      role: {
        ...healthyState().role,
        rolsuper: true,
      },
      column: {
        ...healthyState().column,
        generated: 's',
      },
    });

    const result = await runDoctor(options(), { clientFactory: () => mock.client });

    expect(checksById(result)).toEqual(expect.objectContaining({
      'session.current_role_security': 'fail',
      'session.login_role_security': 'fail',
      'role.security_attributes': 'fail',
      'catalog.tenant_column_generated': 'fail',
    }));
  });

  it('reports a missing tenant column and skips its index query', async () => {
    const mock = createClient({ column: undefined });

    const result = await runDoctor(options(true), { clientFactory: () => mock.client });

    expect(checksById(result)).toEqual(expect.objectContaining({
      'catalog.tenant_column_exists': 'fail',
      'probe.active': 'skip',
    }));
    expect(result.checks.some((check) => check.id === 'catalog.tenant_index')).toBe(false);
    expect(mock.query.mock.calls.some(([sql]) => String(sql).includes('pg_catalog.pg_index'))).toBe(false);
  });

  it.each([
    ['schema USAGE', { schema_usage: false }],
    ['INSERT', { can_insert: false }],
    ['UPDATE', { can_update: false }],
    ['DELETE', { can_delete: false }],
    ['TRUNCATE', { can_truncate: true }],
  ])('rejects an unsafe privilege shape at %s', async (_label, override) => {
    const mock = createClient({
      privileges: { ...healthyState().privileges, ...override },
    });

    const result = await runDoctor(options(), { clientFactory: () => mock.client });

    expect(checksById(result)['catalog.table_privileges']).toBe('fail');
  });

  it('reports reachable SUPERUSER and BYPASSRLS roles but ignores unreachable candidates', async () => {
    const mock = createClient({
      reachableRoles: [
        { role_name: 'root', superuser: true, bypassrls: false, reachable: true },
        { role_name: 'bypass', superuser: false, bypassrls: true, reachable: true },
        { role_name: 'unreachable_owner', superuser: true, bypassrls: true, reachable: false },
      ],
    });

    const result = await runDoctor(options(), { clientFactory: () => mock.client });
    const check = result.checks.find((item) => item.id === 'role.reachable_bypass_roles');

    expect(check).toEqual(expect.objectContaining({
      status: 'fail',
      details: { auditMode: 'SET', roles: ['root', 'bypass'] },
    }));
    expect(check?.message).toContain('root, bypass');
  });

  it('uses MEMBER fallback and turns a fallback query failure into QUERY_FAILED', async () => {
    const mock = createClient({
      setMembershipUnsupported: true,
      failQuery: (_sql, values) => values[2] === 'MEMBER' ? 'member audit failed' : undefined,
    });

    const result = await runDoctor(options(), { clientFactory: () => mock.client });

    expect(result.error).toEqual({ code: 'QUERY_FAILED', message: 'member audit failed' });
  });
});

describe('doctor policy contract and parser coverage', () => {
  it('uses hashed policy names exactly for lossy table identifiers', async () => {
    const names = generateRelationNames({
      schemaName: 'public',
      tableName: 'audit-logs',
      tenantIdField: 'tenant_id',
    });
    const policyRows = [
      insertPolicy({
        policy_name: 'tenant_insert_audit_logs_4aa2515f122e',
      }),
      isolationPolicy({
        policy_name: 'tenant_isolation_audit_logs_ae80b988a44e',
      }),
      contextGuardPolicy({
        policy_name: names.contextGuardPolicy,
      }),
    ];
    const exact = createClient({ policies: policyRows });
    const exactResult = await runDoctor({
      ...options(),
      table: 'public.audit-logs',
    }, { clientFactory: () => exact.client });

    expect(checksById(exactResult)).toEqual(expect.objectContaining({
      'policy.isolation_exists': 'pass',
      'policy.insert_exists': 'pass',
      'policy.context_guard_contract': 'pass',
      'policy.no_unexpected_permissive': 'pass',
    }));

    const wrongCase = createClient({
      policies: [
        policyRows[0],
        isolationPolicy({
          policy_name: 'TENANT_ISOLATION_AUDIT_LOGS_AE80B988A44E',
        }),
        contextGuardPolicy({
          policy_name: names.contextGuardPolicy,
        }),
      ],
    });
    const wrongCaseResult = await runDoctor({
      ...options(),
      table: 'public.audit-logs',
    }, { clientFactory: () => wrongCase.client });

    expect(checksById(wrongCaseResult)).toEqual(expect.objectContaining({
      'policy.isolation_exists': 'fail',
      'policy.no_unexpected_permissive': 'fail',
    }));
  });

  it('reports both generated permissive policies missing and ignores an extra restrictive policy', async () => {
    const mock = createClient({
      policies: [
        contextGuardPolicy(),
        {
          policy_name: 'restrictive_extra',
          command: 'ALL',
          permissive: false,
          roles: ['PUBLIC'],
          using_expression: 'true',
          with_check_expression: null,
        },
      ],
    });

    const result = await runDoctor(options(), { clientFactory: () => mock.client });

    expect(checksById(result)).toEqual(expect.objectContaining({
      'policy.isolation_exists': 'fail',
      'policy.insert_exists': 'fail',
      'policy.context_guard_contract': 'pass',
      'policy.no_unexpected_permissive': 'pass',
    }));
  });

  it.each([
    [
      'PostgreSQL catalog casts',
      CONTEXT_GUARD_EXPRESSION,
    ],
    [
      'qualified current_setting without no-op text casts',
      "(NULLIF(pg_catalog.current_setting('app.current_tenant', true), '') IS NOT NULL)",
    ],
  ])('accepts the generated context guard contract with %s', async (
    _label,
    expression,
  ) => {
    const mock = createClient({
      policies: [
        insertPolicy(),
        isolationPolicy(),
        contextGuardPolicy({
          using_expression: expression,
          with_check_expression: expression,
        }),
      ],
    });

    const result = await runDoctor(options(), { clientFactory: () => mock.client });

    expect(result.status).toBe('healthy');
    expect(checksById(result)['policy.context_guard_contract']).toBe('pass');
  });

  it.each([
    ['missing exact policy', null],
    ['permissive mode', { permissive: true }],
    ['wrong role', { roles: ['app_user'] }],
    ['wrong command', { command: 'SELECT' }],
    [
      'wrong setting key',
      {
        using_expression: "NULLIF(current_setting('app.other_tenant', true), '') IS NOT NULL",
        with_check_expression: "NULLIF(current_setting('app.other_tenant', true), '') IS NOT NULL",
      },
    ],
    [
      'non-empty fallback',
      {
        using_expression: "NULLIF(current_setting('app.current_tenant', true), 'missing') IS NOT NULL",
        with_check_expression: "NULLIF(current_setting('app.current_tenant', true), 'missing') IS NOT NULL",
      },
    ],
    ['null USING expression', { using_expression: null }],
    [
      'unparseable USING expression',
      { using_expression: '$not_a_policy_expression$' },
    ],
    [
      'wrong context function',
      {
        using_expression: "NULLIF(set_config('app.current_tenant', true), '') IS NOT NULL",
      },
    ],
    [
      'non-string setting key',
      {
        using_expression: 'NULLIF(current_setting(app.current_tenant, true), \'\') IS NOT NULL',
      },
    ],
    [
      'wrong null test',
      {
        using_expression: "NULLIF(current_setting('app.current_tenant', true), '') IS NULL",
      },
    ],
    ['one-sided expression drift', { with_check_expression: 'true' }],
    ['wrong exact name', { policy_name: 'tenant_context_guard_other' }],
  ] as Array<[string, Row | null]>)('rejects context guard drift: %s', async (
    label,
    overrides,
  ) => {
    const policies = [insertPolicy(), isolationPolicy()];
    if (overrides) policies.push(contextGuardPolicy(overrides));
    const mock = createClient({ policies });

    const result = await runDoctor(options(), { clientFactory: () => mock.client });

    expect(checksById(result)['policy.context_guard_contract']).toBe('fail');
    if (label === 'permissive mode') {
      expect(checksById(result)['policy.no_unexpected_permissive']).toBe('fail');
    }
  });

  it.each([
    ['command', { command: 'SELECT' }, { command: 'UPDATE' }],
    ['mode', { permissive: false }, { permissive: false }],
    ['roles', { roles: 42 }, { roles: 'app_user' }],
    ['companion expression', { with_check_expression: GENERATED_EXPRESSION }, { using_expression: GENERATED_EXPRESSION }],
    ['tenant predicate', { using_expression: 'true' }, { with_check_expression: null }],
  ])('rejects policy contract drift in %s', async (_label, isolation, insert) => {
    const mock = createClient({
      policies: [insertPolicy(insert), isolationPolicy(isolation)],
    });

    const result = await runDoctor(options(), { clientFactory: () => mock.client });

    expect(checksById(result)).toEqual(expect.objectContaining({
      'policy.isolation_contract': 'fail',
      'policy.insert_contract': 'fail',
    }));
  });

  it.each([
    [
      'PostgreSQL catalog casts',
      UUID_CATALOG_EXPRESSION,
    ],
    [
      'qualified current_setting without no-op text casts',
      "(tenant_id = (NULLIF(pg_catalog.current_setting('app.current_tenant', true), ''))::uuid)",
    ],
  ])('accepts the generated UUID contract with %s', async (_label, expression) => {
    const mock = createClient({
      column: {
        ...healthyState().column,
        data_type: 'uuid',
        policy_type: 'uuid',
      },
      policies: [
        insertPolicy({ with_check_expression: expression }),
        isolationPolicy({ using_expression: expression }),
        contextGuardPolicy(),
      ],
    });

    const result = await runDoctor(options(), { clientFactory: () => mock.client });

    expect(result.status).toBe('healthy');
    expect(checksById(result)).toEqual(expect.objectContaining({
      'catalog.tenant_column_type': 'pass',
      'policy.isolation_contract': 'pass',
      'policy.insert_contract': 'pass',
    }));
  });

  it.each([
    [
      'direct current_setting UUID cast without NULLIF',
      'uuid',
      "(tenant_id = (current_setting('app.current_tenant'::text, true))::uuid)",
    ],
    [
      'non-empty NULLIF fallback',
      'uuid',
      "(tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), 'missing'::text))::uuid)",
    ],
    [
      'TEXT final cast for a UUID column',
      'uuid',
      "(tenant_id = (NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::text)",
    ],
    [
      'misplaced UUID cast on the tenant column',
      'uuid',
      "((tenant_id)::uuid = NULLIF(current_setting('app.current_tenant'::text, true), ''::text))",
    ],
    [
      'TEXT-normalized comparison around a UUID cast',
      'uuid',
      "((tenant_id)::text = ((NULLIF(current_setting('app.current_tenant'::text, true), ''::text))::uuid)::text)",
    ],
    [
      'UUID expression for a TEXT column',
      'text',
      UUID_CATALOG_EXPRESSION,
    ],
  ] as const)(
    'rejects non-generated policy shape: %s',
    async (_label, policyType, expression) => {
      const mock = createClient({
        column: {
          ...healthyState().column,
          data_type: policyType,
          policy_type: policyType,
        },
        policies: [
          insertPolicy({ with_check_expression: expression }),
          isolationPolicy({ using_expression: expression }),
        ],
      });

      const result = await runDoctor(options(), {
        clientFactory: () => mock.client,
      });

      expect(checksById(result)).toEqual(expect.objectContaining({
        'catalog.tenant_column_type': 'pass',
        'policy.isolation_contract': 'fail',
        'policy.insert_contract': 'fail',
      }));
    },
  );

  it.each([
    [
      'TEXT',
      'text',
      "(tenant_id = current_setting('app.current_tenant'::text, true))",
    ],
    [
      'VARCHAR',
      'character varying',
      "((tenant_id)::text = current_setting('app.current_tenant'::text, true))",
    ],
  ])('preserves PostgreSQL %s catalog expression matching', async (
    _label,
    dataType,
    expression,
  ) => {
    const mock = createClient({
      column: {
        ...healthyState().column,
        data_type: dataType,
        policy_type: 'text',
      },
      policies: [
        insertPolicy({ with_check_expression: expression }),
        isolationPolicy({ using_expression: expression }),
      ],
    });

    const result = await runDoctor(options(), { clientFactory: () => mock.client });

    expect(checksById(result)).toEqual(expect.objectContaining({
      'catalog.tenant_column_type': 'pass',
      'policy.isolation_contract': 'pass',
      'policy.insert_contract': 'pass',
    }));
  });

  it('accepts qualified current_setting, quoted identifiers, string role arrays, and fallback identifier length', async () => {
    const expression =
      '("Tenant""Id"::text = pg_catalog.current_setting(\'app.current_tenant\'::text, true)::text)';
    const mock = createClient({
      session: { ...healthyState().session, max_identifier_length: Number.NaN },
      column: { ...healthyState().column, data_type: 'varchar' },
      policies: [
        insertPolicy({ roles: '{"PUBLIC"}', with_check_expression: expression }),
        isolationPolicy({ roles: 'PUBLIC', using_expression: expression }),
      ],
    });

    const result = await runDoctor({
      ...options(),
      tenantColumn: 'Tenant"Id',
    }, { clientFactory: () => mock.client });

    expect(checksById(result)).toEqual(expect.objectContaining({
      'policy.isolation_contract': 'pass',
      'policy.insert_contract': 'pass',
    }));
  });

  it.each([
    ['unterminated identifier', '"tenant_id = current_setting(\'app.current_tenant\', true)'],
    ['unterminated string', "tenant_id = current_setting('app.current_tenant, true)"],
    ['invalid character', "tenant_id @ current_setting('app.current_tenant', true)"],
    ['missing cast target', "tenant_id:: = current_setting('app.current_tenant', true)"],
    ['symbol cast target', "tenant_id::( = current_setting('app.current_tenant', true)"],
    ['quoted cast target', "tenant_id::\"text\" = current_setting('app.current_tenant', true)"],
    ['wrong cast target', "tenant_id::varchar = current_setting('app.current_tenant', true)"],
    ['escaped setting quote', "tenant_id = current_setting('app.current''tenant', true)"],
    ['wrong literal', "tenant_id = current_setting('app.current_tenant', false)"],
    ['wrong equals token', "tenant_id.current_setting('app.current_tenant', true)"],
  ])('rejects a parser variant: %s', async (_label, expression) => {
    const mock = createClient({
      policies: [insertPolicy(), isolationPolicy({ using_expression: expression })],
    });

    const result = await runDoctor(options(), { clientFactory: () => mock.client });

    expect(checksById(result)['policy.isolation_contract']).toBe('fail');
  });
});

describe('doctor active probe coverage', () => {
  it('detects persisted settings, context-free visibility, cross-tenant rows, and empty fixtures', async () => {
    const mock = createClient({
      settingRows: [
        { setting_value: '' },
        { setting_value: 'leaked-tenant' },
        { setting_value: null },
      ],
      visibleRows: [
        { has_visible: true },
        { has_visible: false },
        { has_visible: false },
      ],
      tenantRows: {
        [TENANT_A]: { has_visible: true, has_mismatch: true },
        [TENANT_B]: undefined,
      },
    });

    const result = await runDoctor(options(true), { clientFactory: () => mock.client });

    expect(checksById(result)).toEqual(expect.objectContaining({
      'probe.no_context': 'fail',
      'probe.tenant_a': 'fail',
      'probe.cleanup_after_commit': 'fail',
      'probe.tenant_b': 'warn',
      'probe.cleanup_after_rollback': 'pass',
    }));
  });

  it('uses fail-closed defaults when no-context queries return no rows', async () => {
    const mock = createClient({ settingRows: [], visibleRows: [] });

    const result = await runDoctor(options(true), { clientFactory: () => mock.client });

    expect(checksById(result)).toEqual(expect.objectContaining({
      'probe.no_context': 'pass',
      'probe.cleanup_after_commit': 'pass',
      'probe.cleanup_after_rollback': 'pass',
    }));
  });

  it('skips active probing when SELECT is absent even if role and column match', async () => {
    const mock = createClient({
      privileges: { ...healthyState().privileges, can_select: false },
    });

    const result = await runDoctor(options(true), { clientFactory: () => mock.client });

    expect(checksById(result)['probe.active']).toBe('skip');
  });
});

describe('doctor validation, CLI parsing, and formatting coverage', () => {
  it.each([
    ['missing URL', { ...options(), url: '  ' }],
    ['missing table', { ...options(), table: '' }],
    ['leading dot', { ...options(), table: '.users' }],
    ['trailing dot', { ...options(), table: 'public.' }],
    ['extra dot', { ...options(), table: 'db.public.users' }],
    ['table NUL', { ...options(), table: 'public.us\0ers' }],
    ['long schema', { ...options(), table: `${'s'.repeat(64)}.users` }],
    ['long table', { ...options(), table: `public.${'t'.repeat(64)}` }],
    ['empty role', { ...options(), role: '' }],
    ['role NUL', { ...options(), role: 'app\0user' }],
    ['setting key', { ...options(), dbSettingKey: 'current_tenant' }],
    ['setting key newline', { ...options(), dbSettingKey: 'app.current\ntenant' }],
    ['empty tenant column', { ...options(), tenantColumn: '' }],
    ['tenant column NUL', { ...options(), tenantColumn: 'tenant\0id' }],
    ['qualified tenant column', { ...options(), tenantColumn: 'x.tenant_id' }],
    ['long tenant column', { ...options(), tenantColumn: 't'.repeat(64) }],
    ['active tenant A missing', { ...options(true), tenantA: '' }],
    ['active tenant B missing', { ...options(true), tenantB: '' }],
    ['same active tenants', { ...options(true), tenantB: TENANT_A }],
    ['inactive tenant A', { ...options(), tenantA: TENANT_A }],
    ['inactive tenant B', { ...options(), tenantB: TENANT_B }],
  ])('rejects invalid runDoctor options: %s', async (_label, invalidOptions) => {
    const factory = jest.fn();

    const result = await runDoctor(invalidOptions, { clientFactory: factory });

    expect(result.error?.code).toBe('INVALID_OPTIONS');
    expect(factory).not.toHaveBeenCalled();
  });

  it('accepts safe custom setting and tenant-column options', async () => {
    const expression = "account_id = current_setting('custom.tenant', true)::text";
    const mock = createClient({
      policies: [
        insertPolicy({ with_check_expression: expression }),
        isolationPolicy({ using_expression: expression }),
      ],
    });

    const result = await runDoctor({
      ...options(),
      dbSettingKey: 'custom.tenant',
      tenantColumn: 'account_id',
    }, { clientFactory: () => mock.client });

    expect(result.target).toEqual(expect.objectContaining({
      settingKey: 'custom.tenant',
      tenantColumn: 'account_id',
    }));
  });

  it.each([
    [['--help'], 'help'],
    [['-h'], 'help'],
    [['--json', '--json'], 'Duplicate option: --json'],
    [['--active', '--active'], 'Duplicate option: --active'],
    [['positional'], 'Unexpected positional argument.'],
    [['--wat'], 'Unknown doctor option: --wat'],
    [['--url'], 'Missing value for --url'],
    [['--url', '--table=x.y'], 'Missing value for --url'],
    [['--url='], 'Missing value for --url'],
  ])('handles CLI parser edge case %#', (args, outcome) => {
    const parsed = parseDoctorArgs(args as string[], {});
    if (outcome === 'help') {
      expect(parsed).toEqual({ kind: 'help' });
    } else {
      expect(parsed).toEqual(expect.objectContaining({ kind: 'error', message: outcome }));
    }
  });

  it.each([
    [[], {}, 'Set DATABASE_URL or pass --url.'],
    [[], { DATABASE_URL: URL }, 'Missing required option: --table=schema.table'],
    [['--table=public.users'], { DATABASE_URL: URL }, 'Missing required option: --role=<application-role>'],
    [[
      '--table=public.users', '--role=app_user', '--active', '--tenant-a=a',
    ], { DATABASE_URL: URL }, '--active requires --tenant-a and --tenant-b.'],
    [[
      '--table=public.users', '--role=app_user', '--tenant-a=a',
    ], { DATABASE_URL: URL }, '--tenant-a and --tenant-b require --active.'],
    [[
      '--table=public.users', '--role=app_user', '--active', '--tenant-a=a', '--tenant-b=a',
    ], { DATABASE_URL: URL }, '--tenant-a and --tenant-b must be different.'],
  ])('reports required CLI option error %#', (args, env, message) => {
    expect(parseDoctorArgs(args as string[], env)).toEqual({
      kind: 'error',
      message,
      json: false,
    });
  });

  it('parses all optional values from separated flags', () => {
    expect(parseDoctorArgs([
      '--url', URL,
      '--table', 'audit.users',
      '--role', 'runtime',
      '--db-setting-key', 'custom.tenant',
      '--tenant-column', 'account_id',
      '--active',
      '--tenant-a', TENANT_A,
      '--tenant-b', TENANT_B,
      '--json',
    ], {})).toEqual({
      kind: 'options',
      options: {
        url: URL,
        table: 'audit.users',
        role: 'runtime',
        dbSettingKey: 'custom.tenant',
        tenantColumn: 'account_id',
        active: true,
        tenantA: TENANT_A,
        tenantB: TENANT_B,
        json: true,
      },
    });
  });

  it('formats targetless errors, active targets, CLI errors, and help in both modes', () => {
    const targetless: DoctorResult = {
      schemaVersion: 1,
      status: 'error',
      exitCode: 2,
      summary: { passed: 0, failed: 0, warnings: 0, skipped: 0 },
      checks: [],
      error: { code: 'INVALID_OPTIONS', message: 'bad options' },
    };
    const active: DoctorResult = {
      ...targetless,
      status: 'unhealthy',
      exitCode: 1,
      target: {
        schema: 'public', table: 'users', role: 'app_user',
        settingKey: 'app.current_tenant', tenantColumn: 'tenant_id', activeProbe: true,
      },
      summary: { passed: 0, failed: 1, warnings: 0, skipped: 0 },
      checks: [{ id: 'x', category: 'probe', status: 'fail', message: 'failed' }],
      error: undefined,
    };

    expect(formatDoctorResult(targetless, false)).toContain('[ERROR] INVALID_OPTIONS: bad options');
    expect(formatDoctorResult(targetless, false)).not.toContain('Target:');
    expect(formatDoctorResult(active, false)).toContain('catalog + active read-only probe');
    expect(JSON.parse(formatDoctorResult(active, true))).toEqual(active);
    expect(formatDoctorCliError(`bad password=hunter2 at ${URL}`, false))
      .toBe('Doctor usage error: bad password=[REDACTED] at [REDACTED_DATABASE_URL]');
    expect(JSON.parse(formatDoctorCliError('bad', true))).toEqual(expect.objectContaining({
      error: { code: 'INVALID_OPTIONS', message: 'bad' },
    }));
    expect(doctorHelp()).toContain('--active');
    expect(doctorHelp()).toContain('Exit codes: 0 healthy');
  });
});
