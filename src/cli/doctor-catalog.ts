import { UUID_REGEX } from '../tenancy.constants';
import type {
  DoctorCheck,
  DoctorClient,
  ValidatedDoctorOptions,
} from './doctor-contract';
import {
  generateRelationNames,
  postgresCatalogIdentifier,
} from './generated-name';
import {
  contextGuardExpressionMatchesGeneratedContract,
  expressionMatchesGeneratedContract,
} from './doctor-policy';
import { runActiveDoctorProbes } from './doctor-probe';
import type { TenantColumnPolicyType } from './tenant-column';

interface SessionRow extends Record<string, unknown> {
  current_user: string;
  session_user: string;
  current_superuser: boolean;
  current_bypassrls: boolean;
  session_superuser: boolean;
  session_bypassrls: boolean;
  max_identifier_length: number;
}

interface RoleRow extends Record<string, unknown> {
  rolname: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  rolinherit: boolean;
  rolcanlogin: boolean;
}

interface TableRow extends Record<string, unknown> {
  table_oid: string;
  schema_name: string;
  table_name: string;
  relkind: string;
  relrowsecurity: boolean;
  relforcerowsecurity: boolean;
  table_owner: string;
  row_security_active: boolean;
  owner_rights_active: boolean;
}

interface ColumnRow extends Record<string, unknown> {
  attribute_number: number;
  data_type: string;
  not_null: boolean;
  generated: string;
  identity: string;
  policy_type: TenantColumnPolicyType | null;
}

interface PrivilegeRow extends Record<string, unknown> {
  schema_usage: boolean;
  can_select: boolean;
  can_insert: boolean;
  can_update: boolean;
  can_delete: boolean;
  can_truncate: boolean;
}

interface IndexRow extends Record<string, unknown> {
  has_tenant_index: boolean;
}

interface PolicyRow extends Record<string, unknown> {
  policy_name: string;
  command: string;
  permissive: boolean;
  roles: unknown;
  using_expression: string | null;
  with_check_expression: string | null;
}

interface ReachableRoleRow extends Record<string, unknown> {
  role_name: string;
  superuser: boolean;
  bypassrls: boolean;
  reachable: boolean;
}

const SESSION_SQL = `
SELECT
  current_user AS current_user,
  session_user AS session_user,
  current_role_info.rolsuper AS current_superuser,
  current_role_info.rolbypassrls AS current_bypassrls,
  session_role_info.rolsuper AS session_superuser,
  session_role_info.rolbypassrls AS session_bypassrls,
  current_setting('max_identifier_length')::int AS max_identifier_length
FROM pg_catalog.pg_roles AS current_role_info
JOIN pg_catalog.pg_roles AS session_role_info
  ON session_role_info.rolname = session_user
WHERE current_role_info.rolname = current_user
`;

const ROLE_SQL = `
SELECT rolname, rolsuper, rolbypassrls, rolinherit, rolcanlogin
FROM pg_catalog.pg_roles
WHERE rolname = $1
`;

const TABLE_SQL = `
SELECT
  c.oid::text AS table_oid,
  n.nspname AS schema_name,
  c.relname AS table_name,
  c.relkind::text AS relkind,
  c.relrowsecurity,
  c.relforcerowsecurity,
  pg_catalog.pg_get_userbyid(c.relowner) AS table_owner,
  pg_catalog.row_security_active(c.oid) AS row_security_active,
  COALESCE(
    pg_catalog.pg_has_role(
      (SELECT target.oid FROM pg_catalog.pg_roles AS target WHERE target.rolname = $3),
      c.relowner,
      'USAGE'
    ),
    false
  ) AS owner_rights_active
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
WHERE n.nspname = $1
  AND c.relname = $2
  AND c.relkind IN ('r', 'p')
`;

const COLUMN_SQL = `
SELECT
  a.attnum AS attribute_number,
  pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
  (a.attnotnull OR t.typnotnull) AS not_null,
  a.attgenerated::text AS generated,
  a.attidentity::text AS identity,
  CASE COALESCE(NULLIF(t.typbasetype, 0), a.atttypid)
    WHEN 25 THEN 'text'
    WHEN 1042 THEN 'text'
    WHEN 1043 THEN 'text'
    WHEN 2950 THEN 'uuid'
    ELSE NULL
  END AS policy_type
FROM pg_catalog.pg_attribute AS a
JOIN pg_catalog.pg_type AS t ON t.oid = a.atttypid
WHERE a.attrelid = $1::oid
  AND a.attname = $2
  AND a.attnum > 0
  AND NOT a.attisdropped
`;

const PRIVILEGE_SQL = `
SELECT
  pg_catalog.has_schema_privilege($1, $3, 'USAGE') AS schema_usage,
  pg_catalog.has_table_privilege($1, $2::oid, 'SELECT') AS can_select,
  pg_catalog.has_table_privilege($1, $2::oid, 'INSERT') AS can_insert,
  pg_catalog.has_table_privilege($1, $2::oid, 'UPDATE') AS can_update,
  pg_catalog.has_table_privilege($1, $2::oid, 'DELETE') AS can_delete,
  pg_catalog.has_table_privilege($1, $2::oid, 'TRUNCATE') AS can_truncate
`;

const INDEX_SQL = `
SELECT EXISTS (
  SELECT 1
  FROM pg_catalog.pg_index AS i
  WHERE i.indrelid = $1::oid
    AND i.indisvalid
    AND i.indisready
    AND i.indpred IS NULL
    AND EXISTS (
      SELECT 1
      FROM unnest(i.indkey) WITH ORDINALITY AS index_key(attribute_number, position)
      WHERE index_key.attribute_number = $2::smallint
        AND index_key.position <= i.indnkeyatts
    )
) AS has_tenant_index
`;

const POLICY_SQL = `
SELECT
  p.polname AS policy_name,
  CASE p.polcmd
    WHEN '*' THEN 'ALL'
    WHEN 'r' THEN 'SELECT'
    WHEN 'a' THEN 'INSERT'
    WHEN 'w' THEN 'UPDATE'
    WHEN 'd' THEN 'DELETE'
  END AS command,
  p.polpermissive AS permissive,
  ARRAY(
    SELECT CASE
      WHEN policy_role.oid = 0 THEN 'PUBLIC'
      ELSE pg_catalog.pg_get_userbyid(policy_role.oid)
    END
    FROM unnest(p.polroles) AS policy_role(oid)
  ) AS roles,
  pg_catalog.pg_get_expr(p.polqual, p.polrelid, false) AS using_expression,
  pg_catalog.pg_get_expr(p.polwithcheck, p.polrelid, false) AS with_check_expression
FROM pg_catalog.pg_policy AS p
WHERE p.polrelid = $1::oid
ORDER BY p.polname
`;

const REACHABLE_ROLES_SQL = `
SELECT
  candidate.rolname AS role_name,
  candidate.rolsuper AS superuser,
  candidate.rolbypassrls AS bypassrls,
  pg_catalog.pg_has_role($1, candidate.oid, $3) AS reachable
FROM pg_catalog.pg_roles AS candidate
WHERE candidate.rolname <> $1
  AND (candidate.rolsuper OR candidate.rolbypassrls OR candidate.rolname = $2)
ORDER BY candidate.rolname
`;

export async function auditDoctorDatabase(
  client: DoctorClient,
  options: ValidatedDoctorOptions,
  checks: DoctorCheck[],
  signal?: AbortSignal,
  statementTimeoutMs?: number,
): Promise<void> {
  throwIfAborted(signal);
  await client.query(
    'SELECT pg_catalog.set_config($1, $2, false)',
    ['search_path', 'pg_catalog'],
  );
  const session = (await client.query<SessionRow>(SESSION_SQL)).rows[0];
  if (!session) {
    throw new Error('PostgreSQL did not return current role information.');
  }

  const role = (await client.query<RoleRow>(ROLE_SQL, [options.role])).rows[0];
  throwIfAborted(signal);
  const table = (await client.query<TableRow>(
    TABLE_SQL,
    [options.schema, options.table, options.role],
  )).rows[0];

  addSessionChecks(checks, session, options.role);
  addRoleChecks(checks, role);
  addTableExistenceCheck(checks, table, options);

  if (!role || !table) {
    addSkippedDependentChecks(checks, options.active, !role ? 'application role is missing' : 'table is missing');
    return;
  }

  // A pg Client executes one query at a time. Keep these sequential for pg@9 compatibility.
  const columnResult = await client.query<ColumnRow>(
    COLUMN_SQL,
    [table.table_oid, options.tenantColumn],
  );
  throwIfAborted(signal);
  const privilegeResult = await client.query<PrivilegeRow>(
    PRIVILEGE_SQL,
    [options.role, table.table_oid, options.schema],
  );
  throwIfAborted(signal);
  const policyResult = await client.query<PolicyRow>(POLICY_SQL, [table.table_oid]);
  throwIfAborted(signal);
  const reachableRoles = await queryReachableRoles(client, options.role, table.table_owner);
  throwIfAborted(signal);

  const column = columnResult.rows[0];
  const privileges = privilegeResult.rows[0];
  const policies = policyResult.rows;
  const index = column
    ? (await client.query<IndexRow>(INDEX_SQL, [table.table_oid, column.attribute_number])).rows[0]
    : undefined;
  throwIfAborted(signal);

  addCatalogChecks(checks, table, column, index, privileges, options);
  addReachableRoleChecks(checks, reachableRoles.rows, reachableRoles.mode, table.table_owner);
  addPolicyChecks(
    checks,
    policies,
    options,
    session.max_identifier_length,
    column?.policy_type ?? null,
  );

  if (!options.active) {
    addCheck(checks, {
      id: 'probe.active',
      category: 'probe',
      status: 'skip',
      message: 'Active probe was not requested; catalog audit only.',
    });
    return;
  }

  const canProbe =
    session.current_user === options.role &&
    Boolean(column) &&
    Boolean(column?.policy_type) &&
    Boolean(privileges?.can_select);

  if (!canProbe) {
    addCheck(checks, {
      id: 'probe.active',
      category: 'probe',
      status: 'skip',
      message: 'Active probe skipped because the runtime role, tenant column, or SELECT grant is invalid.',
    });
    return;
  }

  if (column?.policy_type === 'uuid') {
    const invalidOptions = [
      UUID_REGEX.test(options.tenantA as string) ? null : '--tenant-a',
      UUID_REGEX.test(options.tenantB as string) ? null : '--tenant-b',
    ].filter((option): option is string => option !== null);
    if (invalidOptions.length > 0) {
      addCheck(checks, {
        id: 'probe.active',
        category: 'probe',
        status: 'fail',
        message: `Active probe requires dashed UUID values for a UUID tenant column; invalid option(s): ${invalidOptions.join(', ')}.`,
        details: {
          tenantColumnType: 'uuid',
          invalidOptions,
        },
      });
      return;
    }
  }

  await runActiveDoctorProbes(
    client,
    options,
    checks,
    column?.policy_type as TenantColumnPolicyType,
    signal,
    statementTimeoutMs,
  );
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Doctor batch was interrupted.');
}

function addSessionChecks(
  checks: DoctorCheck[],
  session: SessionRow,
  expectedRole: string,
): void {
  addCheck(checks, {
    id: 'session.current_role',
    category: 'session',
    status: session.current_user === expectedRole ? 'pass' : 'fail',
    message: session.current_user === expectedRole
      ? `current_user matches application role ${expectedRole}.`
      : `current_user is ${session.current_user}; expected application role ${expectedRole}. Use the runtime application-role URL.`,
    details: { currentUser: session.current_user, sessionUser: session.session_user },
  });
  addCheck(checks, {
    id: 'session.current_role_security',
    category: 'session',
    status: !session.current_superuser && !session.current_bypassrls ? 'pass' : 'fail',
    message: !session.current_superuser && !session.current_bypassrls
      ? 'current_user cannot bypass row-level security.'
      : 'current_user has SUPERUSER or BYPASSRLS and bypasses row-level security.',
    details: {
      superuser: session.current_superuser,
      bypassRls: session.current_bypassrls,
    },
  });
  addCheck(checks, {
    id: 'session.login_role_security',
    category: 'session',
    status: !session.session_superuser && !session.session_bypassrls ? 'pass' : 'fail',
    message: !session.session_superuser && !session.session_bypassrls
      ? 'session_user cannot directly bypass row-level security.'
      : 'session_user has SUPERUSER or BYPASSRLS and can regain a bypassing role.',
    details: {
      superuser: session.session_superuser,
      bypassRls: session.session_bypassrls,
    },
  });
}

function addRoleChecks(checks: DoctorCheck[], role: RoleRow | undefined): void {
  addCheck(checks, {
    id: 'role.exists',
    category: 'role',
    status: role ? 'pass' : 'fail',
    message: role ? `Application role ${role.rolname} exists.` : 'Expected application role does not exist.',
  });
  if (!role) return;

  addCheck(checks, {
    id: 'role.security_attributes',
    category: 'role',
    status: !role.rolsuper && !role.rolbypassrls ? 'pass' : 'fail',
    message: !role.rolsuper && !role.rolbypassrls
      ? 'Application role is neither SUPERUSER nor BYPASSRLS.'
      : 'Application role has SUPERUSER or BYPASSRLS.',
    details: {
      superuser: role.rolsuper,
      bypassRls: role.rolbypassrls,
      inherit: role.rolinherit,
      canLogin: role.rolcanlogin,
    },
  });
  addCheck(checks, {
    id: 'role.can_login',
    category: 'role',
    status: role.rolcanlogin ? 'pass' : 'fail',
    message: role.rolcanlogin
      ? 'Application role is a LOGIN role suitable for the runtime connection.'
      : 'Application role is NOLOGIN; connect directly as the actual runtime login role.',
  });
}

function addTableExistenceCheck(
  checks: DoctorCheck[],
  table: TableRow | undefined,
  options: ValidatedDoctorOptions,
): void {
  addCheck(checks, {
    id: 'catalog.table_exists',
    category: 'catalog',
    status: table ? 'pass' : 'fail',
    message: table
      ? `Table ${options.schema}.${options.table} exists.`
      : `Table ${options.schema}.${options.table} does not exist or is not a table/partitioned table.`,
  });
}

function addCatalogChecks(
  checks: DoctorCheck[],
  table: TableRow,
  column: ColumnRow | undefined,
  index: IndexRow | undefined,
  privileges: PrivilegeRow | undefined,
  options: ValidatedDoctorOptions,
): void {
  addCheck(checks, {
    id: 'catalog.rls_enabled',
    category: 'catalog',
    status: table.relrowsecurity ? 'pass' : 'fail',
    message: table.relrowsecurity ? 'ROW LEVEL SECURITY is enabled.' : 'ROW LEVEL SECURITY is not enabled.',
  });
  addCheck(checks, {
    id: 'catalog.rls_forced',
    category: 'catalog',
    status: table.relforcerowsecurity ? 'pass' : 'fail',
    message: table.relforcerowsecurity
      ? 'FORCE ROW LEVEL SECURITY is enabled.'
      : 'FORCE ROW LEVEL SECURITY is not enabled.',
  });
  addCheck(checks, {
    id: 'catalog.rls_active',
    category: 'catalog',
    status: table.row_security_active ? 'pass' : 'fail',
    message: table.row_security_active
      ? 'PostgreSQL reports row security active for current_user.'
      : 'PostgreSQL reports row security inactive for current_user.',
  });

  const ownsTable = table.table_owner === options.role;
  addCheck(checks, {
    id: 'catalog.application_role_not_owner',
    category: 'catalog',
    status: table.owner_rights_active ? 'fail' : 'pass',
    message: table.owner_rights_active
      ? 'Application role has effective table-owner rights and can alter or disable RLS.'
      : `Table is owned by ${table.table_owner}, not the application role.`,
    details: {
      owner: table.table_owner,
      directOwner: ownsTable,
      ownerRightsActive: table.owner_rights_active,
    },
  });

  addCheck(checks, {
    id: 'catalog.tenant_column_exists',
    category: 'catalog',
    status: column ? 'pass' : 'fail',
    message: column
      ? `Tenant column ${options.tenantColumn} exists (${column.data_type}).`
      : `Tenant column ${options.tenantColumn} does not exist.`,
    details: column ? { dataType: column.data_type } : undefined,
  });
  if (column) {
    addCheck(checks, {
      id: 'catalog.tenant_column_not_null',
      category: 'catalog',
      status: column.not_null ? 'pass' : 'fail',
      message: column.not_null ? 'Tenant column is NOT NULL.' : 'Tenant column is nullable.',
    });
    addCheck(checks, {
      id: 'catalog.tenant_index',
      category: 'catalog',
      status: index?.has_tenant_index ? 'pass' : 'fail',
      message: index?.has_tenant_index
        ? 'A valid, ready index includes the tenant column.'
        : 'No valid, ready index includes the tenant column.',
    });
    addCheck(checks, {
      id: 'catalog.tenant_column_type',
      category: 'catalog',
      status: column.policy_type ? 'pass' : 'fail',
      message: column.policy_type === 'text'
        ? `Tenant column type ${column.data_type} matches generated text policy semantics.`
        : column.policy_type === 'uuid'
          ? `Tenant column type ${column.data_type} matches generated UUID policy semantics.`
          : `Tenant column type ${column.data_type} is not compatible with the generated TEXT/UUID policy contract.`,
    });
    addCheck(checks, {
      id: 'catalog.tenant_column_generated',
      category: 'catalog',
      status: column.generated === '' && column.identity === '' ? 'pass' : 'fail',
      message: column.generated === '' && column.identity === ''
        ? 'Tenant column is stored, not generated or identity.'
        : 'Tenant column is generated or identity; the tenancy write contract expects a regular stored column.',
    });
  }

  addCheck(checks, {
    id: 'catalog.table_privileges',
    category: 'catalog',
    status: privileges &&
      privileges.schema_usage &&
      privileges.can_select &&
      privileges.can_insert &&
      privileges.can_update &&
      privileges.can_delete &&
      !privileges.can_truncate ? 'pass' : 'fail',
    message: privileges &&
      privileges.schema_usage &&
      privileges.can_select &&
      privileges.can_insert &&
      privileges.can_update &&
      privileges.can_delete &&
      !privileges.can_truncate
      ? 'Application role has schema USAGE and expected DML grants without TRUNCATE.'
      : 'Application role grants differ: require schema USAGE and SELECT/INSERT/UPDATE/DELETE, and forbid TRUNCATE.',
    details: privileges ? {
      schemaUsage: privileges.schema_usage,
      select: privileges.can_select,
      insert: privileges.can_insert,
      update: privileges.can_update,
      delete: privileges.can_delete,
      truncate: privileges.can_truncate,
    } : undefined,
  });
}

async function queryReachableRoles(
  client: DoctorClient,
  role: string,
  owner: string,
): Promise<{ rows: ReachableRoleRow[]; mode: 'SET' | 'MEMBER' }> {
  try {
    const result = await client.query<ReachableRoleRow>(REACHABLE_ROLES_SQL, [role, owner, 'SET']);
    return { rows: result.rows, mode: 'SET' };
  } catch {
    // PostgreSQL versions before SET membership checks are handled conservatively.
    const result = await client.query<ReachableRoleRow>(REACHABLE_ROLES_SQL, [role, owner, 'MEMBER']);
    return { rows: result.rows, mode: 'MEMBER' };
  }
}

function addReachableRoleChecks(
  checks: DoctorCheck[],
  roles: ReachableRoleRow[],
  mode: 'SET' | 'MEMBER',
  owner: string,
): void {
  const dangerous = roles.filter(
    (role) => role.reachable && (role.superuser || role.bypassrls || role.role_name === owner),
  );
  addCheck(checks, {
    id: 'role.reachable_bypass_roles',
    category: 'role',
    status: dangerous.length === 0 ? 'pass' : 'fail',
    message: dangerous.length > 0
      ? `Application role can reach RLS-bypassing or owner role(s): ${dangerous.map((role) => role.role_name).join(', ')}.`
      : mode === 'SET'
        ? 'Application role cannot SET ROLE to the table owner, SUPERUSER, or BYPASSRLS roles.'
        : 'No dangerous role membership found; MEMBER semantics were used for this PostgreSQL version.',
    details: { auditMode: mode, roles: dangerous.map((role) => role.role_name) },
  });
}

function addPolicyChecks(
  checks: DoctorCheck[],
  policies: PolicyRow[],
  options: ValidatedDoctorOptions,
  maxIdentifierLength: number,
  policyType: TenantColumnPolicyType | null,
): void {
  const names = generateRelationNames({
    schemaName: options.schema,
    tableName: options.table,
    tenantIdField: options.tenantColumn,
  });
  const isolationName = postgresCatalogIdentifier(
    names.isolationPolicy,
    maxIdentifierLength,
  );
  const insertName = postgresCatalogIdentifier(
    names.insertPolicy,
    maxIdentifierLength,
  );
  const contextGuardName = postgresCatalogIdentifier(
    names.contextGuardPolicy,
    maxIdentifierLength,
  );
  const isolation = policies.find((policy) =>
    policy.policy_name === isolationName
  );
  const insert = policies.find((policy) => policy.policy_name === insertName);
  const contextGuard = policies.find((policy) =>
    policy.policy_name === contextGuardName
  );

  addCheck(checks, {
    id: 'policy.isolation_exists',
    category: 'policy',
    status: isolation ? 'pass' : 'fail',
    message: isolation
      ? `Expected policy ${isolation.policy_name} exists.`
      : `Expected policy ${isolationName} is missing.`,
  });
  if (isolation) {
    const contractMatches =
      isolation.command === 'ALL' &&
      isolation.permissive &&
      hasExactPublicRole(isolation.roles) &&
      expressionMatchesGeneratedContract(
        isolation.using_expression,
        options.tenantColumn,
        options.dbSettingKey,
        policyType,
      ) &&
      isolation.with_check_expression === null;
    addCheck(checks, {
      id: 'policy.isolation_contract',
      category: 'policy',
      status: contractMatches ? 'pass' : 'fail',
      message: contractMatches
        ? 'Isolation policy matches generated ALL/PERMISSIVE/PUBLIC/USING contract.'
        : 'Isolation policy command, mode, roles, USING, or WITH CHECK differs from generated SQL.',
      details: policyDetails(isolation),
    });
  }

  addCheck(checks, {
    id: 'policy.insert_exists',
    category: 'policy',
    status: insert ? 'pass' : 'fail',
    message: insert
      ? `Expected policy ${insert.policy_name} exists.`
      : `Expected policy ${insertName} is missing.`,
  });
  if (insert) {
    const contractMatches =
      insert.command === 'INSERT' &&
      insert.permissive &&
      hasExactPublicRole(insert.roles) &&
      insert.using_expression === null &&
      expressionMatchesGeneratedContract(
        insert.with_check_expression,
        options.tenantColumn,
        options.dbSettingKey,
        policyType,
      );
    addCheck(checks, {
      id: 'policy.insert_contract',
      category: 'policy',
      status: contractMatches ? 'pass' : 'fail',
      message: contractMatches
        ? 'Insert policy matches generated INSERT/PERMISSIVE/PUBLIC/WITH CHECK contract.'
        : 'Insert policy command, mode, roles, USING, or WITH CHECK differs from generated SQL.',
      details: policyDetails(insert),
    });
  }

  const contextGuardContractMatches = contextGuard !== undefined &&
    contextGuard.command === 'ALL' &&
    !contextGuard.permissive &&
    hasExactPublicRole(contextGuard.roles) &&
    contextGuardExpressionMatchesGeneratedContract(
      contextGuard.using_expression,
      options.dbSettingKey,
    ) &&
    contextGuardExpressionMatchesGeneratedContract(
      contextGuard.with_check_expression,
      options.dbSettingKey,
    );
  addCheck(checks, {
    id: 'policy.context_guard_contract',
    category: 'policy',
    status: contextGuardContractMatches ? 'pass' : 'fail',
    message: contextGuardContractMatches
      ? 'Context guard policy matches generated ALL/RESTRICTIVE/PUBLIC/USING/WITH CHECK contract.'
      : contextGuard
        ? 'Context guard policy command, mode, roles, USING, or WITH CHECK differs from generated SQL.'
        : `Expected restrictive context guard policy ${contextGuardName} is missing.`,
    details: contextGuard ? policyDetails(contextGuard) : undefined,
  });

  const unexpectedPermissive = policies.filter((policy) => {
    const name = policy.policy_name;
    return policy.permissive &&
      name !== isolationName &&
      name !== insertName;
  });
  addCheck(checks, {
    id: 'policy.no_unexpected_permissive',
    category: 'policy',
    status: unexpectedPermissive.length === 0 ? 'pass' : 'fail',
    message: unexpectedPermissive.length === 0
      ? 'No unexpected permissive policy applies to the application role.'
      : `Unexpected permissive policy may broaden access: ${unexpectedPermissive.map((policy) => policy.policy_name).join(', ')}.`,
    details: { policies: unexpectedPermissive.map((policy) => policy.policy_name) },
  });
}

function addSkippedDependentChecks(
  checks: DoctorCheck[],
  active: boolean,
  reason: string,
): void {
  addCheck(checks, {
    id: 'catalog.dependent_checks',
    category: 'catalog',
    status: 'skip',
    message: `Dependent catalog checks skipped because ${reason}.`,
  });
  if (active) {
    addCheck(checks, {
      id: 'probe.active',
      category: 'probe',
      status: 'skip',
      message: `Active probe skipped because ${reason}.`,
    });
  }
}

function policyDetails(policy: PolicyRow): Record<string, unknown> {
  return {
    command: policy.command,
    permissive: policy.permissive,
    roles: normalizePolicyRoles(policy.roles),
    using: policy.using_expression,
    withCheck: policy.with_check_expression,
  };
}

function hasExactPublicRole(roles: unknown): boolean {
  const normalized = normalizePolicyRoles(roles);
  return normalized.length === 1 && normalized[0].toUpperCase() === 'PUBLIC';
}

function normalizePolicyRoles(roles: unknown): string[] {
  if (Array.isArray(roles)) return roles.map(String);
  if (typeof roles !== 'string') return [];
  if (roles.startsWith('{') && roles.endsWith('}')) {
    return roles.slice(1, -1).split(',').filter(Boolean).map((role) => role.replace(/^"|"$/g, ''));
  }
  return [roles];
}

function addCheck(checks: DoctorCheck[], check: DoctorCheck): void {
  checks.push(check);
}
