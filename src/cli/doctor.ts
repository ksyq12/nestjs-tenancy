import {
  isValidPostgresIdentifier,
  isValidPostgresSettingKey,
  quoteSqlIdentifier,
} from '../postgres-safety';
import { DEFAULT_DB_SETTING_KEY, UUID_REGEX } from '../tenancy.constants';
import {
  generateRelationNames,
  postgresCatalogIdentifier,
} from './generated-name';
import type { TenantColumnPolicyType } from './tenant-column';

export const DOCTOR_SCHEMA_VERSION = 1 as const;

export const DoctorExitCode = {
  HEALTHY: 0,
  FINDINGS: 1,
  ERROR: 2,
} as const;

export type DoctorExitCodeValue =
  (typeof DoctorExitCode)[keyof typeof DoctorExitCode];

export type DoctorCheckCategory = 'session' | 'role' | 'catalog' | 'policy' | 'probe';
export type DoctorCheckStatus = 'pass' | 'fail' | 'warn' | 'skip';
export type DoctorStatus = 'healthy' | 'warning' | 'unhealthy' | 'error';

export interface DoctorCheck {
  id: string;
  category: DoctorCheckCategory;
  status: DoctorCheckStatus;
  message: string;
  details?: Record<string, unknown>;
}

export interface DoctorTarget {
  schema: string;
  table: string;
  role: string;
  settingKey: string;
  tenantColumn: string;
  activeProbe: boolean;
}

export interface DoctorSummary {
  passed: number;
  failed: number;
  warnings: number;
  skipped: number;
}

export interface DoctorError {
  code: 'INVALID_OPTIONS' | 'DRIVER_UNAVAILABLE' | 'CONNECTION_FAILED' | 'QUERY_FAILED';
  message: string;
}

export interface DoctorResult {
  schemaVersion: typeof DOCTOR_SCHEMA_VERSION;
  status: DoctorStatus;
  exitCode: DoctorExitCodeValue;
  target?: DoctorTarget;
  summary: DoctorSummary;
  checks: DoctorCheck[];
  error?: DoctorError;
}

export interface DoctorOptions {
  /** PostgreSQL connection URL for the actual application role. */
  url?: string;
  /** Fully-qualified table name in the form schema.table. */
  table: string;
  /** Expected runtime application role. Must equal PostgreSQL current_user. */
  role: string;
  dbSettingKey?: string;
  tenantColumn?: string;
  active?: boolean;
  tenantA?: string;
  tenantB?: string;
}

export interface DoctorQueryResult<Row extends Record<string, unknown>> {
  rows: Row[];
  rowCount?: number | null;
}

export interface DoctorClient {
  connect(): Promise<void>;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<DoctorQueryResult<Row>>;
  end(): Promise<void>;
}

export interface DoctorDependencies {
  clientFactory?: (url: string) => DoctorClient;
}

export interface DoctorCliOptions extends DoctorOptions {
  url: string;
  json: boolean;
}

export type DoctorCliParseResult =
  | { kind: 'options'; options: DoctorCliOptions }
  | { kind: 'help' }
  | { kind: 'error'; message: string; json: boolean };

interface ValidatedDoctorOptions {
  url: string;
  schema: string;
  table: string;
  role: string;
  dbSettingKey: string;
  tenantColumn: string;
  active: boolean;
  tenantA?: string;
  tenantB?: string;
}

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

interface SettingRow extends Record<string, unknown> {
  setting_value: string | null;
}

interface VisibleRow extends Record<string, unknown> {
  has_visible: boolean;
}

interface TenantProbeRow extends Record<string, unknown> {
  has_visible: boolean;
  has_mismatch: boolean;
}

class DoctorRuntimeError extends Error {
  constructor(
    readonly code: DoctorError['code'],
    message: string,
  ) {
    super(message);
    this.name = 'DoctorRuntimeError';
  }
}

const DEFAULT_TENANT_COLUMN = 'tenant_id';

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

/**
 * Audit a live PostgreSQL database. This function never logs and never includes
 * the connection URL in its structured result.
 */
export async function runDoctor(
  options: DoctorOptions,
  dependencies: DoctorDependencies = {},
): Promise<DoctorResult> {
  const validation = validateDoctorOptions(options);
  if (typeof validation === 'string') {
    return errorResult('INVALID_OPTIONS', validation);
  }

  const target = toTarget(validation);
  const checks: DoctorCheck[] = [];
  let client: DoctorClient | undefined;
  let result: DoctorResult;

  try {
    try {
      client = (dependencies.clientFactory ?? defaultClientFactory)(validation.url);
    } catch (error) {
      const runtimeError = asRuntimeError(error, 'DRIVER_UNAVAILABLE');
      return errorResult(runtimeError.code, redactError(runtimeError.message, validation.url), target);
    }

    try {
      await client.connect();
    } catch (error) {
      throw new DoctorRuntimeError(
        'CONNECTION_FAILED',
        `Could not connect to PostgreSQL: ${errorMessage(error)}`,
      );
    }

    try {
      await auditDatabase(client, validation, checks);
      result = checksResult(target, checks);
    } catch (error) {
      const runtimeError = asRuntimeError(error, 'QUERY_FAILED');
      result = errorResult(
        runtimeError.code,
        redactError(runtimeError.message, validation.url),
        target,
        checks,
      );
    }
  } catch (error) {
    const runtimeError = asRuntimeError(error, 'QUERY_FAILED');
    result = errorResult(
      runtimeError.code,
      redactError(runtimeError.message, validation.url),
      target,
      checks,
    );
  } finally {
    if (client) {
      try {
        await client.end();
      } catch {
        // The audit result is already complete. Never replace it with a close error.
      }
    }
  }

  return result;
}

async function auditDatabase(
  client: DoctorClient,
  options: ValidatedDoctorOptions,
  checks: DoctorCheck[],
): Promise<void> {
  await client.query(
    'SELECT pg_catalog.set_config($1, $2, false)',
    ['search_path', 'pg_catalog'],
  );
  const session = (await client.query<SessionRow>(SESSION_SQL)).rows[0];
  if (!session) {
    throw new DoctorRuntimeError('QUERY_FAILED', 'PostgreSQL did not return current role information.');
  }

  const role = (await client.query<RoleRow>(ROLE_SQL, [options.role])).rows[0];
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
  const privilegeResult = await client.query<PrivilegeRow>(
    PRIVILEGE_SQL,
    [options.role, table.table_oid, options.schema],
  );
  const policyResult = await client.query<PolicyRow>(POLICY_SQL, [table.table_oid]);
  const reachableRoles = await queryReachableRoles(client, options.role, table.table_owner);

  const column = columnResult.rows[0];
  const privileges = privilegeResult.rows[0];
  const policies = policyResult.rows;
  const index = column
    ? (await client.query<IndexRow>(INDEX_SQL, [table.table_oid, column.attribute_number])).rows[0]
    : undefined;

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

  await runActiveProbes(
    client,
    options,
    checks,
    column?.policy_type as TenantColumnPolicyType,
  );
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

async function runActiveProbes(
  client: DoctorClient,
  options: ValidatedDoctorOptions,
  checks: DoctorCheck[],
  policyType: TenantColumnPolicyType,
): Promise<void> {
  const tenantA = options.tenantA as string;
  const tenantB = options.tenantB as string;

  const initial = await noContextProbe(client, options, false);
  addNoContextCheck(checks, 'probe.no_context', 'Initial no-context probe', initial);

  const a = await tenantProbe(client, options, tenantA, true, policyType);
  addTenantProbeCheck(checks, 'probe.tenant_a', 'Tenant A', a);

  const afterCommit = await noContextProbe(client, options, false);
  addNoContextCheck(checks, 'probe.cleanup_after_commit', 'Post-COMMIT no-context probe', afterCommit);

  const b = await tenantProbe(client, options, tenantB, false, policyType);
  addTenantProbeCheck(checks, 'probe.tenant_b', 'Tenant B', b);

  const afterRollback = await noContextProbe(client, options, false);
  addNoContextCheck(checks, 'probe.cleanup_after_rollback', 'Post-ROLLBACK no-context probe', afterRollback);
}

async function noContextProbe(
  client: DoctorClient,
  options: ValidatedDoctorOptions,
  commit: boolean,
): Promise<{ setting: string | null; hasVisible: boolean }> {
  return withReadOnlyTransaction(client, commit, async () => {
    const setting = (await client.query<SettingRow>(
      'SELECT current_setting($1, true) AS setting_value',
      [options.dbSettingKey],
    )).rows[0]?.setting_value ?? null;
    const table = quoteQualifiedIdentifier(options.schema, options.table);
    const visible = (await client.query<VisibleRow>(
      `SELECT EXISTS (SELECT 1 FROM ${table}) AS has_visible`,
    )).rows[0]?.has_visible ?? false;
    return { setting, hasVisible: visible };
  });
}

async function tenantProbe(
  client: DoctorClient,
  options: ValidatedDoctorOptions,
  tenantId: string,
  commit: boolean,
  policyType: TenantColumnPolicyType,
): Promise<{ hasVisible: boolean; hasMismatch: boolean }> {
  return withReadOnlyTransaction(client, commit, async () => {
    await client.query(
      'SELECT set_config($1, $2, true)',
      [options.dbSettingKey, tenantId],
    );
    const table = quoteQualifiedIdentifier(options.schema, options.table);
    const column = quoteSqlIdentifier(options.tenantColumn);
    const mismatchPredicate = policyType === 'uuid'
      ? `${column} IS DISTINCT FROM $1::uuid`
      : `${column}::text IS DISTINCT FROM $1`;
    const result = await client.query<TenantProbeRow>(
      `SELECT
        EXISTS (SELECT 1 FROM ${table}) AS has_visible,
        EXISTS (
          SELECT 1 FROM ${table}
          WHERE ${mismatchPredicate}
        ) AS has_mismatch`,
      [tenantId],
    );
    return {
      hasVisible: result.rows[0]?.has_visible ?? false,
      hasMismatch: result.rows[0]?.has_mismatch ?? false,
    };
  });
}

async function withReadOnlyTransaction<T>(
  client: DoctorClient,
  commit: boolean,
  action: () => Promise<T>,
): Promise<T> {
  await client.query('BEGIN READ ONLY');
  let finished = false;
  try {
    await client.query(
      'SELECT pg_catalog.set_config($1, $2, true)',
      ['statement_timeout', '10000'],
    );
    const value = await action();
    await client.query(commit ? 'COMMIT' : 'ROLLBACK');
    finished = true;
    return value;
  } finally {
    if (!finished) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the original probe error.
      }
    }
  }
}

function addNoContextCheck(
  checks: DoctorCheck[],
  id: string,
  label: string,
  probe: { setting: string | null; hasVisible: boolean },
): void {
  const settingIsEmpty = probe.setting === null || probe.setting === '';
  const passed = settingIsEmpty && !probe.hasVisible;
  addCheck(checks, {
    id,
    category: 'probe',
    status: passed ? 'pass' : 'fail',
    message: passed
      ? `${label} is fail-closed: setting is empty and no rows are visible.`
      : `${label} failed: tenant setting persisted or rows are visible without context.`,
    details: { settingEmpty: settingIsEmpty, hasVisibleRows: probe.hasVisible },
  });
}

function addTenantProbeCheck(
  checks: DoctorCheck[],
  id: string,
  label: string,
  probe: { hasVisible: boolean; hasMismatch: boolean },
): void {
  const status: DoctorCheckStatus = probe.hasMismatch
    ? 'fail'
    : probe.hasVisible
      ? 'pass'
      : 'warn';
  addCheck(checks, {
    id,
    category: 'probe',
    status,
    message: probe.hasMismatch
      ? `${label} can see rows belonging to another tenant.`
      : probe.hasVisible
        ? `${label} sees rows and every visible row has the expected tenant ID.`
        : `${label} sees no rows; the probe is inconclusive.`,
    details: { hasVisibleRows: probe.hasVisible, hasMismatchedRows: probe.hasMismatch },
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

function expressionMatchesGeneratedContract(
  expression: string | null,
  tenantColumn: string,
  settingKey: string,
  policyType: TenantColumnPolicyType | null,
): boolean {
  if (expression === null || policyType === null) return false;
  const parsed = parseTenantPolicyExpression(expression, policyType);
  return parsed?.column === tenantColumn && parsed.settingKey === settingKey;
}

function contextGuardExpressionMatchesGeneratedContract(
  expression: string | null,
  settingKey: string,
): boolean {
  if (expression === null) return false;
  return parseContextGuardPolicyExpression(expression)?.settingKey === settingKey;
}

interface PolicyToken {
  kind: 'identifier' | 'string' | 'symbol';
  value: string;
  quoted?: boolean;
}

/** Parse only the exact predicate shape emitted by generateSetupSql(). */
function parseTenantPolicyExpression(
  expression: string,
  policyType: TenantColumnPolicyType,
): { column: string; settingKey: string } | null {
  const rawTokens = tokenizePolicyExpression(expression);
  if (!rawTokens) return null;

  const tokens = rawTokens.filter(
    (token) => !(token.kind === 'symbol' && (token.value === '(' || token.value === ')')),
  );
  let index = 0;
  const column = tokens[index++];
  if (column?.kind !== 'identifier') return null;

  if (policyType === 'text' && hasCast(tokens, index, 'text')) index += 2;
  if (!isSymbol(tokens[index++], '=')) return null;

  if (policyType === 'uuid') {
    if (!isIdentifier(tokens[index++], 'nullif')) return null;
  }

  if (
    isIdentifier(tokens[index], 'pg_catalog') &&
    isSymbol(tokens[index + 1], '.')
  ) {
    index += 2;
  }
  if (!isIdentifier(tokens[index++], 'current_setting')) return null;

  const setting = tokens[index++];
  if (setting?.kind !== 'string') return null;
  if (hasCast(tokens, index, 'text')) index += 2;
  if (!isSymbol(tokens[index++], ',')) return null;
  if (!isIdentifier(tokens[index++], 'true')) return null;

  if (policyType === 'uuid') {
    if (!isSymbol(tokens[index++], ',')) return null;
    const emptyFallback = tokens[index++];
    if (emptyFallback?.kind !== 'string' || emptyFallback.value !== '') {
      return null;
    }
    if (hasCast(tokens, index, 'text')) index += 2;
    if (!hasCast(tokens, index, 'uuid')) return null;
    index += 2;
  } else if (hasCast(tokens, index, 'text')) {
    index += 2;
  }

  if (index !== tokens.length) return null;
  return { column: column.value, settingKey: setting.value };
}

/** Parse only the fail-closed context predicate emitted by generateSetupSql(). */
function parseContextGuardPolicyExpression(
  expression: string,
): { settingKey: string } | null {
  const rawTokens = tokenizePolicyExpression(expression);
  if (!rawTokens) return null;

  const tokens = rawTokens.filter(
    (token) => !(token.kind === 'symbol' && (token.value === '(' || token.value === ')')),
  );
  let index = 0;

  if (!isIdentifier(tokens[index++], 'nullif')) return null;
  if (
    isIdentifier(tokens[index], 'pg_catalog') &&
    isSymbol(tokens[index + 1], '.')
  ) {
    index += 2;
  }
  if (!isIdentifier(tokens[index++], 'current_setting')) return null;

  const setting = tokens[index++];
  if (setting?.kind !== 'string') return null;
  if (hasCast(tokens, index, 'text')) index += 2;
  if (!isSymbol(tokens[index++], ',')) return null;
  if (!isIdentifier(tokens[index++], 'true')) return null;
  if (!isSymbol(tokens[index++], ',')) return null;

  const emptyFallback = tokens[index++];
  if (emptyFallback?.kind !== 'string' || emptyFallback.value !== '') {
    return null;
  }
  if (hasCast(tokens, index, 'text')) index += 2;
  if (!isIdentifier(tokens[index++], 'is')) return null;
  if (!isIdentifier(tokens[index++], 'not')) return null;
  if (!isIdentifier(tokens[index++], 'null')) return null;
  if (index !== tokens.length) return null;

  return { settingKey: setting.value };
}

function hasCast(
  tokens: PolicyToken[],
  index: number,
  castType: TenantColumnPolicyType,
): boolean {
  return isSymbol(tokens[index], '::') &&
    isIdentifier(tokens[index + 1], castType);
}

function tokenizePolicyExpression(expression: string): PolicyToken[] | null {
  const tokens: PolicyToken[] = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (expression.startsWith('::', index)) {
      tokens.push({ kind: 'symbol', value: '::' });
      index += 2;
      continue;
    }
    if ('(),=.'.includes(char)) {
      tokens.push({ kind: 'symbol', value: char });
      index += 1;
      continue;
    }
    if (char === '"') {
      let value = '';
      index += 1;
      let closed = false;
      while (index < expression.length) {
        if (expression[index] === '"') {
          if (expression[index + 1] === '"') {
            value += '"';
            index += 2;
            continue;
          }
          index += 1;
          closed = true;
          break;
        }
        value += expression[index];
        index += 1;
      }
      if (!closed) return null;
      tokens.push({ kind: 'identifier', value, quoted: true });
      continue;
    }
    if (char === "'") {
      let value = '';
      index += 1;
      let closed = false;
      while (index < expression.length) {
        if (expression[index] === "'") {
          if (expression[index + 1] === "'") {
            value += "'";
            index += 2;
            continue;
          }
          index += 1;
          closed = true;
          break;
        }
        value += expression[index];
        index += 1;
      }
      if (!closed) return null;
      tokens.push({ kind: 'string', value });
      continue;
    }
    const identifier = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(expression.slice(index));
    if (!identifier) return null;
    tokens.push({ kind: 'identifier', value: identifier[0].toLowerCase(), quoted: false });
    index += identifier[0].length;
  }
  return tokens;
}

function isIdentifier(token: PolicyToken | undefined, value: string): boolean {
  return token?.kind === 'identifier' && !token.quoted && token.value === value;
}

function isSymbol(token: PolicyToken | undefined, value: string): boolean {
  return token?.kind === 'symbol' && token.value === value;
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

function quoteQualifiedIdentifier(schema: string, table: string): string {
  return `${quoteSqlIdentifier(schema)}.${quoteSqlIdentifier(table)}`;
}

function addCheck(checks: DoctorCheck[], check: DoctorCheck): void {
  checks.push(check);
}

function validateDoctorOptions(options: DoctorOptions): ValidatedDoctorOptions | string {
  const url = options.url?.trim();
  if (!url) return 'A PostgreSQL URL is required through --url or DATABASE_URL.';

  const qualifiedTable = parseQualifiedTable(options.table);
  if (typeof qualifiedTable === 'string') return qualifiedTable;
  if (!isSafeText(options.role)) return '--role must be a non-empty PostgreSQL role name without NUL bytes.';

  const settingKey = options.dbSettingKey ?? DEFAULT_DB_SETTING_KEY;
  if (!isValidPostgresSettingKey(settingKey)) {
    return '--db-setting-key must be a dotted PostgreSQL custom setting name (for example app.current_tenant).';
  }

  const tenantColumn = options.tenantColumn ?? DEFAULT_TENANT_COLUMN;
  if (!isValidPostgresIdentifier(tenantColumn) || tenantColumn.includes('.')) {
    return '--tenant-column must be one non-empty PostgreSQL identifier without NUL bytes.';
  }

  const active = options.active ?? false;
  if (active) {
    if (!isSafeText(options.tenantA) || !isSafeText(options.tenantB)) {
      return '--active requires non-empty --tenant-a and --tenant-b values.';
    }
    if (options.tenantA === options.tenantB) {
      return '--tenant-a and --tenant-b must be different.';
    }
  } else if (options.tenantA !== undefined || options.tenantB !== undefined) {
    return '--tenant-a and --tenant-b are only valid with --active.';
  }

  return {
    url,
    schema: qualifiedTable.schema,
    table: qualifiedTable.table,
    role: options.role,
    dbSettingKey: settingKey,
    tenantColumn,
    active,
    tenantA: options.tenantA,
    tenantB: options.tenantB,
  };
}

function parseQualifiedTable(value: string): { schema: string; table: string } | string {
  if (!isSafeText(value)) return '--table is required in schema.table form.';
  const dot = value.indexOf('.');
  if (dot <= 0 || dot !== value.lastIndexOf('.') || dot === value.length - 1) {
    return '--table must be fully qualified in schema.table form.';
  }
  const schema = value.slice(0, dot);
  const table = value.slice(dot + 1);
  if (!isValidPostgresIdentifier(schema) || !isValidPostgresIdentifier(table)) {
    return '--table schema and table names must be non-empty PostgreSQL identifiers without NUL bytes and at most 63 UTF-8 bytes.';
  }
  return { schema, table };
}

function isSafeText(value: string | undefined): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0');
}

function toTarget(options: ValidatedDoctorOptions): DoctorTarget {
  return {
    schema: options.schema,
    table: options.table,
    role: options.role,
    settingKey: options.dbSettingKey,
    tenantColumn: options.tenantColumn,
    activeProbe: options.active,
  };
}

function checksResult(target: DoctorTarget, checks: DoctorCheck[]): DoctorResult {
  const summary = summarize(checks);
  const hasFindings = summary.failed > 0 || summary.warnings > 0;
  return {
    schemaVersion: DOCTOR_SCHEMA_VERSION,
    status: summary.failed > 0 ? 'unhealthy' : summary.warnings > 0 ? 'warning' : 'healthy',
    exitCode: hasFindings ? DoctorExitCode.FINDINGS : DoctorExitCode.HEALTHY,
    target,
    summary,
    checks,
  };
}

function errorResult(
  code: DoctorError['code'],
  message: string,
  target?: DoctorTarget,
  checks: DoctorCheck[] = [],
): DoctorResult {
  return {
    schemaVersion: DOCTOR_SCHEMA_VERSION,
    status: 'error',
    exitCode: DoctorExitCode.ERROR,
    target,
    summary: summarize(checks),
    checks,
    error: { code, message },
  };
}

function summarize(checks: DoctorCheck[]): DoctorSummary {
  return {
    passed: checks.filter((check) => check.status === 'pass').length,
    failed: checks.filter((check) => check.status === 'fail').length,
    warnings: checks.filter((check) => check.status === 'warn').length,
    skipped: checks.filter((check) => check.status === 'skip').length,
  };
}

function defaultClientFactory(url: string): DoctorClient {
  try {
    const pg = require('pg') as {
      Client: new (options: {
        connectionString: string;
        application_name: string;
        connectionTimeoutMillis: number;
      }) => DoctorClient;
    };
    return new pg.Client({
      connectionString: url,
      application_name: '@nestarc/tenancy doctor',
      connectionTimeoutMillis: 10_000,
    });
  } catch (error) {
    throw new DoctorRuntimeError(
      'DRIVER_UNAVAILABLE',
      `The "pg" package is required for the doctor command: ${errorMessage(error)}`,
    );
  }
}

function asRuntimeError(
  error: unknown,
  fallbackCode: DoctorError['code'],
): DoctorRuntimeError {
  return error instanceof DoctorRuntimeError
    ? error
    : new DoctorRuntimeError(fallbackCode, errorMessage(error));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function redactError(message: string, url: string): string {
  const withoutExactUrl = url
    ? message.split(url).join('[REDACTED_DATABASE_URL]')
    : message;
  return withoutExactUrl
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[REDACTED_DATABASE_URL]')
    .replace(/\bpassword\s*=\s*[^\s]+/gi, 'password=[REDACTED]');
}

/** Strict parser for doctor-only CLI flags. Existing init/check parsing remains unchanged. */
export function parseDoctorArgs(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): DoctorCliParseResult {
  if (args.includes('--help') || args.includes('-h')) return { kind: 'help' };

  const json = args.includes('--json');
  const booleans = new Set(['--json', '--active']);
  const valueFlags = new Map<string, keyof DoctorCliOptions>([
    ['--url', 'url'],
    ['--table', 'table'],
    ['--role', 'role'],
    ['--db-setting-key', 'dbSettingKey'],
    ['--tenant-column', 'tenantColumn'],
    ['--tenant-a', 'tenantA'],
    ['--tenant-b', 'tenantB'],
  ]);
  const values = new Map<keyof DoctorCliOptions, string>();
  const seenBooleans = new Set<string>();

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (booleans.has(argument)) {
      if (seenBooleans.has(argument)) {
        return { kind: 'error', message: `Duplicate option: ${argument}`, json };
      }
      seenBooleans.add(argument);
      continue;
    }

    const equalsIndex = argument.indexOf('=');
    const flag = equalsIndex === -1 ? argument : argument.slice(0, equalsIndex);
    const key = valueFlags.get(flag);
    if (!key) {
      const message = flag.startsWith('--')
        ? `Unknown doctor option: ${flag}`
        : 'Unexpected positional argument.';
      return { kind: 'error', message, json };
    }
    if (values.has(key)) {
      return { kind: 'error', message: `Duplicate option: ${flag}`, json };
    }

    let value: string;
    if (equalsIndex !== -1) {
      value = argument.slice(equalsIndex + 1);
    } else {
      index += 1;
      value = args[index];
      if (value === undefined || value.startsWith('--')) {
        return { kind: 'error', message: `Missing value for ${flag}`, json };
      }
    }
    if (value.length === 0) {
      return { kind: 'error', message: `Missing value for ${flag}`, json };
    }
    values.set(key, value);
  }

  const url = values.get('url') ?? env.DATABASE_URL;
  const table = values.get('table');
  const role = values.get('role');
  if (!url) return { kind: 'error', message: 'Set DATABASE_URL or pass --url.', json };
  if (!table) return { kind: 'error', message: 'Missing required option: --table=schema.table', json };
  if (!role) return { kind: 'error', message: 'Missing required option: --role=<application-role>', json };

  const active = seenBooleans.has('--active');
  const tenantA = values.get('tenantA');
  const tenantB = values.get('tenantB');
  if (active && (!tenantA || !tenantB)) {
    return { kind: 'error', message: '--active requires --tenant-a and --tenant-b.', json };
  }
  if (!active && (tenantA || tenantB)) {
    return { kind: 'error', message: '--tenant-a and --tenant-b require --active.', json };
  }
  if (tenantA && tenantB && tenantA === tenantB) {
    return { kind: 'error', message: '--tenant-a and --tenant-b must be different.', json };
  }

  return {
    kind: 'options',
    options: {
      url,
      table,
      role,
      dbSettingKey: values.get('dbSettingKey'),
      tenantColumn: values.get('tenantColumn'),
      active,
      tenantA,
      tenantB,
      json: seenBooleans.has('--json'),
    },
  };
}

export function formatDoctorResult(result: DoctorResult, json: boolean): string {
  if (json) return JSON.stringify(result, null, 2);

  const lines = ['@nestarc/tenancy doctor'];
  if (result.target) {
    lines.push(
      `Target: ${result.target.schema}.${result.target.table} | role=${result.target.role} | setting=${result.target.settingKey}`,
      `Mode: ${result.target.activeProbe ? 'catalog + active read-only probe' : 'catalog audit only'}`,
    );
  }
  lines.push('');

  for (const check of result.checks) {
    lines.push(`[${check.status.toUpperCase()}] ${check.id}: ${check.message}`);
  }
  if (result.error) {
    lines.push(`[ERROR] ${result.error.code}: ${result.error.message}`);
  }
  lines.push(
    '',
    `Status: ${result.status.toUpperCase()} | pass=${result.summary.passed} fail=${result.summary.failed} warn=${result.summary.warnings} skip=${result.summary.skipped}`,
  );
  return lines.join('\n');
}

export function formatDoctorCliError(message: string, json: boolean): string {
  const safeMessage = redactError(message, '');
  if (json) {
    return JSON.stringify({
      schemaVersion: DOCTOR_SCHEMA_VERSION,
      status: 'error',
      exitCode: DoctorExitCode.ERROR,
      summary: { passed: 0, failed: 0, warnings: 0, skipped: 0 },
      checks: [],
      error: { code: 'INVALID_OPTIONS', message: safeMessage },
    }, null, 2);
  }
  return `Doctor usage error: ${safeMessage}`;
}

export function doctorHelp(): string {
  return [
    'Usage: npx @nestarc/tenancy doctor --table=<schema.table> --role=<role> [options]',
    '',
    'Connection:',
    '  --url=<postgresql-url>              Runtime application-role URL (or DATABASE_URL)',
    '',
    'Catalog audit:',
    '  --table=<schema.table>              Fully-qualified table (required)',
    '  --role=<role>                       Expected current_user application role (required)',
    `  --db-setting-key=<key>              Tenant setting key (default: ${DEFAULT_DB_SETTING_KEY})`,
    `  --tenant-column=<column>            Tenant column (default: ${DEFAULT_TENANT_COLUMN})`,
    '',
    'Active read-only probe:',
    '  --active                            Run no-context and tenant A/B isolation probes',
    '  --tenant-a=<id>                     Existing tenant A ID (required with --active)',
    '  --tenant-b=<id>                     Existing tenant B ID (required with --active)',
    '',
    'Output:',
    '  --json                              Emit exactly one JSON result',
    '  --help                              Show this help',
    '',
    'Exit codes: 0 healthy, 1 finding/inconclusive probe, 2 usage/connection/query error',
  ].join('\n');
}
