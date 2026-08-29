#!/usr/bin/env node
/**
 * Packs the built package and verifies its public runtime, declaration, and CLI
 * shape from isolated consumer projects.
 */
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FIXTURE_DIRECTORY = path.join('test', 'package-consumer', 'fixture');
const INSTALL_ARGS = [
  'install',
  '--strict-peer-deps',
  '--omit=optional',
  '--no-audit',
  '--no-fund',
];
const COMMON_DEPENDENCIES = {
  '@nestjs/common': '11.2.1',
  '@nestjs/core': '11.2.1',
  '@opentelemetry/api': '1.9.1',
  '@prisma/client': '7.10.0',
  'reflect-metadata': '0.2.2',
  rxjs: '7.8.2',
};
const COMMON_DEV_DEPENDENCIES = {
  '@types/node': '22.20.1',
  typescript: '5.9.3',
};

const PACKAGE_CONSUMER_PROFILES = [
  {
    id: 'public-shape',
    fixture: 'public-shape.ts',
    dependencies: {
      ...COMMON_DEPENDENCIES,
      '@nestjs/cache-manager': '3.1.3',
      'cache-manager': '7.2.8',
      cacheable: '2.5.0',
      keyv: '5.6.0',
    },
    verifyBin: true,
    verifyCachePeersAbsent: false,
  },
  {
    id: 'root-without-cache',
    fixture: 'root-without-cache.ts',
    dependencies: { ...COMMON_DEPENDENCIES },
    verifyBin: false,
    verifyCachePeersAbsent: true,
  },
];

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    stdio: 'inherit',
    ...options,
  });
}

function packPackage(workspaceDirectory, temporaryDirectory) {
  const output = execFileSync(
    'npm',
    [
      'pack',
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      temporaryDirectory,
    ],
    {
      cwd: workspaceDirectory,
      encoding: 'utf8',
      env: {
        ...process.env,
        npm_config_cache: path.join(temporaryDirectory, 'npm-cache'),
      },
    },
  );
  const result = JSON.parse(output);
  const packResult = result[0];
  if (!packResult?.filename) {
    throw new Error('npm pack did not return a tenancy tarball filename');
  }

  console.log(
    `[package-consumer] packed ${packResult.filename} ` +
      `(${packResult.entryCount} entries, ${packResult.size} bytes)`,
  );
  return path.join(temporaryDirectory, packResult.filename);
}

function createConsumerManifest(baseManifest, profile, tarballPath) {
  return {
    ...baseManifest,
    dependencies: {
      '@nestarc/tenancy': `file:${path.resolve(tarballPath)}`,
      ...profile.dependencies,
    },
    devDependencies: { ...COMMON_DEV_DEPENDENCIES },
  };
}

function packageManifestPath(consumerDirectory, packageName) {
  return path.join(
    consumerDirectory,
    'node_modules',
    ...packageName.split('/'),
    'package.json',
  );
}

function strictInstallEnvironment(temporaryDirectory) {
  const env = { ...process.env };
  delete env.NPM_CONFIG_FORCE;
  delete env.NPM_CONFIG_LEGACY_PEER_DEPS;
  delete env.npm_config_force;
  delete env.npm_config_legacy_peer_deps;

  return {
    ...env,
    npm_config_cache: path.join(temporaryDirectory, 'npm-cache'),
    npm_config_force: 'false',
    npm_config_legacy_peer_deps: 'false',
  };
}

function normalizePackagePath(value) {
  return value.replace(/^\.\//, '');
}

function assertFile(packageDirectory, packagePath, label) {
  const normalizedPath = normalizePackagePath(packagePath);
  const absolutePath = path.join(packageDirectory, normalizedPath);
  if (!fs.statSync(absolutePath).isFile()) {
    throw new Error(`${label} target is not a file: ${normalizedPath}`);
  }
  return absolutePath;
}

function assertExportTarget(packageDirectory, exportsMap, subpath) {
  const target = exportsMap[subpath];
  if (!target || typeof target !== 'object') {
    throw new Error(`Missing package export: ${subpath}`);
  }
  if (typeof target.types !== 'string' || typeof target.default !== 'string') {
    throw new Error(`Incomplete package export: ${subpath}`);
  }
  assertFile(packageDirectory, target.types, `${subpath} types`);
  assertFile(packageDirectory, target.default, `${subpath} runtime`);
}

function assertInstalledPackageShape(consumerDirectory) {
  const manifestPath = packageManifestPath(
    consumerDirectory,
    '@nestarc/tenancy',
  );
  const packageDirectory = path.dirname(manifestPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  if (normalizePackagePath(manifest.main) !== 'dist/index.js') {
    throw new Error(`Unexpected package main: ${String(manifest.main)}`);
  }
  if (normalizePackagePath(manifest.types) !== 'dist/index.d.ts') {
    throw new Error(`Unexpected package types: ${String(manifest.types)}`);
  }

  const exportKeys = Object.keys(manifest.exports ?? {});
  if (exportKeys.join(',') !== '.,./cache,./testing') {
    throw new Error(`Unexpected package exports: ${exportKeys.join(',')}`);
  }
  for (const subpath of exportKeys) {
    assertExportTarget(packageDirectory, manifest.exports, subpath);
  }

  const binTarget = manifest.bin?.tenancy;
  if (
    typeof binTarget !== 'string' ||
    normalizePackagePath(binTarget) !== 'dist/cli/index.js'
  ) {
    throw new Error(`Unexpected tenancy bin target: ${String(binTarget)}`);
  }
  assertFile(packageDirectory, binTarget, 'tenancy bin');

  return { binTarget, packageDirectory };
}

function assertCachePeersAbsent(consumerDirectory, packageDirectory) {
  for (const packageName of ['@nestjs/cache-manager', 'cache-manager']) {
    let resolvedFromTenancy = false;
    try {
      require.resolve(packageName, { paths: [packageDirectory] });
      resolvedFromTenancy = true;
    } catch (error) {
      if (error?.code !== 'MODULE_NOT_FOUND') throw error;
    }

    if (
      fs.existsSync(packageManifestPath(consumerDirectory, packageName)) ||
      resolvedFromTenancy
    ) {
      throw new Error(
        `${packageName} must be absent from the root-without-cache consumer`,
      );
    }
  }
}

function assertCommandResult(result, expectedStatus, label) {
  if (result.error) throw result.error;
  if (result.signal) {
    throw new Error(`${label} terminated with signal ${result.signal}`);
  }
  if (result.status !== expectedStatus) {
    throw new Error(
      `${label} exited ${String(result.status)}; expected ${expectedStatus}\n` +
        `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
}

function assertPackagedBin(consumerDirectory, packageShape) {
  const binPath = path.join(consumerDirectory, 'node_modules', '.bin', 'tenancy');
  const targetPath = path.join(
    packageShape.packageDirectory,
    normalizePackagePath(packageShape.binTarget),
  );
  fs.accessSync(binPath, fs.constants.X_OK);
  fs.accessSync(targetPath, fs.constants.X_OK);

  if (fs.realpathSync(binPath) !== fs.realpathSync(targetPath)) {
    throw new Error('Installed tenancy bin link does not resolve to its target');
  }

  const source = fs.readFileSync(targetPath, 'utf8');
  if (!source.startsWith('#!/usr/bin/env node\n')) {
    throw new Error('Installed tenancy bin is missing the Node.js shebang');
  }
  if ((source.match(/^#!/gm) ?? []).length !== 1) {
    throw new Error('Installed tenancy bin must contain exactly one shebang');
  }

  const help = spawnSync(binPath, ['--help'], {
    cwd: consumerDirectory,
    encoding: 'utf8',
  });
  assertCommandResult(help, 0, 'tenancy --help');
  if (help.stderr !== '' || !help.stdout.includes('Usage: npx @nestarc/tenancy')) {
    throw new Error('tenancy --help returned unexpected output');
  }

  const invalid = spawnSync(
    binPath,
    ['doctor', '--definitely-invalid-package-smoke'],
    { cwd: consumerDirectory, encoding: 'utf8' },
  );
  assertCommandResult(invalid, 2, 'invalid tenancy doctor command');
  if (
    !invalid.stderr.includes('Doctor usage error: Unknown doctor option:') ||
    !invalid.stdout.includes('Usage: npx @nestarc/tenancy doctor')
  ) {
    throw new Error('Invalid tenancy doctor command returned unexpected output');
  }
}

function runProfile(
  workspaceDirectory,
  temporaryDirectory,
  tarballPath,
  profile,
) {
  const consumerDirectory = path.join(temporaryDirectory, profile.id);

  try {
    fs.cpSync(
      path.join(workspaceDirectory, FIXTURE_DIRECTORY),
      consumerDirectory,
      { recursive: true },
    );
    fs.copyFileSync(
      path.join(consumerDirectory, 'templates', profile.fixture),
      path.join(consumerDirectory, 'src', 'smoke.ts'),
    );

    const manifestPath = path.join(consumerDirectory, 'package.json');
    const baseManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const manifest = createConsumerManifest(
      baseManifest,
      profile,
      tarballPath,
    );
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    console.log(`[package-consumer] ${profile.id}: strict fresh install`);
    run('npm', INSTALL_ARGS, {
      cwd: consumerDirectory,
      env: strictInstallEnvironment(temporaryDirectory),
    });
    run('npm', ['ls', '--depth=0'], { cwd: consumerDirectory });

    const packageShape = assertInstalledPackageShape(consumerDirectory);
    if (profile.verifyCachePeersAbsent) {
      assertCachePeersAbsent(consumerDirectory, packageShape.packageDirectory);
    }

    run('npm', ['run', 'typecheck'], { cwd: consumerDirectory });
    run('npm', ['run', 'build'], { cwd: consumerDirectory });
    run('npm', ['run', 'smoke'], { cwd: consumerDirectory });

    if (profile.verifyBin) {
      assertPackagedBin(consumerDirectory, packageShape);
    }
  } finally {
    fs.rmSync(consumerDirectory, { recursive: true, force: true });
  }
}

function main() {
  const workspaceDirectory = path.resolve(__dirname, '..');
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'nestarc-tenancy-package-consumer-'),
  );

  try {
    const tarballPath = packPackage(workspaceDirectory, temporaryDirectory);
    for (const profile of PACKAGE_CONSUMER_PROFILES) {
      runProfile(
        workspaceDirectory,
        temporaryDirectory,
        tarballPath,
        profile,
      );
    }
    console.log('[package-consumer] all profiles passed');
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = error.status || 1;
  }
}

module.exports = {
  COMMON_DEPENDENCIES,
  COMMON_DEV_DEPENDENCIES,
  FIXTURE_DIRECTORY,
  INSTALL_ARGS,
  PACKAGE_CONSUMER_PROFILES,
  assertCachePeersAbsent,
  assertInstalledPackageShape,
  createConsumerManifest,
  main,
  normalizePackagePath,
  packPackage,
};
