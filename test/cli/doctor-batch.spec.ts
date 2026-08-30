import {
  DOCTOR_SCHEMA_VERSION,
  DoctorExitCode,
  DoctorResult,
  doctorBatchErrorResult,
  formatDoctorBatchResult,
  parseDoctorArgs,
  runDoctor,
  runDoctorBatch,
} from '../../src/cli/doctor';
import type { DoctorBatchResult, DoctorOptions } from '../../src/cli/doctor';
import {
  doctorChecksResult,
  doctorErrorResult,
  toDoctorTarget,
  validateDoctorOptions,
} from '../../src/cli/doctor-contract';
import { runCli } from '../../src/cli';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

const URL = 'postgresql://app_user:batch-secret@localhost/database';
const TENANT_A = '11111111-1111-1111-1111-111111111111';

function resultFor(options: DoctorOptions, status: 'pass' | 'fail'): DoctorResult {
  const validated = validateDoctorOptions(options);
  if (typeof validated === 'string') throw new Error(validated);
  return doctorChecksResult(toDoctorTarget(validated), [{
    id: 'catalog.rls_enabled',
    category: 'catalog',
    status,
    message: status === 'pass' ? 'RLS is enabled.' : 'RLS is disabled.',
  }]);
}

describe('doctor manifest batch', () => {
  it('uses the doctor schema version for batch envelopes', () => {
    expect(DOCTOR_SCHEMA_VERSION).toBe(1);
  });

  it('keeps manifest order and aggregates a catalog pass plus drift golden result', async () => {
    let releaseFirst: (() => void) | undefined;
    const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const completionOrder: string[] = [];
    const runner = jest.fn(async (options: DoctorOptions): Promise<DoctorResult> => {
      if (options.table === 'public.users') await firstBlocked;
      else releaseFirst?.();
      completionOrder.push(options.table);
      return resultFor(options, options.table === 'public.users' ? 'pass' : 'fail');
    });

    const result = await runDoctorBatch({
      url: URL,
      manifest: {
        schemaVersion: 1,
        defaults: { role: 'app_user' },
        tables: [
          { table: 'public.users' },
          { table: 'billing.invoices', tenantColumn: 'account_id' },
        ],
      },
      concurrency: 2,
    }, { runDoctor: runner });

    expect(completionOrder).toEqual(['billing.invoices', 'public.users']);
    expect(result).toEqual({
      schemaVersion: 1,
      status: 'unhealthy',
      exitCode: DoctorExitCode.FINDINGS,
      summary: {
        tables: { total: 2, healthy: 1, warning: 0, unhealthy: 1, errors: 0 },
        checks: { passed: 1, failed: 1, warnings: 0, skipped: 0 },
      },
      results: [
        expect.objectContaining({
          status: 'healthy',
          target: expect.objectContaining({ schema: 'public', table: 'users' }),
        }),
        expect.objectContaining({
          status: 'unhealthy',
          target: expect.objectContaining({
            schema: 'billing',
            table: 'invoices',
            tenantColumn: 'account_id',
          }),
        }),
      ],
    });
    expect(formatDoctorBatchResult(result, true)).not.toContain('batch-secret');
    expect(formatDoctorBatchResult(result, false)).toContain('[1/2] public.users: HEALTHY');
  });

  it('preserves peer table results when one table has an operational error', async () => {
    const runner = jest.fn(async (options: DoctorOptions): Promise<DoctorResult> => {
      const validated = validateDoctorOptions(options);
      if (typeof validated === 'string') throw new Error(validated);
      return options.table === 'public.broken'
        ? doctorErrorResult(
            'QUERY_FAILED',
            'relation lookup failed',
            toDoctorTarget(validated),
          )
        : resultFor(options, 'pass');
    });

    const result = await runDoctorBatch({
      url: URL,
      manifest: {
        schemaVersion: 1,
        defaults: { role: 'app_user' },
        tables: [
          { table: 'public.users' },
          { table: 'public.broken' },
          { table: 'public.posts' },
        ],
      },
    }, { runDoctor: runner });

    expect(result.status).toBe('error');
    expect(result.exitCode).toBe(DoctorExitCode.ERROR);
    expect(result.summary.tables).toEqual({
      total: 3,
      healthy: 2,
      warning: 0,
      unhealthy: 0,
      errors: 1,
    });
    expect(result.results.map((item) => item.target?.table)).toEqual([
      'users', 'broken', 'posts',
    ]);
  });

  it('bounds concurrency and marks unstarted tables when the deadline expires', async () => {
    let active = 0;
    let maximum = 0;
    const runner = jest.fn(async (options: DoctorOptions): Promise<DoctorResult> => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return resultFor(options, 'pass');
    });

    const result = await runDoctorBatch({
      url: URL,
      manifest: {
        schemaVersion: 1,
        defaults: { role: 'app_user' },
        tables: [
          { table: 'public.one' },
          { table: 'public.two' },
          { table: 'public.three' },
          { table: 'public.four' },
        ],
      },
      concurrency: 2,
      timeoutMs: 5,
    }, { runDoctor: runner });

    expect(maximum).toBe(2);
    expect(runner).toHaveBeenCalledTimes(2);
    expect(result.results.map((item) => item.error?.code ?? 'OK')).toEqual([
      'OK', 'OK', 'TIMEOUT', 'TIMEOUT',
    ]);
    expect(result.error?.code).toBe('TIMEOUT');
  });

  it('requires active probe inputs before opening any connection', async () => {
    const runner = jest.fn();
    const result = await runDoctorBatch({
      url: URL,
      active: true,
      manifest: {
        schemaVersion: 1,
        defaults: { role: 'app_user', tenantA: TENANT_A },
        tables: [{ table: 'public.users' }],
      },
    }, { runDoctor: runner });

    expect(result.error).toEqual(expect.objectContaining({ code: 'INVALID_MANIFEST' }));
    expect(result.error?.message).toContain('--tenant-b');
    expect(runner).not.toHaveBeenCalled();
  });

  it('rejects unknown fields, duplicate tables, and secret-bearing manifest properties', async () => {
    const secret = 'do-not-render';
    const unknown = await runDoctorBatch({
      url: URL,
      manifest: {
        schemaVersion: 1,
        defaults: { role: 'app_user', url: `postgresql://user:${secret}@host/db` },
        tables: [{ table: 'public.users' }],
      },
    });
    const duplicate = await runDoctorBatch({
      url: URL,
      manifest: {
        schemaVersion: 1,
        defaults: { role: 'app_user' },
        tables: [{ table: 'public.users' }, { table: 'public.users' }],
      },
    });

    expect(unknown.error?.message).toBe('Unknown manifest defaults property: url.');
    expect(JSON.stringify(unknown)).not.toContain(secret);
    expect(duplicate.error?.message).toContain('duplicates public.users');
  });

  it.each([
    ['missing URL', { manifest: {} }, 'PostgreSQL URL'],
    ['low concurrency', { url: URL, concurrency: 0, manifest: {} }, '--concurrency'],
    ['high concurrency', { url: URL, concurrency: 17, manifest: {} }, '--concurrency'],
    ['fractional concurrency', { url: URL, concurrency: 1.5, manifest: {} }, '--concurrency'],
    ['low timeout', { url: URL, timeoutMs: 0, manifest: {} }, '--timeout-ms'],
    ['high timeout', { url: URL, timeoutMs: 600_001, manifest: {} }, '--timeout-ms'],
    ['fractional timeout', { url: URL, timeoutMs: 1.5, manifest: {} }, '--timeout-ms'],
    ['non-object manifest', { url: URL, manifest: [] }, 'JSON object'],
    ['unknown root', { url: URL, manifest: { extra: true } }, 'Unknown manifest property'],
    ['version', { url: URL, manifest: { schemaVersion: 2 } }, 'schemaVersion'],
    ['non-object defaults', {
      url: URL,
      manifest: { schemaVersion: 1, defaults: [], tables: [{}] },
    }, 'defaults must be an object'],
    ['non-string default', {
      url: URL,
      manifest: { schemaVersion: 1, defaults: { role: 42 }, tables: [{}] },
    }, 'property role must be a string'],
    ['missing tables', {
      url: URL,
      manifest: { schemaVersion: 1, defaults: { role: 'app_user' } },
    }, 'non-empty array'],
    ['empty tables', {
      url: URL,
      manifest: { schemaVersion: 1, defaults: { role: 'app_user' }, tables: [] },
    }, 'non-empty array'],
    ['non-object table', {
      url: URL,
      manifest: { schemaVersion: 1, defaults: { role: 'app_user' }, tables: [null] },
    }, 'must be an object'],
    ['unknown table field', {
      url: URL,
      manifest: {
        schemaVersion: 1,
        defaults: { role: 'app_user' },
        tables: [{ table: 'public.users', active: true }],
      },
    }, 'Unknown manifest table property'],
    ['non-string table field', {
      url: URL,
      manifest: {
        schemaVersion: 1,
        defaults: { role: 'app_user' },
        tables: [{ table: 42 }],
      },
    }, 'property table must be a string'],
    ['missing table value', {
      url: URL,
      manifest: {
        schemaVersion: 1,
        defaults: { role: 'app_user' },
        tables: [{}],
      },
    }, '--table is required'],
    ['missing role value', {
      url: URL,
      manifest: { schemaVersion: 1, tables: [{ table: 'public.users' }] },
    }, '--role must be'],
  ])('fails closed for invalid manifest input: %s', async (_label, options, message) => {
    const result = await runDoctorBatch(options);
    expect(result.error?.code).toBe('INVALID_MANIFEST');
    expect(result.error?.message).toContain(message);
    expect(result.results).toEqual([]);
  });

  it('uses per-table probe overrides only after explicit active opt-in', async () => {
    const runner = jest.fn(async (options: DoctorOptions) => resultFor(options, 'pass'));
    const manifest = {
      schemaVersion: 1,
      defaults: {
        role: 'app_user',
        tenantA: 'default-a',
        tenantB: 'default-b',
      },
      tables: [{
        table: 'public.users',
        role: 'reporting_user',
        dbSettingKey: 'custom.tenant',
        tenantColumn: 'account_id',
        tenantA: 'override-a',
        tenantB: 'override-b',
      }],
    };

    await runDoctorBatch({ url: URL, manifest }, { runDoctor: runner });
    await runDoctorBatch({ url: URL, manifest, active: true }, { runDoctor: runner });

    expect(runner).toHaveBeenNthCalledWith(1, expect.objectContaining({
      active: false,
      tenantA: undefined,
      tenantB: undefined,
    }), expect.any(Object));
    expect(runner).toHaveBeenNthCalledWith(2, expect.objectContaining({
      role: 'reporting_user',
      dbSettingKey: 'custom.tenant',
      tenantColumn: 'account_id',
      active: true,
      tenantA: 'override-a',
      tenantB: 'override-b',
    }), expect.any(Object));
  });

  it('cooperatively aborts before admitting the next table', async () => {
    const controller = new AbortController();
    const runner = jest.fn(async (options: DoctorOptions): Promise<DoctorResult> => {
      controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 10));
      return resultFor(options, 'pass');
    });
    const result = await runDoctorBatch({
      url: URL,
      signal: controller.signal,
      concurrency: 1,
      timeoutMs: 5,
      manifest: {
        schemaVersion: 1,
        defaults: { role: 'app_user' },
        tables: [{ table: 'public.one' }, { table: 'public.two' }],
      },
    }, { runDoctor: runner });

    expect(runner).toHaveBeenCalledTimes(1);
    expect(result.results[1].error?.code).toBe('ABORTED');
    expect(result.error?.message).toContain('was aborted');
  });

  it('renders table and aggregate errors even without a target', () => {
    const result: DoctorBatchResult = {
      schemaVersion: 1,
      status: 'error',
      exitCode: 2,
      summary: {
        tables: { total: 1, healthy: 0, warning: 0, unhealthy: 0, errors: 1 },
        checks: { passed: 0, failed: 0, warnings: 0, skipped: 0 },
      },
      results: [doctorErrorResult('QUERY_FAILED', 'catalog failed')],
      error: { code: 'ABORTED', message: 'batch stopped' },
    };
    const output = formatDoctorBatchResult(result, false);
    expect(output).toContain('[1/1] table 1: ERROR');
    expect(output).toContain('[ERROR] QUERY_FAILED: catalog failed');
    expect(output).toContain('[ERROR] ABORTED: batch stopped');
    expect(doctorBatchErrorResult('INVALID_MANIFEST', 'invalid').exitCode).toBe(2);
  });

  it.each([
    ['ABORTED' as const, undefined],
    ['TIMEOUT' as const, 'TIMEOUT'],
  ])('classifies a pre-start %s signal without creating a client', async (code, reason) => {
    const controller = new AbortController();
    controller.abort(reason);
    const factory = jest.fn();
    const result = await runDoctor({
      url: URL,
      table: 'public.users',
      role: 'app_user',
    }, { signal: controller.signal, clientFactory: factory });

    expect(result.error?.code).toBe(code);
    expect(result.error?.message).toContain(code === 'TIMEOUT' ? 'deadline' : 'aborted');
    expect(factory).not.toHaveBeenCalled();
  });

  it('classifies a session statement-timeout setup failure as a query error', async () => {
    const client = {
      connect: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockRejectedValue(new Error('timeout setup failed')),
      end: jest.fn().mockResolvedValue(undefined),
    };
    const result = await runDoctor({
      url: URL,
      table: 'public.users',
      role: 'app_user',
    }, {
      clientFactory: () => client,
      statementTimeoutMs: 5000,
    });

    expect(client.query).toHaveBeenCalledWith(
      'SELECT pg_catalog.set_config($1, $2, false)',
      ['statement_timeout', '5000'],
    );
    expect(result.error).toEqual({
      code: 'QUERY_FAILED',
      message: 'timeout setup failed',
    });
    expect(client.end).toHaveBeenCalledTimes(1);
  });
});

describe('doctor batch CLI contract', () => {
  it('parses batch resource controls and keeps single-table flags incompatible', () => {
    expect(parseDoctorArgs([
      '--manifest=doctor.json', '--active', '--concurrency=3', '--timeout-ms=5000', '--json',
    ], { DATABASE_URL: URL })).toEqual({
      kind: 'batch-options',
      options: {
        url: URL,
        manifestPath: 'doctor.json',
        active: true,
        concurrency: 3,
        timeoutMs: 5000,
        json: true,
      },
    });
    expect(parseDoctorArgs([
      '--manifest=doctor.json', '--role=app_user',
    ], { DATABASE_URL: URL })).toEqual(expect.objectContaining({ kind: 'error' }));
    expect(parseDoctorArgs([
      '--table=public.users', '--role=app_user', '--concurrency=2',
    ], { DATABASE_URL: URL })).toEqual(expect.objectContaining({ kind: 'error' }));
  });

  it('reads one manifest, emits one aggregate JSON document, and returns its exit code', async () => {
    const output: string[] = [];
    const expected: DoctorBatchResult = {
      schemaVersion: 1,
      status: 'warning',
      exitCode: DoctorExitCode.FINDINGS,
      summary: {
        tables: { total: 1, healthy: 0, warning: 1, unhealthy: 0, errors: 0 },
        checks: { passed: 0, failed: 0, warnings: 1, skipped: 0 },
      },
      results: [],
    };
    const runBatch = jest.fn().mockResolvedValue(expected);
    const readManifest = jest.fn().mockResolvedValue(JSON.stringify({
      schemaVersion: 1,
      defaults: { role: 'app_user' },
      tables: [{ table: 'public.users' }],
    }));

    const exitCode = await runCli([
      'doctor', '--manifest=doctor.json', '--json',
    ], { DATABASE_URL: URL }, {
      log: (message) => output.push(message),
      error: jest.fn(),
    }, { runDoctorBatch: runBatch, readFile: readManifest });

    expect(exitCode).toBe(DoctorExitCode.FINDINGS);
    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0])).toEqual(expected);
    expect(output[0]).not.toContain('batch-secret');
    expect(runBatch).toHaveBeenCalledWith(expect.objectContaining({
      url: URL,
      manifest: expect.objectContaining({ schemaVersion: 1 }),
    }));
  });

  it('returns one structured error when the manifest file cannot be parsed', async () => {
    const output: string[] = [];
    const exitCode = await runCli([
      'doctor', '--manifest=broken.json', '--json',
    ], { DATABASE_URL: URL }, {
      log: (message) => output.push(message),
      error: jest.fn(),
    }, { readFile: jest.fn().mockResolvedValue('{') });

    expect(exitCode).toBe(DoctorExitCode.ERROR);
    expect(output).toHaveLength(1);
    expect(JSON.parse(output[0])).toEqual(expect.objectContaining({
      status: 'error',
      error: expect.objectContaining({ code: 'INVALID_MANIFEST' }),
    }));
  });

  it('uses the filesystem and default batch runner for an invalid manifest', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tenancy-doctor-batch-'));
    const manifestPath = join(directory, 'manifest.json');
    await writeFile(manifestPath, JSON.stringify({ schemaVersion: 99 }), 'utf8');
    const output: string[] = [];
    try {
      const exitCode = await runCli([
        'doctor', `--manifest=${manifestPath}`, '--json',
      ], { DATABASE_URL: URL }, {
        log: (message) => output.push(message),
        error: jest.fn(),
      });
      expect(exitCode).toBe(DoctorExitCode.ERROR);
      expect(JSON.parse(output[0]).error.code).toBe('INVALID_MANIFEST');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
