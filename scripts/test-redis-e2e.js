#!/usr/bin/env node
/** Runs the real BullMQ/Redis missing-context contract and always tears Redis down. */
const { execSync } = require('child_process');

const JEST_CONFIG = 'test/e2e/redis/jest.redis.config.ts';
const DEFAULT_REDIS_URL = 'redis://127.0.0.1:6380';

function applyDefaultEnv(env) {
  if (env.REDIS_URL === undefined) {
    env.REDIS_URL = DEFAULT_REDIS_URL;
  }
  return env;
}

function run(command) {
  execSync(command, { stdio: 'inherit' });
}

function main() {
  applyDefaultEnv(process.env);
  let exitCode = 0;

  try {
    run('docker compose --profile redis up -d --wait redis');
    run(`jest --config ${JEST_CONFIG} --runInBand`);
  } catch (error) {
    exitCode = error.status || 1;
  } finally {
    try {
      run('docker compose --profile redis down');
    } catch {
      // best-effort cleanup
    }
  }

  process.exit(exitCode);
}

if (require.main === module) {
  main();
}

module.exports = { DEFAULT_REDIS_URL, applyDefaultEnv, main };
