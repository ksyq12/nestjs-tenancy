import fs from 'fs';
import { EventEmitter } from 'events';
import os from 'os';
import path from 'path';

const {
  DEFAULT_APP_DATABASE_URL,
  DEFAULT_DATABASE_URL,
  FIXTURE_INSTALL_ARGS,
  FIXTURE_VALIDATION_STEPS,
  MODERN_COMPOSE_FILE,
  MODERN_FIXTURE_DIRECTORY,
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
  parseArguments,
  parseComposePort,
  readEnvValues,
  resolveCommand,
  installSignalCleanup,
  SIGNAL_EXIT_CODES,
} = require('../../scripts/test-modern-ecosystem-e2e');

const {
  canonicalPackageNames,
  validateInstalledGraph,
  validateLockfileProvenance,
} = require('../ecosystem/modern-fixture/scripts/verify-packages.cjs');

const EXPECTED_MODERN_VERSIONS = {
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
};

const EXPECTED_NESTARC_INTEGRITIES = {
  '@nestarc/tenancy':
    'sha512-JqMtY9FHJSHr7QY5XAB0rlTGzVtpgqRKH1sycy1H8MGIRdIPTASxC6YwLL5N2ujUCLGIt8f0qNh10I58KoB/Tw==',
  '@nestarc/api-keys':
    'sha512-powmFRJjXk6VSsZ9IXy4n/xvts6W7wOXZgWVDTTfcKUqTQv8it34jXwRqc3dytTsBc27kki/OW13hhd6Zy4rOA==',
  '@nestarc/rbac':
    'sha512-9dqvRNC7sI3IKO/gUf6pRKbK4MSVvKXs0YgahYDsJkHZvhTMflYzaS5H9CnzViLMWuHV6eVmsXkWY8J52PVJ1w==',
  '@nestarc/jobs':
    'sha512-KgEA3/zWU4cyW3t+UXCAlHfPh/YZTfNl93i7E7oYCB2yHRYbR6RquBPa2tGDZX3oXPO5uV5sc3ogHZwYSi1Eyg==',
  '@nestarc/outbox':
    'sha512-VfxGSeRgKk9MVFCCbvzym2nk6I+qfkoFzY1B04I7y40nZSMaXn4Nh0t+FDgH4OT90ZYZDrGJVQbwNNmzEDkKcw==',
  '@nestarc/webhook':
    'sha512-Kv/Up+HfaFT56jdWwtotNwI57SfQsUjww6wy3Ux8n5xnJKOi71NwL0M18GiZNzOpB2n4GBGRU6Q5BE0Zi91IzA==',
};

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function listFiles(directory: string, prefix = ''): string[] {
  return fs
    .readdirSync(path.join(directory, prefix), { withFileTypes: true })
    .flatMap((entry) => {
      const relativePath = path.join(prefix, entry.name);
      return entry.isDirectory()
        ? listFiles(directory, relativePath)
        : [relativePath];
    })
    .sort();
}

function readFixtureManifestAndLockfile() {
  const fixtureDirectory = path.join(process.cwd(), MODERN_FIXTURE_DIRECTORY);
  return {
    manifest: JSON.parse(
      fs.readFileSync(path.join(fixtureDirectory, 'package.json'), 'utf8'),
    ),
    lockfile: JSON.parse(
      fs.readFileSync(path.join(fixtureDirectory, 'package-lock.json'), 'utf8'),
    ),
  };
}

describe('modern published-only ecosystem E2E runner', () => {
  it('pins the accepted Nest 11 and Prisma 7 tuple exactly', () => {
    expect(MODERN_MODE).toBe('modern-published-only');
    expect(MODERN_PACKAGE_VERSIONS).toEqual(EXPECTED_MODERN_VERSIONS);
  });

  it('uses deterministic database defaults and preserves mixed-case overrides', () => {
    const defaults: Record<string, string | undefined> = {};
    expect(applyDefaultEnv(defaults)).toEqual({
      DATABASE_URL: DEFAULT_DATABASE_URL,
      APP_DATABASE_URL: DEFAULT_APP_DATABASE_URL,
    });

    const custom = {
      database_url: 'postgresql://owner/custom',
      App_Database_Url: 'postgresql://app/custom',
    };
    expect(applyDefaultEnv(custom)).toEqual({
      DATABASE_URL: 'postgresql://owner/custom',
      APP_DATABASE_URL: 'postgresql://app/custom',
    });

    expect(
      applyExactDatabaseEnv(custom, databaseDefaultsForPort(49152)),
    ).toEqual({
      DATABASE_URL:
        'postgresql://tenancy:tenancy@127.0.0.1:49152/tenancy_test',
      APP_DATABASE_URL:
        'postgresql://ecosystem_app:ecosystem_app@127.0.0.1:49152/tenancy_test',
    });
  });

  it('refuses force and legacy peer bypasses case-insensitively', () => {
    for (const env of [
      { npm_config_force: 'true' },
      { NPM_CONFIG_FORCE: 'YES' },
      { 'npm-config-force': 'on' },
    ]) {
      expect(() => assertPublishedOnlyEnvironment(env)).toThrow(
        'refuses npm force',
      );
    }
    for (const env of [
      { npm_config_legacy_peer_deps: '1' },
      { NPM_CONFIG_LEGACY_PEER_DEPS: 'TRUE' },
      { 'npm-config-legacy-peer-deps': 'On' },
    ]) {
      expect(() => assertPublishedOnlyEnvironment(env)).toThrow(
        'refuses npm legacy-peer-deps',
      );
    }

    expect(() =>
      assertPublishedOnlyEnvironment({
        npm_config_force: 'false',
        NPM_CONFIG_FORCE: 'true',
      }),
    ).toThrow('refuses npm force');
    expect(() =>
      assertPublishedOnlyEnvironment({
        npm_config_legacy_peer_deps: 'off',
        NPM_CONFIG_LEGACY_PEER_DEPS: 'yes',
      }),
    ).toThrow('refuses npm legacy-peer-deps');

    expect(() =>
      assertPublishedOnlyEnvironment({
        npm_config_force: 'false',
        NPM_CONFIG_LEGACY_PEER_DEPS: 'off',
      }),
    ).not.toThrow();
  });

  it('refuses local source and candidate controls', () => {
    for (const name of [
      'NESTARC_ECOSYSTEM_SOURCE_ROOT',
      'TENANCY_CANDIDATE_VERSION',
      'TENANCY_CANDIDATE_INTEGRITY',
    ]) {
      expect(() =>
        assertPublishedOnlyEnvironment({ [name.toLowerCase()]: 'set' }),
      ).toThrow(`refuses ${name}`);
      expect(() =>
        assertPublishedOnlyEnvironment({ [name]: '' }),
      ).toThrow(`refuses ${name}`);
    }
  });

  it('refuses ambient Node and npm execution hooks case-insensitively', () => {
    for (const name of [
      'NODE_OPTIONS',
      'NODE_PATH',
      'npm_config_node_options',
      'npm_config_script_shell',
    ]) {
      expect(() =>
        assertPublishedOnlyEnvironment({ [name.toUpperCase()]: '' }),
      ).toThrow(`refuses ${name}`);
      expect(() =>
        assertPublishedOnlyEnvironment({ [name.replaceAll('_', '-')]: 'set' }),
      ).toThrow(`refuses ${name}`);
    }
  });

  it('refuses Prisma engine download and executable overrides', () => {
    for (const name of [
      'BINARY_DOWNLOAD_VERSION',
      'PRISMA_BINARIES_MIRROR',
      'PRISMA_CLI_BINARY_TARGETS',
      'PRISMA_CLI_QUERY_ENGINE_TYPE',
      'PRISMA_CLIENT_ENGINE_TYPE',
      'PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING',
      'PRISMA_ENGINES_MIRROR',
      'PRISMA_FMT_BINARY',
      'PRISMA_GENERATE_NO_ENGINE',
      'PRISMA_INTROSPECTION_ENGINE_BINARY',
      'PRISMA_MIGRATION_ENGINE_BINARY',
      'PRISMA_QUERY_ENGINE_BINARY',
      'PRISMA_QUERY_ENGINE_LIBRARY',
      'PRISMA_SCHEMA_ENGINE_BINARY',
    ]) {
      expect(() =>
        assertPublishedOnlyEnvironment({ [name.toLowerCase()]: '' }),
      ).toThrow(`refuses Prisma engine override ${name}`);
    }
  });

  it('removes every ambient npm override and uses an isolated absolute cache', () => {
    const cachePath = path.join(os.tmpdir(), 'modern-runner-test-cache');
    expect(
      createStrictNpmEnv(
        {
          NPM_CONFIG_FORCE: 'true',
          npm_config_legacy_peer_deps: 'true',
          'npm-config-registry': 'https://mirror.invalid/',
          npm_config_replace_registry_host: 'always',
          NPM_CONFIG_STRICT_PEER_DEPS: 'false',
          npm_config_script_shell: '/tmp/hostile-shell',
          NPM_CONFIG_NODE_OPTIONS: '--require=/tmp/hostile.cjs',
          npm_config_ignore_scripts: 'true',
          npm_config_cache: '/tmp/ambient-cache',
          SAFE_VALUE: 'kept',
        },
        cachePath,
      ),
    ).toEqual({
      SAFE_VALUE: 'kept',
      npm_config_force: 'false',
      npm_config_legacy_peer_deps: 'false',
      npm_config_registry: PUBLIC_NPM_REGISTRY,
      npm_config_replace_registry_host: 'never',
      npm_config_strict_peer_deps: 'true',
      npm_config_cache: cachePath,
    });

    expect(() => createStrictNpmEnv({}, 'relative-cache')).toThrow(
      'cache must be an absolute path',
    );

    expect(FIXTURE_INSTALL_ARGS).toEqual([
      'ci',
      '--strict-peer-deps',
      '--no-force',
      '--no-legacy-peer-deps',
      `--registry=${PUBLIC_NPM_REGISTRY}`,
      '--replace-registry-host=never',
      '--no-audit',
      '--no-fund',
    ]);
    expect(FIXTURE_INSTALL_ARGS).not.toContain('--force');
    expect(FIXTURE_INSTALL_ARGS).not.toContain('--legacy-peer-deps');
  });

  it('isolates npm config and Prisma caches from the ambient machine', () => {
    const temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-validation-env-test-'),
    );
    try {
      const isolated = createIsolatedValidationEnv(
        {
          APPDATA: '/ambient/appdata',
          aws_lambda_function_version: 'ambient-lambda',
          'cache-dir': '/ambient/cache',
          LOCALAPPDATA: '/ambient/local-appdata',
          xdg_cache_home: '/ambient/xdg',
          NPM_CONFIG_USERCONFIG: '/ambient/user.npmrc',
          npm_config_globalconfig: '/ambient/global.npmrc',
        },
        temporaryDirectory,
      );

      expect(isolated).toMatchObject({
        APPDATA: path.join(temporaryDirectory, 'appdata'),
        LOCALAPPDATA: path.join(temporaryDirectory, 'local-appdata'),
        XDG_CACHE_HOME: path.join(temporaryDirectory, 'xdg-cache'),
        npm_config_cache: path.join(temporaryDirectory, 'npm-cache'),
        npm_config_userconfig: path.join(
          temporaryDirectory,
          'npm-config',
          'user.npmrc',
        ),
        npm_config_globalconfig: path.join(
          temporaryDirectory,
          'npm-config',
          'global.npmrc',
        ),
      });
      expect(
        readEnvValues(isolated, 'AWS_LAMBDA_FUNCTION_VERSION'),
      ).toEqual([]);
      expect(readEnvValues(isolated, 'CACHE_DIR')).toEqual([]);
      expect(readEnvValues(isolated, 'APPDATA')).toEqual([
        path.join(temporaryDirectory, 'appdata'),
      ]);
      expect(readEnvValues(isolated, 'LOCALAPPDATA')).toEqual([
        path.join(temporaryDirectory, 'local-appdata'),
      ]);
      expect(readEnvValues(isolated, 'XDG_CACHE_HOME')).toEqual([
        path.join(temporaryDirectory, 'xdg-cache'),
      ]);
      expect(fs.readFileSync(isolated.npm_config_userconfig, 'utf8')).toBe('');
      expect(fs.readFileSync(isolated.npm_config_globalconfig, 'utf8')).toBe(
        '',
      );
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('does not accept a local artifact or any other runner argument', () => {
    expect(parseArguments([])).toEqual({ mode: 'modern-published-only' });
    expect(() => parseArguments(['--tenancy-tarball', './candidate.tgz'])).toThrow(
      'does not accept arguments',
    );
    expect(() => parseArguments(['--mode', 'published-only'])).toThrow(
      'does not accept arguments',
    );
  });

  it('invokes npm without a Windows command shim', () => {
    const npmExecPath = '/tools/npm/bin/npm-cli.js';
    expect(
      resolveCommand('npm', ['ci'], { npm_execpath: npmExecPath }, 'win32'),
    ).toEqual({
      command: process.execPath,
      args: [npmExecPath, 'ci'],
    });
    expect(resolveCommand('docker', ['compose'], {}, 'win32')).toEqual({
      command: 'docker',
      args: ['compose'],
    });
    expect(() => resolveCommand('npm', ['ci'], {}, 'win32')).toThrow(
      'must start through an npm script',
    );
    expect(resolveCommand('npm', ['ci'], {}, 'linux')).toEqual({
      command: 'npm',
      args: ['ci'],
    });
  });

  it('owns an isolated Compose project, file, port, and cleanup scope', () => {
    const projectName = createComposeProjectName(4242, 'A1B2C3');
    const composeFile = path.resolve('/tmp/modern-fixture/docker-compose.yml');

    expect(projectName).toBe('tenancy-modern-4242-a1b2c3');
    expect(createComposeProjectName(4242, 'different')).not.toBe(projectName);
    expect(MODERN_COMPOSE_FILE).toBe(
      path.join(MODERN_FIXTURE_DIRECTORY, 'docker-compose.yml'),
    );
    expect(
      composeArgs(projectName, composeFile, [
        'up',
        '-d',
        '--wait',
        'postgres',
      ]),
    ).toEqual([
      'compose',
      '--project-name',
      projectName,
      '--file',
      composeFile,
      'up',
      '-d',
      '--wait',
      'postgres',
    ]);
    expect(
      composeArgs(projectName, composeFile, [
        'down',
        '--volumes',
        '--remove-orphans',
      ]),
    ).toEqual([
      'compose',
      '--project-name',
      projectName,
      '--file',
      composeFile,
      'down',
      '--volumes',
      '--remove-orphans',
    ]);
    expect(() => composeArgs('../shared', composeFile, ['down'])).toThrow(
      'safe Compose project name',
    );
    expect(() =>
      composeArgs(projectName, MODERN_COMPOSE_FILE, ['down']),
    ).toThrow('absolute Compose file');

    expect(
      createComposeEnv({
        COMPOSE_FILE: '/tmp/shared.yml',
        compose_project_name: 'shared',
        'postgres-host-port': '5433',
        SAFE_VALUE: 'kept',
      }),
    ).toEqual({ SAFE_VALUE: 'kept' });

    expect(parseComposePort('127.0.0.1:49152\n')).toBe(49152);
    expect(parseComposePort('[::1]:49153\r\n')).toBe(49153);
    expect(() => parseComposePort('127.0.0.1:1\n127.0.0.1:2')).toThrow(
      'expected one published PostgreSQL port',
    );
    expect(() => parseComposePort('not-a-port')).toThrow(
      'could not resolve the PostgreSQL port',
    );
    expect(databaseDefaultsForPort(49152)).toEqual({
      databaseUrl:
        'postgresql://tenancy:tenancy@127.0.0.1:49152/tenancy_test',
      appDatabaseUrl:
        'postgresql://ecosystem_app:ecosystem_app@127.0.0.1:49152/tenancy_test',
    });
    expect(() => databaseDefaultsForPort(0)).toThrow(
      'requires a valid PostgreSQL port',
    );
  });

  it.each(Object.entries(SIGNAL_EXIT_CODES))(
    'cleans once and exits with the conventional %s code',
    (signal, exitCode) => {
      const targetProcess = new EventEmitter() as EventEmitter & {
        exit: jest.Mock;
      };
      targetProcess.exit = jest.fn();
      const cleanup = jest.fn();
      const unregister = installSignalCleanup(cleanup, targetProcess);

      targetProcess.emit(signal);

      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(cleanup).toHaveBeenCalledWith(signal);
      expect(targetProcess.exit).toHaveBeenCalledWith(exitCode);
      unregister();
    },
  );

  it('can unregister signal cleanup before normal exit', () => {
    const targetProcess = new EventEmitter() as EventEmitter & {
      exit: jest.Mock;
    };
    targetProcess.exit = jest.fn();
    const cleanup = jest.fn();
    const unregister = installSignalCleanup(cleanup, targetProcess);

    unregister();
    targetProcess.emit('SIGTERM');

    expect(cleanup).not.toHaveBeenCalled();
    expect(targetProcess.exit).not.toHaveBeenCalled();
  });

  it('uses direct JavaScript entrypoints for provenance, Prisma, typecheck, and Jest', () => {
    expect(FIXTURE_VALIDATION_STEPS).toEqual([
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
        args: [
          path.join('node_modules', 'typescript', 'bin', 'tsc'),
          '--noEmit',
        ],
      },
      {
        command: process.execPath,
        args: [
          '--experimental-vm-modules',
          path.join('node_modules', 'jest', 'bin', 'jest.js'),
          '--runInBand',
        ],
      },
    ]);
    expect(
      FIXTURE_VALIDATION_STEPS.filter(
        ({ command }: { command: string }) => command === 'npm',
      ),
    ).toEqual([{ command: 'npm', args: ['ls', '--all'] }]);
  });

  it('copies only the explicit fixture allowlist and ignores ambient artifacts', () => {
    const temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-fixture-copy-test-'),
    );
    const sourceDirectory = path.join(temporaryDirectory, 'source');
    const destinationDirectory = path.join(temporaryDirectory, 'destination');

    try {
      for (const relativePath of MODERN_FIXTURE_FILES) {
        const sourcePath = path.join(sourceDirectory, relativePath);
        fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
        fs.writeFileSync(sourcePath, `fixture:${relativePath}`);
      }
      for (const relativePath of [
        '.npmrc',
        'candidate.tgz',
        path.join('src', 'runtime.js'),
        path.join('scripts', 'stale.cjs'),
      ]) {
        const sourcePath = path.join(sourceDirectory, relativePath);
        fs.mkdirSync(path.dirname(sourcePath), { recursive: true });
        fs.writeFileSync(sourcePath, 'must-not-copy');
      }

      copyFixture(sourceDirectory, destinationDirectory);

      expect(listFiles(destinationDirectory)).toEqual(
        [...MODERN_FIXTURE_FILES].sort(),
      );
      expect(listFiles(destinationDirectory)).not.toEqual(
        expect.arrayContaining([
          '.npmrc',
          'candidate.tgz',
          path.join('src', 'runtime.js'),
          path.join('scripts', 'stale.cjs'),
        ]),
      );
      expect(MODERN_FIXTURE_FILES).not.toEqual(
        expect.arrayContaining([
          '.npmrc',
          'candidate.tgz',
          path.join('src', 'runtime.js'),
        ]),
      );
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('rejects symlinks even when their path is explicitly allowlisted', () => {
    const temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-fixture-symlink-test-'),
    );
    const sourceDirectory = path.join(temporaryDirectory, 'source');
    const destinationDirectory = path.join(temporaryDirectory, 'destination');
    const realFile = path.join(sourceDirectory, 'real.json');
    const linkedFile = path.join(sourceDirectory, 'package.json');

    try {
      fs.mkdirSync(sourceDirectory, { recursive: true });
      fs.writeFileSync(realFile, '{}');
      fs.symlinkSync(realFile, linkedFile, 'file');

      expect(() =>
        copyFixture(sourceDirectory, destinationDirectory, ['package.json']),
      ).toThrow('source must be a regular file');
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('commits exact public-registry lock provenance for every direct package', () => {
    const fixtureDirectory = path.join(process.cwd(), MODERN_FIXTURE_DIRECTORY);
    const manifest = JSON.parse(
      fs.readFileSync(path.join(fixtureDirectory, 'package.json'), 'utf8'),
    );
    const lockfile = JSON.parse(
      fs.readFileSync(path.join(fixtureDirectory, 'package-lock.json'), 'utf8'),
    );
    const directDependencies = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
    };

    expect(lockfile.packages[''].dependencies).toEqual(manifest.dependencies);
    expect(lockfile.packages[''].devDependencies).toEqual(
      manifest.devDependencies,
    );
    for (const [packageName, requested] of Object.entries<string>(
      directDependencies,
    )) {
      const lockEntry = lockfile.packages[`node_modules/${packageName}`];
      expect(requested).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
      expect(lockEntry.version).toBe(requested);
      expect(lockEntry.resolved).toMatch(/^https:\/\/registry\.npmjs\.org\//);
      expect(lockEntry.integrity).toMatch(/^sha512-/);
      expect(lockEntry.link).not.toBe(true);
    }
    for (const [packageName, expectedVersion] of Object.entries(
      EXPECTED_MODERN_VERSIONS,
    )) {
      expect(directDependencies[packageName]).toBe(expectedVersion);
    }
    expect(directDependencies['@opentelemetry/api']).toBe('1.9.1');
    for (const [packageName, expectedIntegrity] of Object.entries(
      EXPECTED_NESTARC_INTEGRITIES,
    )) {
      expect(lockfile.packages[`node_modules/${packageName}`].integrity).toBe(
        expectedIntegrity,
      );
    }
  });

  it.each([
    ['local file resolution', 'file:../accepts.tgz'],
    [
      'private registry resolution',
      'https://registry.internal.invalid/accepts/-/accepts-2.0.0.tgz',
    ],
  ])('rejects %s in a transitive lock entry', (_label, resolved) => {
    const { manifest, lockfile } = readFixtureManifestAndLockfile();
    lockfile.packages['node_modules/accepts'].resolved = resolved;

    expect(() => validateLockfileProvenance(manifest, lockfile)).toThrow(
      'must resolve from the public npm registry',
    );
  });

  it('rejects linked, malformed-integrity, and missing-integrity lock entries', () => {
    const { manifest, lockfile: committedLockfile } =
      readFixtureManifestAndLockfile();

    const linkedLockfile = cloneJson(committedLockfile);
    linkedLockfile.packages['node_modules/accepts'].link = true;
    expect(() =>
      validateLockfileProvenance(manifest, linkedLockfile),
    ).toThrow('must not be linked');

    const malformedIntegrityLockfile = cloneJson(committedLockfile);
    malformedIntegrityLockfile.packages['node_modules/accepts'].integrity =
      'sha512-AA==';
    expect(() =>
      validateLockfileProvenance(manifest, malformedIntegrityLockfile),
    ).toThrow('must have SHA-512 integrity');

    const missingIntegrityLockfile = cloneJson(committedLockfile);
    delete missingIntegrityLockfile.packages['node_modules/accepts'].integrity;
    expect(() =>
      validateLockfileProvenance(manifest, missingIntegrityLockfile),
    ).toThrow('must have SHA-512 integrity');

    const noncanonicalIntegrityLockfile = cloneJson(committedLockfile);
    noncanonicalIntegrityLockfile.packages['node_modules/accepts'].integrity =
      `sha512-${'A'.repeat(85)}B==`;
    expect(() =>
      validateLockfileProvenance(manifest, noncanonicalIntegrityLockfile),
    ).toThrow('must have SHA-512 integrity');
  });

  it.each(['@nestjs/common', 'pg'])(
    'rejects a duplicate nested canonical package %s',
    (criticalPackage) => {
    const { manifest, lockfile } = readFixtureManifestAndLockfile();
    expect(canonicalPackageNames).toContain(criticalPackage);
    lockfile.packages[
      `node_modules/accepts/node_modules/${criticalPackage}`
    ] = cloneJson(lockfile.packages[`node_modules/${criticalPackage}`]);

    expect(() => validateLockfileProvenance(manifest, lockfile)).toThrow(
      `${criticalPackage} must have one canonical lock entry`,
    );
    },
  );

  it('rejects malformed and parentless transitive package-lock paths', () => {
    const { manifest, lockfile: committedLockfile } =
      readFixtureManifestAndLockfile();

    const malformedPathLockfile = cloneJson(committedLockfile);
    malformedPathLockfile.packages[
      'node_modules/accepts/lib/node_modules/ghost'
    ] = cloneJson(committedLockfile.packages['node_modules/accepts']);
    expect(() =>
      validateLockfileProvenance(manifest, malformedPathLockfile),
    ).toThrow('Invalid package-lock path');

    const parentlessLockfile = cloneJson(committedLockfile);
    parentlessLockfile.packages[
      'node_modules/not-installed/node_modules/ghost'
    ] = cloneJson(committedLockfile.packages['node_modules/accepts']);
    expect(() =>
      validateLockfileProvenance(manifest, parentlessLockfile),
    ).toThrow('must have a package-lock parent entry');

    for (const invalidPath of [
      'node_modules/.hidden',
      'node_modules/@scope/.hidden',
      'node_modules/package\\name',
    ]) {
      const invalidNameLockfile = cloneJson(committedLockfile);
      invalidNameLockfile.packages[invalidPath] = cloneJson(
        committedLockfile.packages['node_modules/accepts'],
      );
      expect(() =>
        validateLockfileProvenance(manifest, invalidNameLockfile),
      ).toThrow('Invalid');
    }
  });

  it('rejects symlinked, hidden, and extraneous installed package roots', () => {
    const temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-installed-graph-test-'),
    );
    const fixtureRoot = path.join(temporaryDirectory, 'fixture');
    const outsideNodeModules = path.join(temporaryDirectory, 'outside');
    fs.mkdirSync(fixtureRoot, { recursive: true });
    fs.mkdirSync(outsideNodeModules, { recursive: true });
    fs.symlinkSync(outsideNodeModules, path.join(fixtureRoot, 'node_modules'), 'dir');
    try {
      expect(() =>
        validateInstalledGraph(fixtureRoot, { packages: {} }, {}),
      ).toThrow('node_modules must not be a symlink');
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }

    const hiddenDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'modern-hidden-package-test-'),
    );
    try {
      const nodeModules = path.join(hiddenDirectory, 'node_modules');
      fs.mkdirSync(path.join(nodeModules, '.evil'), { recursive: true });
      expect(() =>
        validateInstalledGraph(hiddenDirectory, { packages: {} }, {}),
      ).toThrow('unexpected hidden node_modules entry');

      fs.rmSync(path.join(nodeModules, '.evil'), { recursive: true });
      fs.mkdirSync(path.join(nodeModules, 'extraneous'), { recursive: true });
      expect(() =>
        validateInstalledGraph(hiddenDirectory, { packages: {} }, {}),
      ).toThrow('installed but absent from package-lock.json');
    } finally {
      fs.rmSync(hiddenDirectory, { recursive: true, force: true });
    }
  });

  it('uses Prisma 7 configuration and the PostgreSQL driver adapter', () => {
    const fixtureDirectory = path.join(process.cwd(), MODERN_FIXTURE_DIRECTORY);
    const schema = fs.readFileSync(
      path.join(fixtureDirectory, 'prisma/schema.prisma'),
      'utf8',
    );
    const prismaConfig = fs.readFileSync(
      path.join(fixtureDirectory, 'prisma.config.ts'),
      'utf8',
    );
    const runtime = fs.readFileSync(
      path.join(fixtureDirectory, 'src/runtime.ts'),
      'utf8',
    );
    const verifier = fs.readFileSync(
      path.join(fixtureDirectory, 'scripts/verify-packages.cjs'),
      'utf8',
    );

    expect(schema).toContain('provider            = "prisma-client"');
    expect(schema).not.toMatch(/^\s*url\s*=/m);
    expect(prismaConfig).toContain("url: env('APP_DATABASE_URL')");
    expect(runtime).toContain("import { PrismaPg } from '@prisma/adapter-pg'");
    expect(runtime).toContain('adapter: new PrismaPg({ connectionString:');
    expect(verifier).toContain('fs.realpathSync(installedPath)');
  });

  it('keeps the isolated dependency graph out of repository-level type and lint gates', () => {
    for (const configPath of [
      'tsconfig.typecheck.json',
      'eslint.config.mjs',
      'eslint.typed.config.mjs',
    ]) {
      expect(fs.readFileSync(path.join(process.cwd(), configPath), 'utf8')).toContain(
        'test/ecosystem/modern-fixture',
      );
    }
  });
});
