import {
  DOCTOR_SCHEMA_VERSION,
  DoctorExitCode,
  doctorErrorResult,
  redactDoctorError,
  toDoctorTarget,
  validateDoctorOptions,
} from './doctor-contract';
import type {
  DoctorDependencies,
  DoctorError,
  DoctorOptions,
  DoctorResult,
  DoctorStatus,
  DoctorSummary,
  ValidatedDoctorOptions,
} from './doctor-contract';
import { runDoctor } from './doctor-runner';

export interface DoctorManifestEntry {
  table: string;
  role?: string;
  dbSettingKey?: string;
  tenantColumn?: string;
  tenantA?: string;
  tenantB?: string;
}

export type DoctorManifestDefaults = Omit<DoctorManifestEntry, 'table'>;

export interface DoctorManifest {
  schemaVersion: typeof DOCTOR_SCHEMA_VERSION;
  defaults?: DoctorManifestDefaults;
  tables: DoctorManifestEntry[];
}

export interface DoctorBatchOptions {
  url?: string;
  manifest: unknown;
  active?: boolean;
  concurrency?: number;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface DoctorBatchSummary {
  tables: {
    total: number;
    healthy: number;
    warning: number;
    unhealthy: number;
    errors: number;
  };
  checks: DoctorSummary;
}

export interface DoctorBatchResult {
  schemaVersion: typeof DOCTOR_SCHEMA_VERSION;
  status: DoctorStatus;
  exitCode: 0 | 1 | 2;
  summary: DoctorBatchSummary;
  results: DoctorResult[];
  error?: DoctorError;
}

export interface DoctorBatchDependencies extends DoctorDependencies {
  runDoctor?: typeof runDoctor;
}

interface ValidatedBatchOptions {
  url: string;
  tables: ValidatedDoctorOptions[];
  concurrency: number;
  timeoutMs: number;
  signal?: AbortSignal;
}

const MANIFEST_KEYS = new Set(['schemaVersion', 'defaults', 'tables']);
const DEFAULT_KEYS = new Set(['role', 'dbSettingKey', 'tenantColumn', 'tenantA', 'tenantB']);
const TABLE_KEYS = new Set(['table', ...DEFAULT_KEYS]);

export async function runDoctorBatch(
  options: DoctorBatchOptions,
  dependencies: DoctorBatchDependencies = {},
): Promise<DoctorBatchResult> {
  const validation = validateDoctorBatchOptions(options);
  if (typeof validation === 'string') {
    return doctorBatchErrorResult('INVALID_MANIFEST', validation);
  }

  const controller = new AbortController();
  const interruption: {
    code: Extract<DoctorError['code'], 'ABORTED' | 'TIMEOUT'>;
  } = { code: 'ABORTED' };
  const abortFromCaller = (): void => controller.abort('ABORTED');
  if (validation.signal?.aborted) controller.abort('ABORTED');
  else validation.signal?.addEventListener('abort', abortFromCaller, { once: true });

  const timeout = setTimeout(() => {
    if (!controller.signal.aborted) {
      interruption.code = 'TIMEOUT';
      controller.abort('TIMEOUT');
    }
  }, validation.timeoutMs);
  timeout.unref?.();

  const results = new Array<DoctorResult>(validation.tables.length);
  let nextIndex = 0;
  const execute = dependencies.runDoctor ?? runDoctor;

  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= validation.tables.length) return;

      const table = validation.tables[index];
      if (controller.signal.aborted) {
        results[index] = interruptedTableResult(table, interruption.code);
        continue;
      }

      results[index] = await execute(toDoctorOptions(table), {
        clientFactory: dependencies.clientFactory,
        signal: controller.signal,
        abortCode: interruption.code,
        statementTimeoutMs: Math.min(validation.timeoutMs, 10_000),
      });
    }
  };

  try {
    await Promise.all(
      Array.from(
        { length: Math.min(validation.concurrency, validation.tables.length) },
        () => worker(),
      ),
    );
  } finally {
    clearTimeout(timeout);
    validation.signal?.removeEventListener('abort', abortFromCaller);
  }

  const interrupted = results.some((result) =>
    result.error?.code === 'ABORTED' || result.error?.code === 'TIMEOUT'
  );
  return doctorBatchChecksResult(
    results,
    interrupted
      ? {
          code: interruption.code,
          message: interruption.code === 'TIMEOUT'
            ? 'Doctor batch admission deadline expired; in-flight table cleanup completed.'
            : 'Doctor batch was aborted; in-flight table cleanup completed.',
        }
      : undefined,
  );
}

export function doctorBatchErrorResult(
  code: DoctorError['code'],
  message: string,
): DoctorBatchResult {
  return {
    schemaVersion: DOCTOR_SCHEMA_VERSION,
    status: 'error',
    exitCode: DoctorExitCode.ERROR,
    summary: emptyBatchSummary(),
    results: [],
    error: { code, message: redactDoctorError(message, '') },
  };
}

export function formatDoctorBatchResult(
  result: DoctorBatchResult,
  json: boolean,
): string {
  if (json) return JSON.stringify(result, null, 2);

  const lines = ['@nestarc/tenancy doctor batch', ''];
  result.results.forEach((tableResult, index) => {
    const target = tableResult.target;
    const label = target ? `${target.schema}.${target.table}` : `table ${index + 1}`;
    lines.push(`[${index + 1}/${result.results.length}] ${label}: ${tableResult.status.toUpperCase()}`);
    for (const check of tableResult.checks) {
      lines.push(`  [${check.status.toUpperCase()}] ${check.id}: ${check.message}`);
    }
    if (tableResult.error) {
      lines.push(`  [ERROR] ${tableResult.error.code}: ${tableResult.error.message}`);
    }
  });
  if (result.error) lines.push('', `[ERROR] ${result.error.code}: ${result.error.message}`);
  lines.push(
    '',
    `Status: ${result.status.toUpperCase()} | tables=${result.summary.tables.total} healthy=${result.summary.tables.healthy} warning=${result.summary.tables.warning} unhealthy=${result.summary.tables.unhealthy} error=${result.summary.tables.errors}`,
    `Checks: pass=${result.summary.checks.passed} fail=${result.summary.checks.failed} warn=${result.summary.checks.warnings} skip=${result.summary.checks.skipped}`,
  );
  return lines.join('\n');
}

function validateDoctorBatchOptions(
  options: DoctorBatchOptions,
): ValidatedBatchOptions | string {
  const url = options.url?.trim();
  if (!url) return 'A PostgreSQL URL is required through --url or DATABASE_URL.';
  const concurrency = options.concurrency ?? 4;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    return '--concurrency must be an integer from 1 to 16.';
  }
  const timeoutMs = options.timeoutMs ?? 60_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600_000) {
    return '--timeout-ms must be an integer from 1 to 600000.';
  }

  if (!isRecord(options.manifest)) return 'Manifest must be a JSON object.';
  const unknownRoot = unknownKey(options.manifest, MANIFEST_KEYS);
  if (unknownRoot) return `Unknown manifest property: ${unknownRoot}.`;
  if (options.manifest.schemaVersion !== DOCTOR_SCHEMA_VERSION) {
    return `Unsupported manifest schemaVersion; expected ${DOCTOR_SCHEMA_VERSION}.`;
  }

  const defaultsValue = options.manifest.defaults;
  if (defaultsValue !== undefined && !isRecord(defaultsValue)) {
    return 'Manifest defaults must be an object.';
  }
  const defaults = defaultsValue as Record<string, unknown> | undefined;
  if (defaults) {
    const unknownDefault = unknownKey(defaults, DEFAULT_KEYS);
    if (unknownDefault) return `Unknown manifest defaults property: ${unknownDefault}.`;
    const error = validateStringProperties(defaults, DEFAULT_KEYS, 'Manifest defaults');
    if (error) return error;
  }

  const tables = options.manifest.tables;
  if (!Array.isArray(tables) || tables.length === 0) {
    return 'Manifest tables must be a non-empty array.';
  }

  const validatedTables: ValidatedDoctorOptions[] = [];
  const identities = new Set<string>();
  for (let index = 0; index < tables.length; index += 1) {
    const entry = tables[index];
    if (!isRecord(entry)) return `Manifest table at index ${index} must be an object.`;
    const unknownTable = unknownKey(entry, TABLE_KEYS);
    if (unknownTable) return `Unknown manifest table property at index ${index}: ${unknownTable}.`;
    const stringError = validateStringProperties(entry, TABLE_KEYS, `Manifest table at index ${index}`);
    if (stringError) return stringError;

    const active = options.active ?? false;
    const candidate: DoctorOptions = {
      url,
      table: stringValue(entry.table),
      role: inheritedString(entry, defaults, 'role'),
      dbSettingKey: inheritedOptionalString(entry, defaults, 'dbSettingKey'),
      tenantColumn: inheritedOptionalString(entry, defaults, 'tenantColumn'),
      active,
      tenantA: active ? inheritedOptionalString(entry, defaults, 'tenantA') : undefined,
      tenantB: active ? inheritedOptionalString(entry, defaults, 'tenantB') : undefined,
    };
    const validated = validateDoctorOptions(candidate);
    if (typeof validated === 'string') {
      return `Manifest table at index ${index} is invalid: ${validated}`;
    }
    const identity = `${validated.schema}\0${validated.table}`;
    if (identities.has(identity)) {
      return `Manifest table at index ${index} duplicates ${validated.schema}.${validated.table}.`;
    }
    identities.add(identity);
    validatedTables.push(validated);
  }

  return {
    url,
    tables: validatedTables,
    concurrency,
    timeoutMs,
    signal: options.signal,
  };
}

function toDoctorOptions(options: ValidatedDoctorOptions): DoctorOptions {
  return {
    url: options.url,
    table: `${options.schema}.${options.table}`,
    role: options.role,
    dbSettingKey: options.dbSettingKey,
    tenantColumn: options.tenantColumn,
    active: options.active,
    tenantA: options.tenantA,
    tenantB: options.tenantB,
  };
}

function interruptedTableResult(
  options: ValidatedDoctorOptions,
  code: Extract<DoctorError['code'], 'ABORTED' | 'TIMEOUT'>,
): DoctorResult {
  return doctorErrorResult(
    code,
    code === 'TIMEOUT'
      ? 'Table audit was not started before the batch admission deadline.'
      : 'Table audit was not started because the batch was aborted.',
    toDoctorTarget(options),
  );
}

function doctorBatchChecksResult(
  results: DoctorResult[],
  error?: DoctorError,
): DoctorBatchResult {
  const summary = summarizeBatch(results);
  const status: DoctorStatus = summary.tables.errors > 0
    ? 'error'
    : summary.tables.unhealthy > 0
      ? 'unhealthy'
      : summary.tables.warning > 0
        ? 'warning'
        : 'healthy';
  const exitCode = status === 'error'
    ? DoctorExitCode.ERROR
    : status === 'healthy'
      ? DoctorExitCode.HEALTHY
      : DoctorExitCode.FINDINGS;
  return {
    schemaVersion: DOCTOR_SCHEMA_VERSION,
    status,
    exitCode,
    summary,
    results,
    ...(error ? { error } : {}),
  };
}

function summarizeBatch(results: DoctorResult[]): DoctorBatchSummary {
  const summary = emptyBatchSummary();
  summary.tables.total = results.length;
  for (const result of results) {
    if (result.status === 'error') summary.tables.errors += 1;
    else summary.tables[result.status] += 1;
    summary.checks.passed += result.summary.passed;
    summary.checks.failed += result.summary.failed;
    summary.checks.warnings += result.summary.warnings;
    summary.checks.skipped += result.summary.skipped;
  }
  return summary;
}

function emptyBatchSummary(): DoctorBatchSummary {
  return {
    tables: { total: 0, healthy: 0, warning: 0, unhealthy: 0, errors: 0 },
    checks: { passed: 0, failed: 0, warnings: 0, skipped: 0 },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unknownKey(value: Record<string, unknown>, allowed: Set<string>): string | undefined {
  return Object.keys(value).find((key) => !allowed.has(key));
}

function validateStringProperties(
  value: Record<string, unknown>,
  allowed: Set<string>,
  label: string,
): string | undefined {
  const invalid = Object.keys(value).find((key) =>
    allowed.has(key) && typeof value[key] !== 'string'
  );
  return invalid ? `${label} property ${invalid} must be a string.` : undefined;
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function inheritedString(
  entry: Record<string, unknown>,
  defaults: Record<string, unknown> | undefined,
  key: string,
): string {
  return stringValue(entry[key] ?? defaults?.[key]);
}

function inheritedOptionalString(
  entry: Record<string, unknown>,
  defaults: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = entry[key] ?? defaults?.[key];
  return typeof value === 'string' ? value : undefined;
}
