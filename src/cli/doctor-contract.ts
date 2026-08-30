import {
  isValidPostgresIdentifier,
  isValidPostgresSettingKey,
} from '../postgres-safety';
import { DEFAULT_DB_SETTING_KEY } from '../tenancy.constants';

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
  code:
    | 'INVALID_OPTIONS'
    | 'INVALID_MANIFEST'
    | 'DRIVER_UNAVAILABLE'
    | 'CONNECTION_FAILED'
    | 'QUERY_FAILED'
    | 'ABORTED'
    | 'TIMEOUT';
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
  /** Cooperative batch cancellation, checked between catalog queries and probe transactions. */
  signal?: AbortSignal;
  /** Error classification used when signal is aborted. */
  abortCode?: Extract<DoctorError['code'], 'ABORTED' | 'TIMEOUT'>;
  /** Session-level bound for catalog and probe SQL in batch mode. */
  statementTimeoutMs?: number;
}

export interface DoctorCliOptions extends DoctorOptions {
  url: string;
  json: boolean;
}

export interface DoctorBatchCliOptions {
  url: string;
  manifestPath: string;
  active: boolean;
  concurrency: number;
  timeoutMs: number;
  json: boolean;
}

export type DoctorCliParseResult =
  | { kind: 'options'; options: DoctorCliOptions }
  | { kind: 'batch-options'; options: DoctorBatchCliOptions }
  | { kind: 'help' }
  | { kind: 'error'; message: string; json: boolean };

export interface ValidatedDoctorOptions {
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

const DEFAULT_TENANT_COLUMN = 'tenant_id';

export function validateDoctorOptions(
  options: DoctorOptions,
): ValidatedDoctorOptions | string {
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

export function toDoctorTarget(options: ValidatedDoctorOptions): DoctorTarget {
  return {
    schema: options.schema,
    table: options.table,
    role: options.role,
    settingKey: options.dbSettingKey,
    tenantColumn: options.tenantColumn,
    activeProbe: options.active,
  };
}

export function doctorChecksResult(
  target: DoctorTarget,
  checks: DoctorCheck[],
): DoctorResult {
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

export function doctorErrorResult(
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

function summarize(checks: DoctorCheck[]): DoctorSummary {
  return {
    passed: checks.filter((check) => check.status === 'pass').length,
    failed: checks.filter((check) => check.status === 'fail').length,
    warnings: checks.filter((check) => check.status === 'warn').length,
    skipped: checks.filter((check) => check.status === 'skip').length,
  };
}

export function redactDoctorError(message: string, url: string): string {
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
  type DoctorCliValueKey = keyof DoctorCliOptions | 'manifestPath' | 'concurrency' | 'timeoutMs';
  const valueFlags = new Map<string, DoctorCliValueKey>([
    ['--url', 'url'],
    ['--table', 'table'],
    ['--manifest', 'manifestPath'],
    ['--role', 'role'],
    ['--db-setting-key', 'dbSettingKey'],
    ['--tenant-column', 'tenantColumn'],
    ['--tenant-a', 'tenantA'],
    ['--tenant-b', 'tenantB'],
    ['--concurrency', 'concurrency'],
    ['--timeout-ms', 'timeoutMs'],
  ]);
  const values = new Map<DoctorCliValueKey, string>();
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
  const manifestPath = values.get('manifestPath');
  const role = values.get('role');
  if (!url) return { kind: 'error', message: 'Set DATABASE_URL or pass --url.', json };
  if (table && manifestPath) {
    return { kind: 'error', message: '--table and --manifest are mutually exclusive.', json };
  }
  if (manifestPath) {
    for (const [key, flag] of [
      ['role', '--role'],
      ['dbSettingKey', '--db-setting-key'],
      ['tenantColumn', '--tenant-column'],
      ['tenantA', '--tenant-a'],
      ['tenantB', '--tenant-b'],
    ] as const) {
      if (values.has(key)) {
        return { kind: 'error', message: `${flag} must be declared in the manifest in batch mode.`, json };
      }
    }
    const concurrency = parseBoundedInteger(values.get('concurrency'), '--concurrency', 4, 1, 16);
    if (typeof concurrency === 'string') return { kind: 'error', message: concurrency, json };
    const timeoutMs = parseBoundedInteger(values.get('timeoutMs'), '--timeout-ms', 60_000, 1, 600_000);
    if (typeof timeoutMs === 'string') return { kind: 'error', message: timeoutMs, json };
    return {
      kind: 'batch-options',
      options: {
        url,
        manifestPath,
        active: seenBooleans.has('--active'),
        concurrency,
        timeoutMs,
        json: seenBooleans.has('--json'),
      },
    };
  }
  if (!table) return { kind: 'error', message: 'Missing required option: --table=schema.table', json };
  if (!role) return { kind: 'error', message: 'Missing required option: --role=<application-role>', json };
  if (values.has('concurrency') || values.has('timeoutMs')) {
    return { kind: 'error', message: '--concurrency and --timeout-ms are only valid with --manifest.', json };
  }

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

function parseBoundedInteger(
  value: string | undefined,
  flag: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number | string {
  if (value === undefined) return defaultValue;
  if (!/^\d+$/.test(value)) return `${flag} must be an integer from ${minimum} to ${maximum}.`;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : `${flag} must be an integer from ${minimum} to ${maximum}.`;
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
  const safeMessage = redactDoctorError(message, '');
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
    'Usage: npx @nestarc/tenancy doctor (--table=<schema.table> --role=<role> | --manifest=<path>) [options]',
    '',
    'Connection:',
    '  --url=<postgresql-url>              Runtime application-role URL (or DATABASE_URL)',
    '',
    'Catalog audit:',
    '  --table=<schema.table>              Fully-qualified table (required)',
    '  --role=<role>                       Expected current_user application role (required)',
    `  --db-setting-key=<key>              Tenant setting key (default: ${DEFAULT_DB_SETTING_KEY})`,
    `  --tenant-column=<column>            Tenant column (default: ${DEFAULT_TENANT_COLUMN})`,
    '  --manifest=<path>                   Versioned JSON table inventory (batch mode)',
    '  --concurrency=<1..16>               Batch worker limit (default: 4)',
    '  --timeout-ms=<1..600000>            Batch admission deadline (default: 60000)',
    '',
    'Active read-only probe:',
    '  --active                            Explicitly run no-context and tenant A/B probes',
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
