import { quoteSqlIdentifier } from '../postgres-safety';
import type {
  DoctorCheck,
  DoctorCheckStatus,
  DoctorClient,
  ValidatedDoctorOptions,
} from './doctor-contract';
import type { TenantColumnPolicyType } from './tenant-column';

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

export async function runActiveDoctorProbes(
  client: DoctorClient,
  options: ValidatedDoctorOptions,
  checks: DoctorCheck[],
  policyType: TenantColumnPolicyType,
  signal?: AbortSignal,
  statementTimeoutMs?: number,
): Promise<void> {
  const tenantA = options.tenantA as string;
  const tenantB = options.tenantB as string;

  throwIfAborted(signal);
  const initial = await noContextProbe(client, options, false, signal, statementTimeoutMs);
  addNoContextCheck(checks, 'probe.no_context', 'Initial no-context probe', initial);

  throwIfAborted(signal);
  const a = await tenantProbe(
    client,
    options,
    tenantA,
    true,
    policyType,
    signal,
    statementTimeoutMs,
  );
  addTenantProbeCheck(checks, 'probe.tenant_a', 'Tenant A', a);

  throwIfAborted(signal);
  const afterCommit = await noContextProbe(client, options, false, signal, statementTimeoutMs);
  addNoContextCheck(checks, 'probe.cleanup_after_commit', 'Post-COMMIT no-context probe', afterCommit);

  throwIfAborted(signal);
  const b = await tenantProbe(
    client,
    options,
    tenantB,
    false,
    policyType,
    signal,
    statementTimeoutMs,
  );
  addTenantProbeCheck(checks, 'probe.tenant_b', 'Tenant B', b);

  throwIfAborted(signal);
  const afterRollback = await noContextProbe(
    client,
    options,
    false,
    signal,
    statementTimeoutMs,
  );
  addNoContextCheck(checks, 'probe.cleanup_after_rollback', 'Post-ROLLBACK no-context probe', afterRollback);
}

async function noContextProbe(
  client: DoctorClient,
  options: ValidatedDoctorOptions,
  commit: boolean,
  signal?: AbortSignal,
  statementTimeoutMs?: number,
): Promise<{ setting: string | null; hasVisible: boolean }> {
  return withReadOnlyTransaction(client, commit, signal, statementTimeoutMs, async () => {
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
  signal?: AbortSignal,
  statementTimeoutMs?: number,
): Promise<{ hasVisible: boolean; hasMismatch: boolean }> {
  return withReadOnlyTransaction(client, commit, signal, statementTimeoutMs, async () => {
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
  signal: AbortSignal | undefined,
  statementTimeoutMs: number | undefined,
  action: () => Promise<T>,
): Promise<T> {
  throwIfAborted(signal);
  await client.query('BEGIN READ ONLY');
  let finished = false;
  try {
    await client.query(
      'SELECT pg_catalog.set_config($1, $2, true)',
      ['statement_timeout', String(Math.min(statementTimeoutMs ?? 10_000, 10_000))],
    );
    throwIfAborted(signal);
    const value = await action();
    throwIfAborted(signal);
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

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error('Doctor batch was interrupted.');
}

function addNoContextCheck(
  checks: DoctorCheck[],
  id: string,
  label: string,
  probe: { setting: string | null; hasVisible: boolean },
): void {
  const settingIsEmpty = probe.setting === null || probe.setting === '';
  const passed = settingIsEmpty && !probe.hasVisible;
  checks.push({
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
  checks.push({
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

function quoteQualifiedIdentifier(schema: string, table: string): string {
  return `${quoteSqlIdentifier(schema)}.${quoteSqlIdentifier(table)}`;
}
