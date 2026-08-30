#!/usr/bin/env node
/**
 * Installs the exact published Nest 11 / Prisma 7 Nestarc graph into an
 * isolated fixture and runs the full API key -> tenancy -> RBAC -> RLS ->
 * outbox -> jobs -> webhook flow.
 */
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const MODERN_MODE = 'modern-published-only';
const MODERN_FIXTURE_DIRECTORY = path.join(
  'test',
  'ecosystem',
  'modern-fixture',
);
const MODERN_COMPOSE_FILE = path.join(
  MODERN_FIXTURE_DIRECTORY,
  'docker-compose.yml',
);
const PUBLIC_NPM_REGISTRY = 'https://registry.npmjs.org/';
const DEFAULT_DATABASE_URL =
  'postgresql://tenancy:tenancy@127.0.0.1:5433/tenancy_test';
const DEFAULT_APP_DATABASE_URL =
  'postgresql://ecosystem_app:ecosystem_app@127.0.0.1:5433/tenancy_test';
const MODERN_PACKAGE_VERSIONS = Object.freeze({
  '@nestarc/tenancy': '0.16.0',
  '@nestarc/api-keys': '0.3.2',
  '@nestarc/rbac': '0.2.1',
  '@nestarc/jobs': '0.3.1',
  '@nestarc/outbox': '0.2.1',
  '@nestarc/webhook': '0.13.1',
  '@nestjs/common': '11.2.1',
  '@nestjs/core': '11.2.1',
  '@nestjs/platform-express': '11.2.1',
  '@nestjs/schedule': '5.0.1',
  '@nestjs/testing': '11.2.1',
  '@opentelemetry/api': '1.9.1',
  '@prisma/adapter-pg': '7.10.0',
  '@prisma/client': '7.10.0',
  prisma: '7.10.0',
  pg: '8.23.0',
  'reflect-metadata': '0.2.2',
  rxjs: '7.8.2',
});
const MODERN_FIXTURE_FILES = Object.freeze([
  'README.md',
  'docker-compose.yml',
  'jest.config.cjs',
  'package-lock.json',
  'package.json',
  'prisma.config.ts',
  path.join('prisma', 'schema.prisma'),
  path.join('scripts', 'verify-packages.cjs'),
  path.join('src', 'ecosystem.module.ts'),
  path.join('src', 'runtime.ts'),
  path.join('test', 'ecosystem.e2e-spec.ts'),
  path.join('test', 'setup.sql'),
  'tsconfig.json',
]);
const FIXTURE_INSTALL_ARGS = [
  'ci',
  '--strict-peer-deps',
  '--no-force',
  '--no-legacy-peer-deps',
  `--registry=${PUBLIC_NPM_REGISTRY}`,
  '--replace-registry-host=never',
  '--no-audit',
  '--no-fund',
];
const FIXTURE_VALIDATION_STEPS = [
  {
    command: process.execPath,
    args: [path.join('scripts', 'verify-packages.cjs')],
  },
  { command: 'npm', args: ['ls', '--all'] },
  {
    command: process.execPath,
    args: [
      path.join('node_modules', 'prisma', 'build', 'index.js'),
      'generate',
      '--schema',
      'prisma/schema.prisma',
    ],
  },
  {
    command: process.execPath,
    args: [path.join('node_modules', 'typescript', 'bin', 'tsc'), '--noEmit'],
  },
  {
    command: process.execPath,
    args: [
      '--experimental-vm-modules',
      path.join('node_modules', 'jest', 'bin', 'jest.js'),
      '--runInBand',
    ],
  },
];
const FORBIDDEN_LOCAL_ENV = [
  'NESTARC_ECOSYSTEM_SOURCE_ROOT',
  'TENANCY_CANDIDATE_VERSION',
  'TENANCY_CANDIDATE_INTEGRITY',
];
const FORBIDDEN_EXECUTION_ENV = [
  'NODE_OPTIONS',
  'NODE_PATH',
  'npm_config_node_options',
  'npm_config_script_shell',
];
const FORBIDDEN_PRISMA_ENGINE_ENV = [
  'BINARY_DOWNLOAD_VERSION',
  'PRISMA_BINARIES_MIRROR',
  'PRISMA_CLI_BINARY_TARGETS',
  'PRISMA_CLI_QUERY_ENGINE_TYPE',
  'PRISMA_CLIENT_ENGINE_TYPE',
  'PRISMA_ENGINES_MIRROR',
  'PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING',
  'PRISMA_FMT_BINARY',
  'PRISMA_GENERATE_NO_ENGINE',
  'PRISMA_INTROSPECTION_ENGINE_BINARY',
  'PRISMA_MIGRATION_ENGINE_BINARY',
  'PRISMA_QUERY_ENGINE_BINARY',
  'PRISMA_QUERY_ENGINE_LIBRARY',
  'PRISMA_SCHEMA_ENGINE_BINARY',
];
const SIGNAL_EXIT_CODES = Object.freeze({
  SIGINT: 130,
  SIGTERM: 143,
});

function normalizeEnvKey(key) {
  return key.toLowerCase().replaceAll('-', '_');
}

function readEnvValue(env, name) {
  const normalizedName = normalizeEnvKey(name);
  const entry = Object.entries(env).find(
    ([key]) => normalizeEnvKey(key) === normalizedName,
  );
  return entry?.[1];
}

function readEnvValues(env, name) {
  const normalizedName = normalizeEnvKey(name);
  return Object.entries(env)
    .filter(([key]) => normalizeEnvKey(key) === normalizedName)
    .map(([, value]) => value);
}

function deleteEnvValue(env, name) {
  const normalizedName = normalizeEnvKey(name);
  for (const key of Object.keys(env)) {
    if (normalizeEnvKey(key) === normalizedName) delete env[key];
  }
  return env;
}

function enabled(value) {
  if (typeof value !== 'string') return false;
  return !['', '0', 'false', 'no', 'off'].includes(
    value.trim().toLowerCase(),
  );
}

function assertPublishedOnlyEnvironment(env) {
  if (readEnvValues(env, 'npm_config_force').some(enabled)) {
    throw new Error('Modern ecosystem refuses npm force configuration');
  }
  if (readEnvValues(env, 'npm_config_legacy_peer_deps').some(enabled)) {
    throw new Error(
      'Modern ecosystem refuses npm legacy-peer-deps configuration',
    );
  }
  for (const name of FORBIDDEN_LOCAL_ENV) {
    const values = readEnvValues(env, name);
    if (values.length > 0) {
      throw new Error(`Modern published-only ecosystem refuses ${name}`);
    }
  }
  for (const name of FORBIDDEN_EXECUTION_ENV) {
    if (readEnvValues(env, name).length > 0) {
      throw new Error(`Modern published-only ecosystem refuses ${name}`);
    }
  }
  for (const name of FORBIDDEN_PRISMA_ENGINE_ENV) {
    if (readEnvValues(env, name).length > 0) {
      throw new Error(
        `Modern published-only ecosystem refuses Prisma engine override ${name}`,
      );
    }
  }
}

function createStrictNpmEnv(env, cachePath) {
  if (!path.isAbsolute(cachePath)) {
    throw new Error('Modern ecosystem npm cache must be an absolute path');
  }
  const strictEnv = { ...env };
  for (const key of Object.keys(strictEnv)) {
    const normalized = normalizeEnvKey(key);
    if (normalized.startsWith('npm_config_')) {
      delete strictEnv[key];
    }
  }
  strictEnv.npm_config_force = 'false';
  strictEnv.npm_config_legacy_peer_deps = 'false';
  strictEnv.npm_config_registry = PUBLIC_NPM_REGISTRY;
  strictEnv.npm_config_replace_registry_host = 'never';
  strictEnv.npm_config_strict_peer_deps = 'true';
  strictEnv.npm_config_cache = cachePath;
  return strictEnv;
}

function createIsolatedValidationEnv(env, temporaryDirectory) {
  if (!path.isAbsolute(temporaryDirectory)) {
    throw new Error('Modern ecosystem temporary directory must be absolute');
  }
  const isolatedEnv = createStrictNpmEnv(
    env,
    path.join(temporaryDirectory, 'npm-cache'),
  );
  const npmConfigDirectory = path.join(temporaryDirectory, 'npm-config');
  const userConfigPath = path.join(npmConfigDirectory, 'user.npmrc');
  const globalConfigPath = path.join(npmConfigDirectory, 'global.npmrc');
  fs.mkdirSync(npmConfigDirectory, { recursive: true });
  fs.writeFileSync(userConfigPath, '', { flag: 'wx' });
  fs.writeFileSync(globalConfigPath, '', { flag: 'wx' });
  for (const name of [
    'APPDATA',
    'AWS_LAMBDA_FUNCTION_VERSION',
    'CACHE_DIR',
    'LOCALAPPDATA',
    'XDG_CACHE_HOME',
  ]) {
    deleteEnvValue(isolatedEnv, name);
  }
  isolatedEnv.APPDATA = path.join(temporaryDirectory, 'appdata');
  isolatedEnv.LOCALAPPDATA = path.join(temporaryDirectory, 'local-appdata');
  isolatedEnv.XDG_CACHE_HOME = path.join(temporaryDirectory, 'xdg-cache');
  isolatedEnv.npm_config_userconfig = userConfigPath;
  isolatedEnv.npm_config_globalconfig = globalConfigPath;
  return isolatedEnv;
}

function applyDefaultEnv(
  env,
  databaseDefaults = {
    databaseUrl: DEFAULT_DATABASE_URL,
    appDatabaseUrl: DEFAULT_APP_DATABASE_URL,
  },
) {
  for (const [name, defaultValue] of [
    ['DATABASE_URL', databaseDefaults.databaseUrl],
    ['APP_DATABASE_URL', databaseDefaults.appDatabaseUrl],
  ]) {
    const current = readEnvValue(env, name);
    deleteEnvValue(env, name);
    env[name] = current ?? defaultValue;
  }
  return env;
}

function applyExactDatabaseEnv(env, databaseDefaults) {
  for (const [name, value] of [
    ['DATABASE_URL', databaseDefaults.databaseUrl],
    ['APP_DATABASE_URL', databaseDefaults.appDatabaseUrl],
  ]) {
    deleteEnvValue(env, name);
    env[name] = value;
  }
  return env;
}

function createComposeProjectName(
  pid = process.pid,
  randomSuffix = crypto.randomBytes(6).toString('hex'),
) {
  const projectName = `tenancy-modern-${pid}-${randomSuffix}`.toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(projectName)) {
    throw new Error('Modern ecosystem generated an invalid Compose project name');
  }
  return projectName;
}

function composeArgs(projectName, composeFile, args) {
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(projectName)) {
    throw new Error('Modern ecosystem requires a safe Compose project name');
  }
  if (!path.isAbsolute(composeFile)) {
    throw new Error('Modern ecosystem requires an absolute Compose file');
  }
  return [
    'compose',
    '--project-name',
    projectName,
    '--file',
    composeFile,
    ...args,
  ];
}

function createComposeEnv(env) {
  const composeEnv = { ...env };
  for (const name of [
    'COMPOSE_FILE',
    'COMPOSE_PROJECT_NAME',
    'POSTGRES_HOST_PORT',
  ]) {
    deleteEnvValue(composeEnv, name);
  }
  return composeEnv;
}

function parseComposePort(output) {
  const lines = String(output)
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  if (lines.length !== 1) {
    throw new Error('Modern ecosystem expected one published PostgreSQL port');
  }
  const match = lines[0].match(/:(\d+)$/);
  const port = match ? Number(match[1]) : Number.NaN;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Modern ecosystem could not resolve the PostgreSQL port');
  }
  return port;
}

function databaseDefaultsForPort(port) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Modern ecosystem requires a valid PostgreSQL port');
  }
  return {
    databaseUrl: `postgresql://tenancy:tenancy@127.0.0.1:${port}/tenancy_test`,
    appDatabaseUrl: `postgresql://ecosystem_app:ecosystem_app@127.0.0.1:${port}/tenancy_test`,
  };
}

function resolveCommand(
  command,
  args,
  env = process.env,
  platform = process.platform,
) {
  if (command !== 'npm') return { command, args };

  const npmExecPath = readEnvValue(env, 'npm_execpath');
  if (npmExecPath) {
    return { command: process.execPath, args: [npmExecPath, ...args] };
  }
  if (platform === 'win32') {
    throw new Error(
      'Windows modern ecosystem runs must start through an npm script',
    );
  }
  return { command: 'npm', args };
}

function run(command, args, options = {}) {
  const invocation = resolveCommand(command, args, options.env ?? process.env);
  return execFileSync(invocation.command, invocation.args, {
    stdio: 'inherit',
    ...options,
  });
}

function installSignalCleanup(cleanup, targetProcess = process) {
  let handlingSignal = false;
  const handlers = Object.fromEntries(
    Object.entries(SIGNAL_EXIT_CODES).map(([signal, exitCode]) => [
      signal,
      () => {
        if (!handlingSignal) {
          handlingSignal = true;
          cleanup(signal);
        }
        targetProcess.exit(exitCode);
      },
    ]),
  );
  for (const [signal, handler] of Object.entries(handlers)) {
    targetProcess.once(signal, handler);
  }
  return () => {
    for (const [signal, handler] of Object.entries(handlers)) {
      targetProcess.removeListener(signal, handler);
    }
  };
}

function parseArguments(argv) {
  if (argv.length !== 0) {
    throw new Error(
      'Modern ecosystem is published-only and does not accept arguments',
    );
  }
  return { mode: MODERN_MODE };
}

function copyFixture(
  sourceDirectory,
  destinationDirectory,
  fixtureFiles = MODERN_FIXTURE_FILES,
) {
  const realSourceDirectory = fs.realpathSync(sourceDirectory);
  fs.mkdirSync(destinationDirectory, { recursive: true });

  for (const relativePath of fixtureFiles) {
    if (
      path.isAbsolute(relativePath) ||
      relativePath.split(path.sep).includes('..')
    ) {
      throw new Error(`Invalid modern fixture path: ${relativePath}`);
    }
    const sourcePath = path.join(realSourceDirectory, relativePath);
    const sourceStat = fs.lstatSync(sourcePath);
    if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
      throw new Error(`Modern fixture source must be a regular file: ${relativePath}`);
    }
    const realSourcePath = fs.realpathSync(sourcePath);
    const relativeRealPath = path.relative(realSourceDirectory, realSourcePath);
    if (
      relativeRealPath === '' ||
      relativeRealPath === '..' ||
      relativeRealPath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeRealPath)
    ) {
      throw new Error(`Modern fixture source escaped its root: ${relativePath}`);
    }
    const destinationPath = path.join(destinationDirectory, relativePath);
    fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
    fs.copyFileSync(sourcePath, destinationPath);
  }
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  assertPublishedOnlyEnvironment(process.env);

  const workspaceDirectory = path.resolve(__dirname, '..');
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'nestarc-ecosystem-modern-published-only-'),
  );
  const fixtureDirectory = path.join(temporaryDirectory, 'fixture');
  let exitCode = 0;
  let dockerStarted = false;
  let composeProjectName = null;
  let composeEnvironment = null;
  let cleanupStarted = false;
  const composeFile = path.join(fixtureDirectory, 'docker-compose.yml');

  function cleanupOwnedResources() {
    if (cleanupStarted) return;
    cleanupStarted = true;
    let dockerCleanupFailed = false;
    if (dockerStarted && composeProjectName && composeEnvironment) {
      try {
        run(
          'docker',
          composeArgs(
            composeProjectName,
            composeFile,
            ['down', '--volumes', '--remove-orphans'],
          ),
          {
            cwd: workspaceDirectory,
            env: composeEnvironment,
            timeout: 30_000,
          },
        );
      } catch (error) {
        dockerCleanupFailed = true;
        console.error(
          `Docker cleanup failed: ${error instanceof Error ? error.message : error}`,
        );
        if (exitCode === 0) exitCode = error.status || 1;
      }
    }
    if (dockerCleanupFailed) {
      console.error(
        JSON.stringify({
          event: 'ecosystem-cleanup-preserved',
          composeFile,
          composeProjectName,
          temporaryDirectory,
        }),
      );
      return;
    }
    try {
      fs.rmSync(temporaryDirectory, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    } catch (error) {
      console.error(
        `Temporary fixture cleanup failed: ${error instanceof Error ? error.message : error}`,
      );
      if (exitCode === 0) exitCode = 1;
    }
  }

  const removeSignalCleanup = installSignalCleanup((signal) => {
    console.error(`Modern ecosystem received ${signal}; cleaning owned resources`);
    cleanupOwnedResources();
  });

  try {
    const npmEnvironment = createIsolatedValidationEnv(
      process.env,
      temporaryDirectory,
    );
    const baseValidationEnv = {
      ...npmEnvironment,
      ECOSYSTEM_MODE: options.mode,
    };
    console.log(
      JSON.stringify({
        event: 'ecosystem-mode',
        mode: options.mode,
        artifactSource: 'published-lock',
        registry: PUBLIC_NPM_REGISTRY,
        versions: MODERN_PACKAGE_VERSIONS,
      }),
    );

    copyFixture(
      path.join(workspaceDirectory, MODERN_FIXTURE_DIRECTORY),
      fixtureDirectory,
    );

    let validationEnv;
    if (process.env.ECOSYSTEM_SKIP_DOCKER !== '1') {
      composeProjectName = createComposeProjectName();
      composeEnvironment = createComposeEnv(process.env);
      dockerStarted = true;
      run(
        'docker',
        composeArgs(composeProjectName, composeFile, [
          'up',
          '-d',
          '--wait',
          'postgres',
        ]),
        {
          cwd: workspaceDirectory,
          env: composeEnvironment,
        },
      );
      const portOutput = run(
        'docker',
        composeArgs(composeProjectName, composeFile, [
          'port',
          'postgres',
          '5432',
        ]),
        {
          cwd: workspaceDirectory,
          env: composeEnvironment,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'inherit'],
        },
      );
      const postgresPort = parseComposePort(portOutput);
      validationEnv = applyExactDatabaseEnv(
        baseValidationEnv,
        databaseDefaultsForPort(postgresPort),
      );
    } else {
      validationEnv = applyDefaultEnv(baseValidationEnv);
    }

    run('npm', FIXTURE_INSTALL_ARGS, {
      cwd: fixtureDirectory,
      env: validationEnv,
    });
    for (const { command, args } of FIXTURE_VALIDATION_STEPS) {
      run(command, args, {
        cwd: fixtureDirectory,
        env: validationEnv,
      });
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    exitCode = error.status || 1;
  } finally {
    cleanupOwnedResources();
    removeSignalCleanup();
  }

  process.exit(exitCode);
}

if (require.main === module) main();

module.exports = {
  DEFAULT_APP_DATABASE_URL,
  DEFAULT_DATABASE_URL,
  FIXTURE_INSTALL_ARGS,
  FIXTURE_VALIDATION_STEPS,
  MODERN_FIXTURE_DIRECTORY,
  MODERN_COMPOSE_FILE,
  MODERN_FIXTURE_FILES,
  MODERN_MODE,
  MODERN_PACKAGE_VERSIONS,
  PUBLIC_NPM_REGISTRY,
  applyDefaultEnv,
  applyExactDatabaseEnv,
  assertPublishedOnlyEnvironment,
  composeArgs,
  copyFixture,
  createComposeEnv,
  createComposeProjectName,
  createIsolatedValidationEnv,
  createStrictNpmEnv,
  databaseDefaultsForPort,
  deleteEnvValue,
  parseArguments,
  parseComposePort,
  readEnvValues,
  resolveCommand,
  installSignalCleanup,
  SIGNAL_EXIT_CODES,
};
