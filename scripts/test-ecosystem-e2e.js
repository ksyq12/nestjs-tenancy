#!/usr/bin/env node
/**
 * Installs the built tenancy tarball into an isolated Nestarc fixture app and
 * runs the API key -> tenancy -> RBAC -> DB -> outbox -> jobs -> webhook E2E.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FIXTURE_DIRECTORY = path.join('test', 'ecosystem', 'fixture');
const LOCAL_PACKAGE_DIRECTORIES = {
  '@nestarc/api-keys': 'api-keys',
  '@nestarc/rbac': 'rbac',
  '@nestarc/jobs': 'jobs',
  '@nestarc/outbox': 'outbox',
  '@nestarc/webhook': 'webhook',
};
const DEFAULT_DATABASE_URL =
  'postgresql://tenancy:tenancy@127.0.0.1:5433/tenancy_test';
const DEFAULT_APP_DATABASE_URL =
  'postgresql://ecosystem_app:ecosystem_app@127.0.0.1:5433/tenancy_test';
const FIXTURE_INSTALL_ARGS = [
  'install',
  '--legacy-peer-deps',
  '--no-audit',
  '--no-fund',
];

function applyDefaultEnv(env) {
  if (env.DATABASE_URL === undefined) env.DATABASE_URL = DEFAULT_DATABASE_URL;
  if (env.APP_DATABASE_URL === undefined) {
    env.APP_DATABASE_URL = DEFAULT_APP_DATABASE_URL;
  }
  return env;
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    stdio: 'inherit',
    ...options,
  });
}

function packPackage(sourceDirectory, destinationDirectory) {
  const output = execFileSync(
    'npm',
    ['pack', '--ignore-scripts', '--json', '--pack-destination', destinationDirectory],
    { cwd: sourceDirectory, encoding: 'utf8' },
  );
  const result = JSON.parse(output);
  const filename = result[0]?.filename;
  if (!filename) throw new Error(`npm pack did not return a filename for ${sourceDirectory}`);
  return path.join(destinationDirectory, filename);
}

function discoverLocalPackageSources(workspaceDirectory, sourceRoot) {
  const resolvedRoot = sourceRoot
    ? path.resolve(sourceRoot)
    : path.dirname(workspaceDirectory);
  const sources = {};

  for (const [packageName, directoryName] of Object.entries(
    LOCAL_PACKAGE_DIRECTORIES,
  )) {
    const directory = path.join(resolvedRoot, directoryName);
    const manifestPath = path.join(directory, 'package.json');
    const distDirectory = path.join(directory, 'dist');
    if (!fs.existsSync(manifestPath) || !fs.existsSync(distDirectory)) continue;

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.name === packageName) sources[packageName] = directory;
  }

  return sources;
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

function main() {
  const workspaceDirectory = path.resolve(__dirname, '..');
  applyDefaultEnv(process.env);
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'nestarc-ecosystem-'),
  );
  const fixtureDirectory = path.join(temporaryDirectory, 'fixture');
  let exitCode = 0;
  let dockerStarted = false;

  try {
    if (process.env.ECOSYSTEM_SKIP_DOCKER !== '1') {
      run('docker', ['compose', 'up', '-d', '--wait', 'postgres'], {
        cwd: workspaceDirectory,
      });
      dockerStarted = true;
    }

    fs.cpSync(path.join(workspaceDirectory, FIXTURE_DIRECTORY), fixtureDirectory, {
      recursive: true,
    });

    const packageSpecs = {
      '@nestarc/tenancy': packPackage(workspaceDirectory, temporaryDirectory),
    };
    const localSources = discoverLocalPackageSources(
      workspaceDirectory,
      process.env.NESTARC_ECOSYSTEM_SOURCE_ROOT,
    );
    for (const [packageName, sourceDirectory] of Object.entries(localSources)) {
      packageSpecs[packageName] = packPackage(sourceDirectory, temporaryDirectory);
    }

    const manifestPath = path.join(fixtureDirectory, 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    fs.writeFileSync(
      manifestPath,
      `${JSON.stringify(applyPackageSpecs(manifest, packageSpecs), null, 2)}\n`,
    );

    // api-keys@0.3.0 still declares its optional Prisma peer as ^5 while the
    // rest of this graph intersects on Prisma 6. Keep this explicit until that
    // package widens its metadata; the E2E verifies the runtime graph itself.
    run('npm', FIXTURE_INSTALL_ARGS, { cwd: fixtureDirectory });
    run('npx', ['prisma', 'generate', '--schema', 'prisma/schema.prisma'], {
      cwd: fixtureDirectory,
      env: process.env,
    });
    run('npx', ['jest', '--runInBand'], {
      cwd: fixtureDirectory,
      env: process.env,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    exitCode = error.status || 1;
  } finally {
    if (dockerStarted) {
      try {
        run('docker', ['compose', 'down'], { cwd: workspaceDirectory });
      } catch {
        // best-effort cleanup
      }
    }
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }

  process.exit(exitCode);
}

if (require.main === module) main();

module.exports = {
  DEFAULT_APP_DATABASE_URL,
  DEFAULT_DATABASE_URL,
  FIXTURE_INSTALL_ARGS,
  LOCAL_PACKAGE_DIRECTORIES,
  applyDefaultEnv,
  applyPackageSpecs,
  discoverLocalPackageSources,
  main,
};
