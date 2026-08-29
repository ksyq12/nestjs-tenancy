import type { DoctorOptions, DoctorResult } from './doctor';

export interface CliIo {
  log(message: string): void;
  error(message: string): void;
}

export interface CliDependencies {
  runDoctor?: (options: DoctorOptions) => Promise<DoctorResult>;
}

const defaultIo: CliIo = {
  log: (message) => console.log(message),
  error: (message) => console.error(message),
};

/** Run the CLI without terminating the process, so async commands can clean up and flush output. */
export async function runCli(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  io: CliIo = defaultIo,
  dependencies: CliDependencies = {},
): Promise<number> {
  const command = argv[0];
  const args = argv.slice(1);
  const flags = new Set(args);

  if (command === 'init') {
    const dryRun = flags.has('--dry-run');
    try {
      const result = await require('./init').runInit({ dryRun });
      return result === 'invalid' ? 1 : 0;
    } catch (error) {
      io.error(error instanceof Error ? error.message : String(error));
      return 1;
    }
  }

  if (command === 'check') {
    const { runCheck } = require('./check');
    const dbSettingKeyArg = args.find((arg: string) => arg.startsWith('--db-setting-key='));
    const dbSettingKey = dbSettingKeyArg
      ? dbSettingKeyArg.slice(dbSettingKeyArg.indexOf('=') + 1)
      : undefined;
    const result = runCheck({ dbSettingKey });
    return result.inSync ? 0 : 1;
  }

  if (command === 'doctor') {
    const doctor = require('./doctor') as typeof import('./doctor');
    const parsed = doctor.parseDoctorArgs(args, env);
    if (parsed.kind === 'help') {
      io.log(doctor.doctorHelp());
      return 0;
    }
    if (parsed.kind === 'error') {
      const output = doctor.formatDoctorCliError(parsed.message, parsed.json);
      if (parsed.json) io.log(output);
      else {
        io.error(output);
        io.log(doctor.doctorHelp());
      }
      return doctor.DoctorExitCode.ERROR;
    }

    const { json, ...options } = parsed.options;
    const result = await (dependencies.runDoctor ?? doctor.runDoctor)(options);
    io.log(doctor.formatDoctorResult(result, json));
    return result.exitCode;
  }

  io.log(rootHelp());
  return 0;
}

export function rootHelp(): string {
  return [
    'Usage: npx @nestarc/tenancy <command> [options]',
    '',
    'Commands:',
    '  init [--dry-run]                    Scaffold RLS policies and module configuration',
    '  check [--db-setting-key=<key>]      Check if tenancy-setup.sql is in sync with Prisma schema',
    '  doctor --table=<schema.table>       Audit a live database (run doctor --help for options)',
  ].join('\n');
}

/** Dispatch the CLI at the process boundary and translate async failures to exit code 2. */
export async function runCliMain(
  argv: string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  io: CliIo = defaultIo,
  dependencies: CliDependencies = {},
): Promise<void> {
  try {
    process.exitCode = await runCli(argv, env, io, dependencies);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (argv.includes('--json')) {
      const doctor = require('./doctor') as typeof import('./doctor');
      io.log(doctor.formatDoctorCliError(message, true));
    } else {
      io.error(message);
    }
    process.exitCode = 2;
  }
}

/* istanbul ignore next -- executable bootstrap is covered by the packaged-bin smoke gate. */
if (require.main === module) {
  void runCliMain();
}
