#!/usr/bin/env node
/**
 * Cross-platform PgBouncer E2E test runner.
 *
 * Orchestrates: PgBouncer compose profile up → prisma generate → jest →
 * compose down. Setup and teardown use direct PostgreSQL while application
 * traffic goes through the dedicated PgBouncer lanes.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCHEMA = 'test/e2e/schema.prisma';
const PRISMA_6_ADAPTER_SCHEMA = 'test/e2e/schema.prisma6-adapter.prisma';
const PRISMA_6_NATIVE_SCHEMA = 'test/e2e/schema.prisma6-native.prisma';
const JEST_CONFIG = 'test/e2e/pgbouncer/jest.pgbouncer.config.ts';
const COMPOSE_PROFILE = 'pgbouncer';
const DEFAULT_DATABASE_URL =
  'postgresql://tenancy:tenancy@localhost:5433/tenancy_test';
const DEFAULT_APP_DATABASE_URL =
  'postgresql://app_user:app_user@localhost:6432/tenancy_test';
const DEFAULT_PGBOUNCER_ADMIN_URL =
  'postgresql://tenancy:tenancy@localhost:6432/pgbouncer';
const DEFAULT_PGBOUNCER_SESSION_DATABASE_URL =
  'postgresql://app_user:app_user@localhost:6433/tenancy_test';
const DEFAULT_PGBOUNCER_SESSION_ADMIN_URL =
  'postgresql://tenancy:tenancy@localhost:6433/pgbouncer';
const DEFAULT_PARALLEL_APP_DATABASE_URL =
  'postgresql://app_user:app_user@localhost:6434/tenancy_test';
const DEFAULT_PARALLEL_PGBOUNCER_ADMIN_URL =
  'postgresql://tenancy:tenancy@localhost:6434/pgbouncer';

function applyDefaultEnv(env) {
  if (env.DATABASE_URL === undefined) {
    env.DATABASE_URL = DEFAULT_DATABASE_URL;
  }
  if (env.APP_DATABASE_URL === undefined) {
    env.APP_DATABASE_URL = DEFAULT_APP_DATABASE_URL;
  }
  if (env.PGBOUNCER_ADMIN_URL === undefined) {
    env.PGBOUNCER_ADMIN_URL = DEFAULT_PGBOUNCER_ADMIN_URL;
  }
  if (env.PGBOUNCER_SESSION_DATABASE_URL === undefined) {
    env.PGBOUNCER_SESSION_DATABASE_URL =
      DEFAULT_PGBOUNCER_SESSION_DATABASE_URL;
  }
  if (env.PGBOUNCER_SESSION_ADMIN_URL === undefined) {
    env.PGBOUNCER_SESSION_ADMIN_URL = DEFAULT_PGBOUNCER_SESSION_ADMIN_URL;
  }
  if (env.PARALLEL_APP_DATABASE_URL === undefined) {
    env.PARALLEL_APP_DATABASE_URL = DEFAULT_PARALLEL_APP_DATABASE_URL;
  }
  if (env.PARALLEL_PGBOUNCER_ADMIN_URL === undefined) {
    env.PARALLEL_PGBOUNCER_ADMIN_URL =
      DEFAULT_PARALLEL_PGBOUNCER_ADMIN_URL;
  }
  return env;
}

function readInstalledPackageVersion(packageName) {
  let entryPath;
  try {
    entryPath = require.resolve(`${packageName}/package.json`);
  } catch {
    entryPath = require.resolve(packageName);
  }
  let directory = path.dirname(entryPath);

  while (true) {
    const manifestPath = path.join(directory, 'package.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (manifest.name === packageName && typeof manifest.version === 'string') {
        return manifest.version;
      }
    }

    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  throw new Error(`Unable to resolve the installed ${packageName} version`);
}

function validatePrismaRuntimeVersions(versions) {
  const entries = Object.entries(versions);
  const runtimeVersions = entries.map(([, version]) => version);
  const majors = runtimeVersions.map((version) =>
    Number.parseInt(version.split('.')[0], 10),
  );
  const supported = majors.every((major) => major === 6 || major === 7);
  const aligned = new Set(runtimeVersions).size === 1;

  if (!supported || !aligned) {
    const details = entries
      .map(([name, version]) => `${name}=${version}`)
      .join(', ');
    throw new Error(
      `PgBouncer E2E requires identical Prisma 6 or 7 runtime versions; found ${details}`,
    );
  }

  return majors[0];
}

function getInstalledPrismaMajor() {
  return validatePrismaRuntimeVersions({
    prisma: readInstalledPackageVersion('prisma'),
    client: readInstalledPackageVersion('@prisma/client'),
    adapterPg: readInstalledPackageVersion('@prisma/adapter-pg'),
  });
}

function run(cmd) {
  execSync(cmd, { stdio: 'inherit' });
}

function main() {
  applyDefaultEnv(process.env);

  let exitCode = 0;
  let composeAttempted = false;

  try {
    const prismaMajor = getInstalledPrismaMajor();
    composeAttempted = true;
    run(`docker compose --profile ${COMPOSE_PROFILE} up -d --wait`);
    const adapterSchema =
      prismaMajor === 6 ? PRISMA_6_ADAPTER_SCHEMA : SCHEMA;
    run(`prisma generate --schema=${adapterSchema}`);
    if (prismaMajor === 6) {
      run(`prisma generate --schema=${PRISMA_6_NATIVE_SCHEMA}`);
    }
    run(`jest --config ${JEST_CONFIG} --runInBand`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    exitCode = error.status || 1;
  } finally {
    if (composeAttempted) {
      try {
        run(`docker compose --profile ${COMPOSE_PROFILE} down`);
      } catch {
        // best-effort cleanup
      }
    }
  }

  process.exit(exitCode);
}

if (require.main === module) {
  main();
}

module.exports = {
  DEFAULT_APP_DATABASE_URL,
  DEFAULT_DATABASE_URL,
  DEFAULT_PARALLEL_APP_DATABASE_URL,
  DEFAULT_PARALLEL_PGBOUNCER_ADMIN_URL,
  DEFAULT_PGBOUNCER_ADMIN_URL,
  DEFAULT_PGBOUNCER_SESSION_ADMIN_URL,
  DEFAULT_PGBOUNCER_SESSION_DATABASE_URL,
  PRISMA_6_ADAPTER_SCHEMA,
  PRISMA_6_NATIVE_SCHEMA,
  SCHEMA,
  applyDefaultEnv,
  getInstalledPrismaMajor,
  main,
  validatePrismaRuntimeVersions,
};
