import type { DoctorResult } from '../../src/cli/doctor';
import { rootHelp, runCli, runCliMain } from '../../src/cli';

const initModule = require('../../src/cli/init') as typeof import('../../src/cli/init');
const checkModule = require('../../src/cli/check') as typeof import('../../src/cli/check');
const doctorModule = require('../../src/cli/doctor') as typeof import('../../src/cli/doctor');

function createIo() {
  const output: string[] = [];
  const errors: string[] = [];
  return {
    output,
    errors,
    io: {
      log: (message: string) => output.push(message),
      error: (message: string) => errors.push(message),
    },
  };
}

function doctorResult(
  exitCode: 0 | 1 | 2 = doctorModule.DoctorExitCode.HEALTHY,
): DoctorResult {
  return {
    schemaVersion: 1,
    status: exitCode === 0 ? 'healthy' : exitCode === 1 ? 'warning' : 'error',
    exitCode,
    summary: { passed: exitCode === 0 ? 1 : 0, failed: 0, warnings: 0, skipped: 0 },
    checks: [],
  };
}

describe('CLI dispatcher', () => {
  let originalArgv: string[];
  let originalExitCode: typeof process.exitCode;

  beforeEach(() => {
    originalArgv = process.argv;
    originalExitCode = process.exitCode;
  });

  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = originalExitCode;
    jest.restoreAllMocks();
  });

  it('prints root help with default arguments and I/O', async () => {
    process.argv = ['node', 'tenancy'];
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    await expect(runCli()).resolves.toBe(0);

    expect(log).toHaveBeenCalledWith(rootHelp());
  });

  it('prints root help for an unknown command without dispatching a command', async () => {
    const { io, output, errors } = createIo();

    await expect(runCli(['unknown'], {}, io)).resolves.toBe(0);

    expect(output).toEqual([rootHelp()]);
    expect(errors).toEqual([]);
  });

  it('dispatches init flags and maps completed or invalid results to exit codes', async () => {
    const runInit = jest.spyOn(initModule, 'runInit')
      .mockResolvedValueOnce('completed')
      .mockResolvedValueOnce('invalid');

    await expect(runCli(['init', '--dry-run'])).resolves.toBe(0);
    await expect(runCli(['init'])).resolves.toBe(1);

    expect(runInit).toHaveBeenNthCalledWith(1, { dryRun: true });
    expect(runInit).toHaveBeenNthCalledWith(2, { dryRun: false });
  });

  it.each([
    [new Error('init failed'), 'init failed'],
    ['init failed', 'init failed'],
  ])('maps a rejected init to exit code 1 and reports %p', async (reason, message) => {
    jest.spyOn(initModule, 'runInit').mockRejectedValue(reason);
    const { io, errors } = createIo();

    await expect(runCli(['init'], {}, io)).resolves.toBe(1);

    expect(errors).toEqual([message]);
  });

  it('reports a rejected init through the default error output', async () => {
    jest.spyOn(initModule, 'runInit').mockRejectedValue(new Error('init failed'));
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});

    await expect(runCli(['init'])).resolves.toBe(1);

    expect(error).toHaveBeenCalledWith('init failed');
  });

  it('dispatches check options and maps sync state to exit codes', async () => {
    const runCheck = jest.spyOn(checkModule, 'runCheck')
      .mockReturnValueOnce({ inSync: true, missingPolicies: [], extraPolicies: [], warnings: [] })
      .mockReturnValueOnce({ inSync: false, missingPolicies: [], extraPolicies: [], warnings: [] });

    await expect(runCli(['check', '--db-setting-key=custom.tenant'])).resolves.toBe(0);
    await expect(runCli(['check'])).resolves.toBe(1);

    expect(runCheck).toHaveBeenNthCalledWith(1, { dbSettingKey: 'custom.tenant' });
    expect(runCheck).toHaveBeenNthCalledWith(2, { dbSettingKey: undefined });
  });

  it('dispatches doctor help without running a database audit', async () => {
    const { io, output, errors } = createIo();
    const runDoctor = jest.fn();

    await expect(runCli(['doctor', '--help'], {}, io, { runDoctor })).resolves.toBe(0);

    expect(output).toEqual([doctorModule.doctorHelp()]);
    expect(errors).toEqual([]);
    expect(runDoctor).not.toHaveBeenCalled();
  });

  it.each([
    [false, 1],
    [true, 1],
  ])('reports doctor usage errors with json=%p', async (json, expectedOutputCount) => {
    const { io, output, errors } = createIo();
    const args = json ? ['doctor', '--json'] : ['doctor'];

    await expect(runCli(args, {}, io)).resolves.toBe(doctorModule.DoctorExitCode.ERROR);

    expect(output).toHaveLength(expectedOutputCount);
    expect(errors).toHaveLength(json ? 0 : 1);
    if (json) expect(JSON.parse(output[0]).status).toBe('error');
    else expect(output[0]).toBe(doctorModule.doctorHelp());
  });

  it('dispatches doctor through the default and injected runners', async () => {
    const healthy = doctorResult();
    const finding = doctorResult(doctorModule.DoctorExitCode.FINDINGS);
    const runDoctor = jest.spyOn(doctorModule, 'runDoctor').mockResolvedValue(healthy);
    const injectedRunner = jest.fn().mockResolvedValue(finding);
    const defaultIo = createIo();
    const injectedIo = createIo();
    const argv = ['doctor', '--table=public.users', '--role=app_user'];
    const env = { DATABASE_URL: 'postgresql://localhost/database' };

    await expect(runCli(argv, env, defaultIo.io)).resolves.toBe(0);
    await expect(runCli(argv, env, injectedIo.io, { runDoctor: injectedRunner })).resolves.toBe(1);

    expect(runDoctor).toHaveBeenCalledTimes(1);
    expect(injectedRunner).toHaveBeenCalledTimes(1);
    expect(defaultIo.output).toEqual([doctorModule.formatDoctorResult(healthy, false)]);
    expect(injectedIo.output).toEqual([doctorModule.formatDoctorResult(finding, false)]);
  });

  it('assigns the command exit code at the process boundary', async () => {
    process.argv = ['node', 'tenancy', 'unknown'];
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    await runCliMain();

    expect(process.exitCode).toBe(0);
    expect(log).toHaveBeenCalledWith(rootHelp());
  });

  it('forwards a successful command\'s non-zero exit code at the process boundary', async () => {
    const { io } = createIo();

    await runCliMain(
      ['doctor', '--table=public.users', '--role=app_user'],
      { DATABASE_URL: 'postgresql://localhost/database' },
      io,
      { runDoctor: jest.fn().mockResolvedValue(doctorResult(doctorModule.DoctorExitCode.FINDINGS)) },
    );

    expect(process.exitCode).toBe(doctorModule.DoctorExitCode.FINDINGS);
  });

  it.each([
    [new Error('doctor failed'), false],
    ['doctor failed', true],
  ])('maps an async command rejection to process exit code 2 with json=%p', async (reason, json) => {
    const { io, output, errors } = createIo();
    const argv = [
      'doctor',
      '--table=public.users',
      '--role=app_user',
      ...(json ? ['--json'] : []),
    ];

    await runCliMain(argv, { DATABASE_URL: 'postgresql://localhost/database' }, io, {
      runDoctor: jest.fn().mockRejectedValue(reason),
    });

    expect(process.exitCode).toBe(doctorModule.DoctorExitCode.ERROR);
    expect(errors).toEqual(json ? [] : ['doctor failed']);
    expect(output).toHaveLength(json ? 1 : 0);
    if (json) expect(JSON.parse(output[0]).error.message).toBe('doctor failed');
  });
});
