#!/usr/bin/env node
/**
 * Installs a deterministic Nestarc artifact graph into an isolated fixture app
 * and runs the API key -> tenancy -> RBAC -> DB -> outbox -> jobs -> webhook E2E.
 */
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isDeepStrictEqual } = require('util');
const zlib = require('zlib');

const FIXTURE_DIRECTORY = path.join('test', 'ecosystem', 'fixture');
const TENANCY_PACKAGE = '@nestarc/tenancy';
const PACKAGE_VERSION_PATTERN =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const PUBLIC_NPM_REGISTRY = 'https://registry.npmjs.org/';
const ECOSYSTEM_PACKAGE_NAMES = [
  TENANCY_PACKAGE,
  '@nestarc/api-keys',
  '@nestarc/rbac',
  '@nestarc/jobs',
  '@nestarc/outbox',
  '@nestarc/webhook',
];
const DEFAULT_DATABASE_URL =
  'postgresql://tenancy:tenancy@127.0.0.1:5433/tenancy_test';
const DEFAULT_APP_DATABASE_URL =
  'postgresql://ecosystem_app:ecosystem_app@127.0.0.1:5433/tenancy_test';
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
const FIXTURE_LOCK_REFRESH_ARGS = [
  'install',
  '--package-lock-only',
  '--ignore-scripts',
  '--strict-peer-deps',
  '--no-force',
  '--no-legacy-peer-deps',
  `--registry=${PUBLIC_NPM_REGISTRY}`,
  '--replace-registry-host=never',
  '--no-audit',
  '--no-fund',
];
const FIXTURE_VALIDATION_STEPS = [
  { command: 'npm', args: ['run', 'verify:packages'] },
  { command: 'npm', args: ['run', 'typecheck'] },
  { command: 'npm', args: ['exec', '--', 'jest', '--runInBand'] },
];

function normalizeEnvKey(key) {
  return key.toLowerCase().replaceAll('-', '_');
}

function deleteEnvValue(env, name) {
  const normalizedName = normalizeEnvKey(name);
  for (const key of Object.keys(env)) {
    if (normalizeEnvKey(key) === normalizedName) delete env[key];
  }
  return env;
}

function applyDefaultEnv(env) {
  for (const [name, defaultValue] of [
    ['DATABASE_URL', DEFAULT_DATABASE_URL],
    ['APP_DATABASE_URL', DEFAULT_APP_DATABASE_URL],
  ]) {
    const existingValue =
      Object.prototype.hasOwnProperty.call(env, name) && env[name] !== undefined
        ? env[name]
        : readEnvValue(env, name);
    deleteEnvValue(env, name);
    env[name] = existingValue ?? defaultValue;
  }
  return env;
}

function readEnvValue(env, name) {
  const normalizedName = normalizeEnvKey(name);
  const entry = Object.entries(env).find(
    ([key]) => normalizeEnvKey(key) === normalizedName,
  );
  return entry?.[1];
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
    return {
      command: process.execPath,
      args: [npmExecPath, ...args],
    };
  }
  if (platform === 'win32') {
    throw new Error(
      'Windows ecosystem runs must be started through an npm script so npm_execpath is available',
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

function createStrictNpmEnv(env) {
  const strictEnv = { ...env };
  for (const key of Object.keys(strictEnv)) {
    const normalized = normalizeEnvKey(key);
    if (
      normalized === 'npm_config_force' ||
      normalized === 'npm_config_legacy_peer_deps' ||
      normalized === 'npm_config_registry' ||
      normalized === 'npm_config_replace_registry_host' ||
      normalized === 'npm_config_strict_peer_deps'
    ) {
      delete strictEnv[key];
    }
  }
  strictEnv.npm_config_force = 'false';
  strictEnv.npm_config_legacy_peer_deps = 'false';
  strictEnv.npm_config_registry = PUBLIC_NPM_REGISTRY;
  strictEnv.npm_config_replace_registry_host = 'never';
  strictEnv.npm_config_strict_peer_deps = 'true';
  return strictEnv;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readOptionValue(argv, index, optionName) {
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`${optionName} requires a value`);
  }
  return value;
}

function parseArguments(argv) {
  let mode = null;
  let tenancyTarball = null;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--mode') {
      if (mode !== null) throw new Error('--mode may only be provided once');
      mode = readOptionValue(argv, index, '--mode');
      index += 1;
      continue;
    }
    if (argument === '--tenancy-tarball') {
      if (tenancyTarball !== null) {
        throw new Error('--tenancy-tarball may only be provided once');
      }
      tenancyTarball = path.resolve(
        readOptionValue(argv, index, '--tenancy-tarball'),
      );
      index += 1;
      continue;
    }
    throw new Error(`Unknown ecosystem option: ${argument}`);
  }

  if (mode === null) throw new Error('Missing required --mode');
  if (mode !== 'published-only' && mode !== 'local-artifact') {
    throw new Error(`Unsupported ecosystem mode: ${mode}`);
  }
  if (mode === 'published-only' && tenancyTarball !== null) {
    throw new Error('published-only does not accept --tenancy-tarball');
  }
  if (mode === 'local-artifact' && tenancyTarball === null) {
    throw new Error(
      'local-artifact requires --tenancy-tarball with an explicit .tgz file',
    );
  }

  return { mode, tenancyTarball };
}

function validateTenancyTarball(tarballPath) {
  if (path.extname(tarballPath) !== '.tgz') {
    throw new Error('--tenancy-tarball must point to a .tgz file');
  }
  let stat;
  try {
    stat = fs.statSync(tarballPath);
  } catch {
    throw new Error(`Tenancy tarball does not exist: ${tarballPath}`);
  }
  if (!stat.isFile()) {
    throw new Error(`Tenancy tarball is not a regular file: ${tarballPath}`);
  }
  return fs.realpathSync(tarballPath);
}

function readTarString(buffer, start, length) {
  const end = buffer.indexOf(0, start);
  const boundedEnd = end === -1 || end > start + length ? start + length : end;
  return buffer.toString('utf8', start, boundedEnd);
}

function readTarOctal(buffer, start, length) {
  const raw = readTarString(buffer, start, length).trim();
  if (!/^[0-7]+$/.test(raw)) throw new Error('Invalid tar entry size');
  return Number.parseInt(raw, 8);
}

function readPackageManifestFromTarball(tarballPath) {
  let archive;
  try {
    archive = zlib.gunzipSync(fs.readFileSync(tarballPath));
  } catch {
    throw new Error('Tenancy artifact must be a readable gzip tarball');
  }

  let packageManifest = null;
  for (let offset = 0; offset + 512 <= archive.length; ) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;

    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const entryPath = prefix ? `${prefix}/${name}` : name;
    const size = readTarOctal(header, 124, 12);
    const type = header[156];
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > archive.length) throw new Error('Truncated tenancy tarball');

    if (entryPath === 'package/package.json') {
      if (packageManifest !== null) {
        throw new Error(
          'Tenancy tarball contains duplicate package/package.json entries',
        );
      }
      if (type !== 0 && type !== '0'.charCodeAt(0)) {
        throw new Error('Tenancy tarball package.json must be a regular file');
      }
      if (size > 1024 * 1024) {
        throw new Error('Tenancy tarball package.json is unexpectedly large');
      }
      try {
        packageManifest = JSON.parse(
          archive.toString('utf8', dataStart, dataEnd),
        );
      } catch {
        throw new Error('Tenancy tarball package.json is invalid JSON');
      }
    }

    offset = dataStart + Math.ceil(size / 512) * 512;
  }

  if (packageManifest === null) {
    throw new Error('Tenancy tarball is missing package/package.json');
  }
  return packageManifest;
}

function assertTenancyPackageManifest(manifest) {
  if (manifest?.name !== TENANCY_PACKAGE) {
    throw new Error(`Local artifact must be ${TENANCY_PACKAGE}`);
  }
  if (
    typeof manifest.version !== 'string' ||
    !PACKAGE_VERSION_PATTERN.test(manifest.version)
  ) {
    throw new Error('Local tenancy artifact must have a valid package version');
  }
  return manifest.version;
}

function inspectTenancyTarball(tarballPath) {
  return {
    version: assertTenancyPackageManifest(
      readPackageManifestFromTarball(tarballPath),
    ),
    integrity: sha512Integrity(tarballPath),
  };
}

function applyPackageSpecs(manifest, packageSpecs) {
  const next = {
    ...manifest,
    dependencies: { ...manifest.dependencies },
  };
  for (const [packageName, packageSpec] of Object.entries(packageSpecs)) {
    if (!(packageName in next.dependencies)) {
      throw new Error(`Fixture dependency is missing: ${packageName}`);
    }
    next.dependencies[packageName] = `file:${path.resolve(packageSpec)}`;
  }
  return next;
}

function expectedPackageSource(mode, packageName) {
  return mode === 'local-artifact' && packageName === TENANCY_PACKAGE
    ? 'local-artifact'
    : 'published-lock';
}

function normalizeLockfileForArtifactComparison(lockfile, packageNames) {
  const normalized = structuredClone(lockfile);
  const root = normalized.packages?.[''];

  for (const packageName of packageNames) {
    for (const dependencyType of [
      'dependencies',
      'devDependencies',
      'optionalDependencies',
    ]) {
      if (root?.[dependencyType]) delete root[dependencyType][packageName];
    }
    if (normalized.packages) {
      delete normalized.packages[`node_modules/${packageName}`];
    }
    if (normalized.dependencies) delete normalized.dependencies[packageName];
  }

  const packageIdentity = Object.fromEntries(
    Object.entries(normalized.packages ?? {})
      .filter(([packagePath]) => packagePath !== '')
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([packagePath, entry]) => [
        packagePath,
        {
          version: entry.version,
          resolved: entry.resolved,
          integrity: entry.integrity,
          link: entry.link,
        },
      ]),
  );

  return {
    root: {
      dependencies: root?.dependencies ?? {},
      devDependencies: root?.devDependencies ?? {},
      optionalDependencies: root?.optionalDependencies ?? {},
    },
    packages: packageIdentity,
  };
}

function assertArtifactOverlayPreservesLockedGraph(
  baselineLockfile,
  overlayLockfile,
  packageNames,
) {
  const baseline = normalizeLockfileForArtifactComparison(
    baselineLockfile,
    packageNames,
  );
  const overlay = normalizeLockfileForArtifactComparison(
    overlayLockfile,
    packageNames,
  );
  if (!isDeepStrictEqual(baseline, overlay)) {
    throw new Error(
      'The explicit local artifact changed the locked transitive graph; update the committed fixture lockfile in a reviewed change instead',
    );
  }
}

function sha512Integrity(filePath) {
  return `sha512-${crypto
    .createHash('sha512')
    .update(fs.readFileSync(filePath))
    .digest('base64')}`;
}

function prepareLocalArtifact(
  fixtureDirectory,
  tenancyTarball,
  baselineLockfile,
  candidate,
  npmEnvironment,
) {
  const manifestPath = path.join(fixtureDirectory, 'package.json');
  const lockfilePath = path.join(fixtureDirectory, 'package-lock.json');
  const manifest = readJson(manifestPath);
  writeJson(
    manifestPath,
    applyPackageSpecs(manifest, { [TENANCY_PACKAGE]: tenancyTarball }),
  );

  run('npm', FIXTURE_LOCK_REFRESH_ARGS, {
    cwd: fixtureDirectory,
    env: npmEnvironment,
  });
  const overlayLockfile = readJson(lockfilePath);
  assertArtifactOverlayPreservesLockedGraph(
    baselineLockfile,
    overlayLockfile,
    [TENANCY_PACKAGE],
  );

  const lockEntry =
    overlayLockfile.packages?.[`node_modules/${TENANCY_PACKAGE}`];
  if (!lockEntry?.version || !lockEntry.resolved?.startsWith('file:')) {
    throw new Error('Local tenancy artifact is missing from package-lock.json');
  }
  if (lockEntry.version !== candidate.version) {
    throw new Error('Local tenancy artifact version does not match package-lock.json');
  }
  if (lockEntry.integrity !== candidate.integrity) {
    throw new Error('Local tenancy artifact integrity does not match package-lock.json');
  }

  return candidate;
}

function copyFixture(sourceDirectory, destinationDirectory) {
  fs.cpSync(sourceDirectory, destinationDirectory, {
    recursive: true,
    filter: (sourcePath) => {
      const relativePath = path.relative(sourceDirectory, sourcePath);
      const firstPart = relativePath.split(path.sep)[0];
      return firstPart !== 'node_modules' && firstPart !== 'generated';
    },
  });
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const workspaceDirectory = path.resolve(__dirname, '..');
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), `nestarc-ecosystem-${options.mode}-`),
  );
  const fixtureDirectory = path.join(temporaryDirectory, 'fixture');
  let exitCode = 0;
  let dockerStarted = false;

  try {
    const tenancyTarball =
      options.tenancyTarball === null
        ? null
        : validateTenancyTarball(options.tenancyTarball);
    const inspectedCandidate =
      tenancyTarball === null ? null : inspectTenancyTarball(tenancyTarball);
    const npmEnvironment = createStrictNpmEnv({
      ...process.env,
      npm_config_cache: path.join(temporaryDirectory, 'npm-cache'),
    });
    console.log(
      JSON.stringify({
        event: 'ecosystem-mode',
        mode: options.mode,
        tenancyArtifact:
          tenancyTarball === null ? 'published-lock' : path.basename(tenancyTarball),
        tenancyVersion: inspectedCandidate?.version,
        tenancyIntegrity: inspectedCandidate?.integrity,
        registry: PUBLIC_NPM_REGISTRY,
      }),
    );

    if (process.env.ECOSYSTEM_SKIP_DOCKER !== '1') {
      dockerStarted = true;
      run('docker', ['compose', 'up', '-d', '--wait', 'postgres'], {
        cwd: workspaceDirectory,
      });
    }

    copyFixture(
      path.join(workspaceDirectory, FIXTURE_DIRECTORY),
      fixtureDirectory,
    );
    const baselineLockfile = readJson(
      path.join(fixtureDirectory, 'package-lock.json'),
    );
    const candidate =
      tenancyTarball === null
        ? null
        : prepareLocalArtifact(
            fixtureDirectory,
            tenancyTarball,
            baselineLockfile,
            inspectedCandidate,
            npmEnvironment,
          );
    const validationEnv = applyDefaultEnv(
      {
        ...npmEnvironment,
        ECOSYSTEM_MODE: options.mode,
      },
    );
    deleteEnvValue(validationEnv, 'TENANCY_CANDIDATE_VERSION');
    deleteEnvValue(validationEnv, 'TENANCY_CANDIDATE_INTEGRITY');
    if (candidate !== null) {
      validationEnv.TENANCY_CANDIDATE_VERSION = candidate.version;
      validationEnv.TENANCY_CANDIDATE_INTEGRITY = candidate.integrity;
    }

    run('npm', FIXTURE_INSTALL_ARGS, {
      cwd: fixtureDirectory,
      env: validationEnv,
    });
    run(
      'npm',
      ['exec', '--', 'prisma', 'generate', '--schema', 'prisma/schema.prisma'],
      {
        cwd: fixtureDirectory,
        env: validationEnv,
      },
    );
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
    if (dockerStarted) {
      try {
        run('docker', ['compose', 'down'], { cwd: workspaceDirectory });
      } catch (error) {
        console.error(
          `Docker cleanup failed: ${error instanceof Error ? error.message : error}`,
        );
        if (exitCode === 0) exitCode = error.status || 1;
      }
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

  process.exit(exitCode);
}

if (require.main === module) main();

module.exports = {
  DEFAULT_APP_DATABASE_URL,
  DEFAULT_DATABASE_URL,
  ECOSYSTEM_PACKAGE_NAMES,
  FIXTURE_INSTALL_ARGS,
  FIXTURE_LOCK_REFRESH_ARGS,
  FIXTURE_VALIDATION_STEPS,
  PUBLIC_NPM_REGISTRY,
  applyDefaultEnv,
  applyPackageSpecs,
  assertTenancyPackageManifest,
  assertArtifactOverlayPreservesLockedGraph,
  createStrictNpmEnv,
  deleteEnvValue,
  expectedPackageSource,
  inspectTenancyTarball,
  main,
  parseArguments,
  prepareLocalArtifact,
  readPackageManifestFromTarball,
  resolveCommand,
  sha512Integrity,
  validateTenancyTarball,
};
