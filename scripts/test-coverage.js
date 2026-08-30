#!/usr/bin/env node
/** Runs Jest coverage and independently enforces the documented aggregate floor. */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const AGGREGATE_THRESHOLDS = {
  statements: 98,
  branches: 95,
  functions: 100,
  lines: 98,
};

function coverageDirectoryFromArgs(args, workspaceDirectory = process.cwd()) {
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument.startsWith('--coverageDirectory=')) {
      return path.resolve(workspaceDirectory, argument.slice('--coverageDirectory='.length));
    }
    if (argument === '--coverageDirectory' && args[index + 1]) {
      return path.resolve(workspaceDirectory, args[index + 1]);
    }
  }
  return path.resolve(workspaceDirectory, 'coverage');
}

function validateAggregateCoverage(total, thresholds = AGGREGATE_THRESHOLDS) {
  const failures = [];
  for (const [metric, threshold] of Object.entries(thresholds)) {
    const percentage = total?.[metric]?.pct;
    if (typeof percentage !== 'number' || percentage < threshold) {
      failures.push(`${metric}: expected >= ${threshold}%, received ${String(percentage)}%`);
    }
  }
  return failures;
}

function main(args = process.argv.slice(2), workspaceDirectory = process.cwd()) {
  const coverageDirectory = coverageDirectoryFromArgs(args, workspaceDirectory);
  const jestEntry = require.resolve('jest/bin/jest');
  const result = spawnSync(process.execPath, [
    jestEntry,
    '--coverage',
    '--coverageReporters=json-summary',
    '--coverageReporters=lcov',
    '--coverageReporters=text',
    ...args,
  ], {
    cwd: workspaceDirectory,
    env: process.env,
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) return result.status ?? 1;

  const summaryPath = path.join(coverageDirectory, 'coverage-summary.json');
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  const failures = validateAggregateCoverage(summary.total);
  if (failures.length > 0) {
    console.error(`Aggregate coverage threshold failed:\n${failures.join('\n')}`);
    return 1;
  }

  const metrics = Object.keys(AGGREGATE_THRESHOLDS)
    .map((metric) => `${metric}=${summary.total[metric].pct}%`)
    .join(' ');
  console.log(`[coverage] aggregate floor verified: ${metrics}`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

module.exports = {
  AGGREGATE_THRESHOLDS,
  coverageDirectoryFromArgs,
  main,
  validateAggregateCoverage,
};
