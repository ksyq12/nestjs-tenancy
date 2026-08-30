'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const fixtureRoot = path.resolve(__dirname, '..');
const manifest = readJson(path.join(fixtureRoot, 'package.json'));
const lockfile = readJson(path.join(fixtureRoot, 'package-lock.json'));
const mode = process.env.ECOSYSTEM_MODE;
const candidateVersion = process.env.TENANCY_CANDIDATE_VERSION;
const candidateIntegrity = process.env.TENANCY_CANDIDATE_INTEGRITY;
const tenancyPackage = '@nestarc/tenancy';
const packageNames = [
  tenancyPackage,
  '@nestarc/api-keys',
  '@nestarc/rbac',
  '@nestarc/jobs',
  '@nestarc/outbox',
  '@nestarc/webhook',
];
const realNodeModulesPath = fs.realpathSync(
  path.join(fixtureRoot, 'node_modules'),
);

assert.match(
  mode ?? '',
  /^(published-only|local-artifact)$/,
  'ECOSYSTEM_MODE must select an explicit supported mode',
);
if (mode === 'local-artifact') {
  assert.match(
    candidateVersion ?? '',
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
    'TENANCY_CANDIDATE_VERSION must identify the explicit tenancy artifact',
  );
  assert.match(
    candidateIntegrity ?? '',
    /^sha512-/,
    'TENANCY_CANDIDATE_INTEGRITY must identify the explicit tenancy artifact',
  );
} else {
  assert.equal(candidateVersion, undefined);
  assert.equal(candidateIntegrity, undefined);
}

for (const packageName of packageNames) {
  const requested = manifest.dependencies[packageName];
  const lockEntry = lockfile.packages[`node_modules/${packageName}`];
  const installedPath = path.join(
    fixtureRoot,
    'node_modules',
    ...packageName.split('/'),
  );
  const installed = readJson(path.join(installedPath, 'package.json'));
  const realInstalledPath = fs.realpathSync(installedPath);
  const relativeInstalledPath = path.relative(
    realNodeModulesPath,
    realInstalledPath,
  );
  const isCandidate =
    mode === 'local-artifact' && packageName === tenancyPackage;
  const expectedVersion = isCandidate ? candidateVersion : requested;
  const source = isCandidate ? 'local-artifact' : 'published-lock';

  assert.ok(lockEntry, `${packageName} must be present in package-lock.json`);
  if (isCandidate) {
    assert.match(
      requested,
      /^file:/,
      'The tenancy candidate must use an explicit packed tarball',
    );
    assert.equal(lockEntry.version, candidateVersion);
    assert.match(lockEntry.resolved ?? '', /^file:/);
    assert.equal(lockEntry.integrity, candidateIntegrity);
  } else {
    assert.match(
      requested,
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
      `${packageName} must use an exact published version`,
    );
    assert.equal(lockEntry.version, requested);
    assert.match(
      lockEntry.resolved ?? '',
      /^https:\/\/registry\.npmjs\.org\//,
      `${packageName} must resolve from the public npm registry`,
    );
    assert.match(
      lockEntry.integrity ?? '',
      /^sha512-/,
      `${packageName} must have lockfile integrity`,
    );
  }

  assert.notEqual(lockEntry.link, true, `${packageName} must not be linked`);
  assert.equal(fs.lstatSync(installedPath).isSymbolicLink(), false);
  assert.ok(
    relativeInstalledPath !== '' &&
      relativeInstalledPath !== '..' &&
      !relativeInstalledPath.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relativeInstalledPath),
    `${packageName} must resolve inside the isolated fixture`,
  );
  assert.equal(installed.name, packageName);
  assert.equal(installed.version, expectedVersion);

  console.log(
    JSON.stringify({
      mode,
      package: packageName,
      requested,
      installed: installed.version,
      source,
      resolved: lockEntry.resolved,
      integrity: lockEntry.integrity,
    }),
  );
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}
