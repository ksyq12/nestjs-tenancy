#!/usr/bin/env node
/**
 * Packs the built tenancy package and verifies its supported NestJS/Prisma
 * peer cross-product from isolated, strict-install consumer projects.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const FIXTURE_DIRECTORY = path.join('test', 'compat', 'fixture');
const INSTALL_ARGS = [
  'install',
  '--strict-peer-deps',
  '--no-audit',
  '--no-fund',
];
const COMMON_DEPENDENCIES = {
  '@opentelemetry/api': '1.9.1',
  rxjs: '7.8.2',
};
const COMMON_DEV_DEPENDENCIES = {
  '@types/node': '22.20.1',
  typescript: '5.9.3',
};

const COMPATIBILITY_LANES = [
  {
    id: 'nest10-prisma6',
    nestMajor: 10,
    nestVersion: '10.4.22',
    prismaMajor: 6,
    prismaVersion: '6.19.3',
    reflectMetadataVersion: '0.1.13',
    optionalPeerProfile: 'minimum',
    optionalPeers: {
      '@nestjs/cache-manager': '2.0.0',
      '@nestjs/event-emitter': '2.0.0',
      'cache-manager': '5.0.0',
    },
    supportingDependencies: {},
  },
  {
    id: 'nest10-prisma7',
    nestMajor: 10,
    nestVersion: '10.4.22',
    prismaMajor: 7,
    prismaVersion: '7.10.0',
    reflectMetadataVersion: '0.2.2',
    optionalPeerProfile: 'none',
    optionalPeers: {},
    supportingDependencies: {},
  },
  {
    id: 'nest11-prisma6',
    nestMajor: 11,
    nestVersion: '11.2.1',
    prismaMajor: 6,
    prismaVersion: '6.19.3',
    reflectMetadataVersion: '0.2.2',
    optionalPeerProfile: 'none',
    optionalPeers: {},
    supportingDependencies: {},
  },
  {
    id: 'nest11-prisma7',
    nestMajor: 11,
    nestVersion: '11.2.1',
    prismaMajor: 7,
    prismaVersion: '7.10.0',
    reflectMetadataVersion: '0.2.2',
    optionalPeerProfile: 'current',
    optionalPeers: {
      '@nestjs/cache-manager': '3.1.3',
      '@nestjs/event-emitter': '3.1.0',
      'cache-manager': '7.2.8',
    },
    supportingDependencies: {
      cacheable: '2.5.0',
      keyv: '5.6.0',
    },
  },
];

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    stdio: 'inherit',
    ...options,
  });
}

function packPackage(workspaceDirectory, destinationDirectory) {
  const output = execFileSync(
    'npm',
    [
      'pack',
      '--ignore-scripts',
      '--json',
      '--pack-destination',
      destinationDirectory,
    ],
    {
      cwd: workspaceDirectory,
      encoding: 'utf8',
      env: {
        ...process.env,
        npm_config_cache: path.join(destinationDirectory, 'npm-cache'),
      },
    },
  );
  const result = JSON.parse(output);
  const filename = result[0]?.filename;
  if (!filename) {
    throw new Error('npm pack did not return a tenancy tarball filename');
  }
  return path.join(destinationDirectory, filename);
}

function createConsumerManifest(baseManifest, lane, tarballPath) {
  return {
    ...baseManifest,
    dependencies: {
      '@nestarc/tenancy': `file:${path.resolve(tarballPath)}`,
      '@nestjs/common': lane.nestVersion,
      '@nestjs/core': lane.nestVersion,
      '@nestjs/testing': lane.nestVersion,
      '@prisma/client': lane.prismaVersion,
      ...COMMON_DEPENDENCIES,
      'reflect-metadata': lane.reflectMetadataVersion,
      ...lane.optionalPeers,
      ...lane.supportingDependencies,
    },
    devDependencies: { ...COMMON_DEV_DEPENDENCIES },
  };
}

function selectCompatibilityLanes(args) {
  if (args.length === 0) return COMPATIBILITY_LANES;

  let requestedLane;
  if (args.length === 2 && args[0] === '--lane') {
    requestedLane = args[1];
  } else if (args.length === 1 && args[0].startsWith('--lane=')) {
    requestedLane = args[0].slice('--lane='.length);
  } else {
    throw new Error('Usage: test-peer-compat.js [--lane <lane-id>]');
  }

  const lane = COMPATIBILITY_LANES.find(
    (candidate) => candidate.id === requestedLane,
  );
  if (!lane) {
    throw new Error(
      `Unknown compatibility lane "${requestedLane}". Expected one of: ` +
        COMPATIBILITY_LANES.map(({ id }) => id).join(', '),
    );
  }
  return [lane];
}

function packageManifestPath(consumerDirectory, packageName) {
  return path.join(
    consumerDirectory,
    'node_modules',
    ...packageName.split('/'),
    'package.json',
  );
}

function assertInstalledVersions(consumerDirectory, lane) {
  const expectedVersions = {
    '@nestjs/common': lane.nestVersion,
    '@nestjs/core': lane.nestVersion,
    '@nestjs/testing': lane.nestVersion,
    '@prisma/client': lane.prismaVersion,
    'reflect-metadata': lane.reflectMetadataVersion,
    ...COMMON_DEPENDENCIES,
    ...lane.optionalPeers,
    ...lane.supportingDependencies,
  };

  for (const [packageName, expectedVersion] of Object.entries(
    expectedVersions,
  )) {
    const manifestPath = packageManifestPath(consumerDirectory, packageName);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    if (manifest.version !== expectedVersion) {
      throw new Error(
        `${lane.id} installed ${packageName}@${manifest.version}; expected ${expectedVersion}`,
      );
    }
  }
}

function strictInstallEnvironment(temporaryDirectory) {
  const env = { ...process.env };
  delete env.NPM_CONFIG_FORCE;
  delete env.NPM_CONFIG_LEGACY_PEER_DEPS;

  return {
    ...env,
    npm_config_cache: path.join(temporaryDirectory, 'npm-cache'),
    npm_config_force: 'false',
    npm_config_legacy_peer_deps: 'false',
  };
}

function runLane(workspaceDirectory, temporaryDirectory, tarballPath, lane) {
  const consumerDirectory = path.join(temporaryDirectory, lane.id);

  try {
    fs.cpSync(
      path.join(workspaceDirectory, FIXTURE_DIRECTORY),
      consumerDirectory,
      { recursive: true },
    );
    const optionalRuntimeTemplate =
      lane.optionalPeerProfile === 'none'
        ? 'optional-runtime-none.ts'
        : 'optional-runtime-peers.ts';
    fs.copyFileSync(
      path.join(consumerDirectory, 'templates', optionalRuntimeTemplate),
      path.join(consumerDirectory, 'src', 'optional-runtime.ts'),
    );

    const manifestPath = path.join(consumerDirectory, 'package.json');
    const baseManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const manifest = createConsumerManifest(baseManifest, lane, tarballPath);
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

    console.log(
      `[peer-compat] ${lane.id}: Nest ${lane.nestVersion}, Prisma ${lane.prismaVersion}, ` +
        `optional peers ${lane.optionalPeerProfile}`,
    );

    run('npm', INSTALL_ARGS, {
      cwd: consumerDirectory,
      env: strictInstallEnvironment(temporaryDirectory),
    });
    assertInstalledVersions(consumerDirectory, lane);
    run('npm', ['ls', '--depth=0'], { cwd: consumerDirectory });
    run('npm', ['run', 'typecheck'], { cwd: consumerDirectory });
    run('npm', ['run', 'build'], { cwd: consumerDirectory });
    run('npm', ['run', 'smoke'], {
      cwd: consumerDirectory,
      env: {
        ...process.env,
        TENANCY_COMPAT_NEST_MAJOR: String(lane.nestMajor),
        TENANCY_COMPAT_OPTIONAL_PEERS: lane.optionalPeerProfile,
      },
    });
  } finally {
    fs.rmSync(consumerDirectory, { recursive: true, force: true });
  }
}

function main(args = process.argv.slice(2)) {
  const workspaceDirectory = path.resolve(__dirname, '..');
  const lanes = selectCompatibilityLanes(args);
  const temporaryDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'nestarc-tenancy-peer-compat-'),
  );

  try {
    const tarballPath = packPackage(workspaceDirectory, temporaryDirectory);
    for (const lane of lanes) {
      runLane(workspaceDirectory, temporaryDirectory, tarballPath, lane);
    }
    console.log(
      `[peer-compat] ${lanes.map(({ id }) => id).join(', ')} passed`,
    );
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
  COMPATIBILITY_LANES,
  FIXTURE_DIRECTORY,
  INSTALL_ARGS,
  assertInstalledVersions,
  createConsumerManifest,
  main,
  packPackage,
  selectCompatibilityLanes,
};
