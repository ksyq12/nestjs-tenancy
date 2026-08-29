#!/usr/bin/env node
/**
 * Verifies that a GitHub release event, its tag, and the checked-out package all
 * identify the same immutable commit and package version.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const FULL_COMMIT_PATTERN = /^[0-9a-f]{40}$/;

function assertEqual(label, actual, expected) {
  if (actual !== expected) {
    throw new Error(`${label} mismatch: expected ${expected}, received ${actual}`);
  }
}

function verifyReleaseProvenance({
  packageVersion,
  releaseTag,
  releaseCommit,
  releaseTarget,
  releaseRef,
  headCommit,
  tagCommit,
}) {
  const expectedTag = `v${packageVersion}`;
  assertEqual('Release tag/package version', releaseTag, expectedTag);
  assertEqual('Release ref', releaseRef, `refs/tags/${releaseTag}`);

  if (!FULL_COMMIT_PATTERN.test(releaseCommit)) {
    throw new Error(
      `Release target commit must be a full lowercase Git SHA: ${releaseCommit}`,
    );
  }
  if (!FULL_COMMIT_PATTERN.test(releaseTarget)) {
    throw new Error(
      `GitHub Release target must be a full lowercase Git SHA: ${releaseTarget}`,
    );
  }

  assertEqual(
    'GitHub Release target/release commit',
    releaseTarget,
    releaseCommit,
  );
  assertEqual('Checked-out commit/release target', headCommit, releaseCommit);
  assertEqual('Release tag commit/release target', tagCommit, releaseCommit);
}

function gitCommit(workspaceDirectory, revision) {
  return execFileSync('git', ['rev-parse', '--verify', revision], {
    cwd: workspaceDirectory,
    encoding: 'utf8',
  }).trim();
}

function verifyCurrentRelease(
  workspaceDirectory = process.cwd(),
  environment = process.env,
) {
  const packageManifest = JSON.parse(
    fs.readFileSync(path.join(workspaceDirectory, 'package.json'), 'utf8'),
  );
  const releaseTag = environment.RELEASE_TAG ?? '';
  const releaseCommit = environment.RELEASE_COMMIT ?? '';
  const releaseTarget = environment.RELEASE_TARGET ?? '';
  const releaseRef = environment.RELEASE_REF ?? '';

  verifyReleaseProvenance({
    packageVersion: packageManifest.version,
    releaseTag,
    releaseCommit,
    releaseTarget,
    releaseRef,
    headCommit: gitCommit(workspaceDirectory, 'HEAD'),
    tagCommit: gitCommit(
      workspaceDirectory,
      `refs/tags/${releaseTag}^{commit}`,
    ),
  });

  console.log(
    `[release] verified ${releaseTag} at ${releaseCommit} for package ${packageManifest.name}`,
  );
}

if (require.main === module) {
  try {
    verifyCurrentRelease();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[release] provenance verification failed: ${message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  verifyCurrentRelease,
  verifyReleaseProvenance,
};
