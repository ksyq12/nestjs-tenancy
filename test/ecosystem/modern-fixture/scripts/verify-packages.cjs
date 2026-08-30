'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const publicRegistryPattern = /^https:\/\/registry\.npmjs\.org\//;
const exactVersionPattern =
  /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const sha512IntegrityPattern = /^sha512-[A-Za-z0-9+/]{86}==$/;
const expectedVersions = {
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
const expectedNestarcIntegrities = {
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
const canonicalPackageNames = Object.keys(expectedVersions);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function assertPackageNameSegment(segment, packagePath, kind) {
  const unscopedSegment = kind === 'scope' ? segment.slice(1) : segment;
  if (
    !unscopedSegment ||
    unscopedSegment.startsWith('.') ||
    unscopedSegment.includes('\\')
  ) {
    throw new Error(`Invalid ${kind} in package-lock path: ${packagePath}`);
  }
}

function isCanonicalSha512Integrity(integrity) {
  if (!sha512IntegrityPattern.test(integrity)) return false;
  const encodedDigest = integrity.slice('sha512-'.length);
  const decodedDigest = Buffer.from(encodedDigest, 'base64');
  return (
    decodedDigest.length === 64 &&
    decodedDigest.toString('base64') === encodedDigest
  );
}

function lockPackageName(packagePath) {
  const parts = packagePath.split('/');
  let packageName;
  let index = 0;
  while (index < parts.length) {
    if (parts[index] !== 'node_modules') {
      throw new Error(`Invalid package-lock path: ${packagePath}`);
    }
    index += 1;
    const first = parts[index];
    if (!first || first === '.' || first === '..') {
      throw new Error(`Invalid package-lock path: ${packagePath}`);
    }
    index += 1;
    if (first.startsWith('@')) {
      assertPackageNameSegment(first, packagePath, 'scope');
      const second = parts[index];
      if (!second || second === '.' || second === '..') {
        throw new Error(`Invalid scoped package-lock path: ${packagePath}`);
      }
      assertPackageNameSegment(second, packagePath, 'package name');
      index += 1;
      packageName = `${first}/${second}`;
    } else {
      assertPackageNameSegment(first, packagePath, 'package name');
      packageName = first;
    }
  }
  return packageName;
}

function isCriticalPackageName(packageName) {
  return canonicalPackageNames.includes(packageName);
}

function validateLockfileProvenance(manifest, lockfile) {
  assert.equal(lockfile.lockfileVersion, 3, 'modern lockfileVersion must be 3');
  const root = lockfile.packages?.[''];
  assert.ok(root, 'package-lock.json must contain its root package entry');
  assert.deepEqual(root.dependencies ?? {}, manifest.dependencies ?? {});
  assert.deepEqual(root.devDependencies ?? {}, manifest.devDependencies ?? {});

  const directDependencies = {
    ...manifest.dependencies,
    ...manifest.devDependencies,
  };
  const lockEntries = Object.entries(lockfile.packages).filter(
    ([packagePath]) => packagePath !== '',
  );
  const packageOccurrences = new Map();

  for (const [packagePath, lockEntry] of lockEntries) {
    assert.ok(
      packagePath.startsWith('node_modules/') ||
        packagePath.includes('/node_modules/'),
      `Unexpected package-lock path: ${packagePath}`,
    );
    assert.equal(path.posix.normalize(packagePath), packagePath);
    assert.match(
      lockEntry.version ?? '',
      exactVersionPattern,
      `${packagePath} must use an exact version`,
    );
    assert.match(
      lockEntry.resolved ?? '',
      publicRegistryPattern,
      `${packagePath} must resolve from the public npm registry`,
    );
    assert.ok(
      isCanonicalSha512Integrity(lockEntry.integrity ?? ''),
      `${packagePath} must have SHA-512 integrity`,
    );
    assert.notEqual(lockEntry.link, true, `${packagePath} must not be linked`);

    const packageName = lockPackageName(packagePath);
    const nestedNodeModulesIndex = packagePath.lastIndexOf('/node_modules/');
    if (nestedNodeModulesIndex !== -1) {
      const parentPackagePath = packagePath.slice(0, nestedNodeModulesIndex);
      assert.ok(
        lockfile.packages[parentPackagePath],
        `${packagePath} must have a package-lock parent entry`,
      );
    }
    const occurrences = packageOccurrences.get(packageName) ?? [];
    occurrences.push(packagePath);
    packageOccurrences.set(packageName, occurrences);
  }

  for (const [packageName, requested] of Object.entries(directDependencies)) {
    assert.match(
      requested,
      exactVersionPattern,
      `${packageName} must use an exact version`,
    );
    const lockEntry = lockfile.packages[`node_modules/${packageName}`];
    assert.ok(lockEntry, `${packageName} must be present at the lock root`);
    assert.equal(lockEntry.version, requested);
  }
  for (const [packageName, expectedVersion] of Object.entries(expectedVersions)) {
    assert.equal(
      directDependencies[packageName],
      expectedVersion,
      `${packageName} exact tuple drifted`,
    );
  }
  for (const [packageName, packagePaths] of packageOccurrences) {
    if (!isCriticalPackageName(packageName)) continue;
    assert.deepEqual(
      packagePaths,
      [`node_modules/${packageName}`],
      `${packageName} must have one canonical lock entry at the root`,
    );
  }
  for (const [packageName, expectedIntegrity] of Object.entries(
    expectedNestarcIntegrities,
  )) {
    assert.equal(
      lockfile.packages[`node_modules/${packageName}`].integrity,
      expectedIntegrity,
      `${packageName} published integrity drifted`,
    );
  }

  return { directDependencies, lockEntries };
}

function assertContained(realRoot, candidatePath, message) {
  const relative = path.relative(realRoot, candidatePath);
  assert.ok(
    relative !== '' &&
      relative !== '..' &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative),
    message,
  );
}

function collectInstalledPackagePaths(nodeModulesPath, fixtureRoot) {
  const installed = [];

  function scan(currentNodeModulesPath) {
    if (!fs.existsSync(currentNodeModulesPath)) return;
    assert.equal(
      fs.lstatSync(currentNodeModulesPath).isSymbolicLink(),
      false,
      `${path.relative(fixtureRoot, currentNodeModulesPath)} must not be a symlink`,
    );
    for (const entry of fs.readdirSync(currentNodeModulesPath, {
      withFileTypes: true,
    })) {
      const entryPath = path.join(currentNodeModulesPath, entry.name);
      assert.equal(
        fs.lstatSync(entryPath).isSymbolicLink(),
        false,
        `${path.relative(fixtureRoot, entryPath)} must not be a symlink`,
      );
      if (entry.name === '.bin') {
        assert.ok(entry.isDirectory(), `${entryPath} must be a directory`);
        continue;
      }
      if (entry.name === '.package-lock.json') {
        assert.ok(entry.isFile(), `${entryPath} must be a regular file`);
        continue;
      }
      assert.equal(
        entry.name.startsWith('.'),
        false,
        `${entryPath} is an unexpected hidden node_modules entry`,
      );
      if (entry.name.startsWith('@')) {
        assert.ok(entry.isDirectory(), `${entry.name} must be a scope directory`);
        for (const scopedEntry of fs.readdirSync(entryPath, {
          withFileTypes: true,
        })) {
          const packagePath = path.join(entryPath, scopedEntry.name);
          assert.equal(
            scopedEntry.name.startsWith('.'),
            false,
            `${packagePath} is an unexpected hidden scoped package`,
          );
          assert.equal(
            fs.lstatSync(packagePath).isSymbolicLink(),
            false,
            `${path.relative(fixtureRoot, packagePath)} must not be a symlink`,
          );
          assert.ok(scopedEntry.isDirectory(), `${packagePath} must be a directory`);
          installed.push(packagePath);
          scan(path.join(packagePath, 'node_modules'));
        }
      } else {
        assert.ok(entry.isDirectory(), `${entryPath} must be a package directory`);
        installed.push(entryPath);
        scan(path.join(entryPath, 'node_modules'));
      }
    }
  }

  scan(nodeModulesPath);
  return installed;
}

function validateInstalledGraph(fixtureRoot, lockfile, directDependencies) {
  const realFixtureRoot = fs.realpathSync(fixtureRoot);
  const nodeModulesPath = path.join(fixtureRoot, 'node_modules');
  assert.equal(
    fs.lstatSync(nodeModulesPath).isSymbolicLink(),
    false,
    'node_modules must not be a symlink',
  );
  const realNodeModulesPath = fs.realpathSync(nodeModulesPath);
  assert.equal(
    realNodeModulesPath,
    path.join(realFixtureRoot, 'node_modules'),
    'node_modules must belong to the isolated fixture',
  );

  const installedPackagePaths = collectInstalledPackagePaths(
    nodeModulesPath,
    fixtureRoot,
  );
  for (const installedPath of installedPackagePaths) {
    const lockPath = path
      .relative(fixtureRoot, installedPath)
      .split(path.sep)
      .join('/');
    const lockEntry = lockfile.packages[lockPath];
    assert.ok(lockEntry, `${lockPath} is installed but absent from package-lock.json`);
    const realInstalledPath = fs.realpathSync(installedPath);
    assertContained(
      realNodeModulesPath,
      realInstalledPath,
      `${lockPath} must resolve inside the isolated fixture`,
    );
    const manifestPath = path.join(installedPath, 'package.json');
    const manifestStat = fs.lstatSync(manifestPath);
    assert.equal(
      manifestStat.isSymbolicLink(),
      false,
      `${lockPath}/package.json must not be a symlink`,
    );
    assert.equal(
      manifestStat.isFile(),
      true,
      `${lockPath}/package.json must be a regular file`,
    );
    assertContained(
      realNodeModulesPath,
      fs.realpathSync(manifestPath),
      `${lockPath}/package.json must resolve inside the isolated fixture`,
    );
    const installedManifest = readJson(manifestPath);
    assert.equal(installedManifest.name, lockPackageName(lockPath));
    assert.equal(installedManifest.version, lockEntry.version);
  }

  for (const [packageName, requested] of Object.entries(directDependencies)) {
    const installedPath = path.join(
      nodeModulesPath,
      ...packageName.split('/'),
    );
    const installedManifest = readJson(path.join(installedPath, 'package.json'));
    assert.equal(installedManifest.name, packageName);
    assert.equal(installedManifest.version, requested);
  }
}

function main() {
  const fixtureRoot = path.resolve(__dirname, '..');
  const manifest = readJson(path.join(fixtureRoot, 'package.json'));
  const lockfile = readJson(path.join(fixtureRoot, 'package-lock.json'));

  assert.equal(process.env.ECOSYSTEM_MODE, 'modern-published-only');
  assert.equal(process.env.TENANCY_CANDIDATE_VERSION, undefined);
  assert.equal(process.env.TENANCY_CANDIDATE_INTEGRITY, undefined);

  const { directDependencies } = validateLockfileProvenance(manifest, lockfile);
  validateInstalledGraph(fixtureRoot, lockfile, directDependencies);

  for (const [packageName, requested] of Object.entries(directDependencies)) {
    const lockEntry = lockfile.packages[`node_modules/${packageName}`];
    console.log(
      JSON.stringify({
        mode: 'modern-published-only',
        package: packageName,
        requested,
        installed: requested,
        source: 'published-lock',
        resolved: lockEntry.resolved,
        integrity: lockEntry.integrity,
      }),
    );
  }
}

if (require.main === module) main();

module.exports = {
  canonicalPackageNames,
  collectInstalledPackagePaths,
  expectedNestarcIntegrities,
  expectedVersions,
  isCriticalPackageName,
  isCanonicalSha512Integrity,
  lockPackageName,
  main,
  validateInstalledGraph,
  validateLockfileProvenance,
};
