import fs from 'fs';
import os from 'os';
import path from 'path';
import zlib from 'zlib';

const {
  DEFAULT_APP_DATABASE_URL,
  DEFAULT_DATABASE_URL,
  ECOSYSTEM_PACKAGE_NAMES,
  FIXTURE_INSTALL_ARGS,
  FIXTURE_LOCK_REFRESH_ARGS,
  FIXTURE_VALIDATION_STEPS,
  PUBLIC_NPM_REGISTRY,
  assertArtifactOverlayPreservesLockedGraph,
  applyDefaultEnv,
  applyPackageSpecs,
  assertTenancyPackageManifest,
  createStrictNpmEnv,
  deleteEnvValue,
  expectedPackageSource,
  parseArguments,
  readPackageManifestFromTarball,
  resolveCommand,
} = require('../../scripts/test-ecosystem-e2e');

function createTarEntry(name: string, value: unknown): Buffer {
  const body = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write(
    `${body.length.toString(8).padStart(11, '0')}\0`,
    124,
    12,
    'ascii',
  );
  header[156] = '0'.charCodeAt(0);
  const padding = Buffer.alloc((512 - (body.length % 512)) % 512);
  return Buffer.concat([header, body, padding]);
}

describe('ecosystem E2E runner', () => {
  it('sets deterministic database defaults and preserves overrides', () => {
    const defaults: Record<string, string | undefined> = {};
    applyDefaultEnv(defaults);
    expect(defaults).toEqual({
      DATABASE_URL: DEFAULT_DATABASE_URL,
      APP_DATABASE_URL: DEFAULT_APP_DATABASE_URL,
    });

    const custom = {
      DATABASE_URL: 'postgresql://owner/custom',
      APP_DATABASE_URL: 'postgresql://app/custom',
    };
    expect(applyDefaultEnv(custom)).toEqual(custom);

    const mixedCase = {
      database_url: 'postgresql://owner/windows-style',
      App_Database_Url: 'postgresql://app/windows-style',
      tenancy_candidate_version: 'stale',
    };
    applyDefaultEnv(mixedCase);
    deleteEnvValue(mixedCase, 'TENANCY_CANDIDATE_VERSION');
    expect(mixedCase).toEqual({
      DATABASE_URL: 'postgresql://owner/windows-style',
      APP_DATABASE_URL: 'postgresql://app/windows-style',
    });
  });

  it('uses the committed lock with strict npm ci and no peer bypass', () => {
    expect(FIXTURE_INSTALL_ARGS).toEqual([
      'ci',
      '--strict-peer-deps',
      '--no-force',
      '--no-legacy-peer-deps',
      `--registry=${PUBLIC_NPM_REGISTRY}`,
      '--replace-registry-host=never',
      '--no-audit',
      '--no-fund',
    ]);
    expect(FIXTURE_INSTALL_ARGS).not.toContain('--legacy-peer-deps');
    expect(FIXTURE_INSTALL_ARGS).not.toContain('--force');

    expect(FIXTURE_LOCK_REFRESH_ARGS).toEqual([
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
    ]);
  });

  it('removes ambient npm peer bypass settings', () => {
    expect(
      createStrictNpmEnv({
        NPM_CONFIG_FORCE: 'true',
        npm_config_legacy_peer_deps: 'true',
        NPM_CONFIG_REGISTRY: 'https://mirror.invalid/',
        npm_config_replace_registry_host: 'always',
        NPM_CONFIG_STRICT_PEER_DEPS: 'false',
        SAFE_VALUE: 'kept',
      }),
    ).toEqual({
      SAFE_VALUE: 'kept',
      npm_config_force: 'false',
      npm_config_legacy_peer_deps: 'false',
      npm_config_registry: PUBLIC_NPM_REGISTRY,
      npm_config_replace_registry_host: 'never',
      npm_config_strict_peer_deps: 'true',
    });
  });

  it('invokes npm through its JavaScript CLI without Windows cmd shims', () => {
    const npmExecPath = '/tools/npm/bin/npm-cli.js';
    expect(
      resolveCommand('npm', ['ci'], { npm_execpath: npmExecPath }, 'win32'),
    ).toEqual({
      command: process.execPath,
      args: [npmExecPath, 'ci'],
    });
    expect(resolveCommand('docker', ['compose'], {}, 'win32')).toEqual({
      command: 'docker',
      args: ['compose'],
    });
    expect(() => resolveCommand('npm', ['ci'], {}, 'win32')).toThrow(
      'must be started through an npm script',
    );
    expect(resolveCommand('npm', ['ci'], {}, 'linux')).toEqual({
      command: 'npm',
      args: ['ci'],
    });
  });

  it('verifies installed artifact provenance before semantic checks', () => {
    expect(FIXTURE_VALIDATION_STEPS).toEqual([
      { command: 'npm', args: ['run', 'verify:packages'] },
      { command: 'npm', args: ['run', 'typecheck'] },
      { command: 'npm', args: ['exec', '--', 'jest', '--runInBand'] },
    ]);
  });

  it('requires an explicit deterministic ecosystem mode', () => {
    expect(parseArguments(['--mode', 'published-only'])).toEqual({
      mode: 'published-only',
      tenancyTarball: null,
    });
    expect(
      parseArguments([
        '--mode',
        'local-artifact',
        '--tenancy-tarball',
        './candidate.tgz',
      ]),
    ).toEqual({
      mode: 'local-artifact',
      tenancyTarball: path.resolve('./candidate.tgz'),
    });

    expect(() => parseArguments([])).toThrow('Missing required --mode');
    expect(() => parseArguments(['--mode', 'automatic'])).toThrow(
      'Unsupported ecosystem mode',
    );
    expect(() =>
      parseArguments([
        '--mode',
        'published-only',
        '--tenancy-tarball',
        './candidate.tgz',
      ]),
    ).toThrow('published-only does not accept');
    expect(() => parseArguments(['--mode', 'local-artifact'])).toThrow(
      'local-artifact requires',
    );
  });

  it('rejects a wrong or malformed candidate identity before installation', () => {
    expect(
      assertTenancyPackageManifest({
        name: '@nestarc/tenancy',
        version: '0.16.0-rc.1',
      }),
    ).toBe('0.16.0-rc.1');
    expect(() =>
      assertTenancyPackageManifest({
        name: '@nestarc/not-tenancy',
        version: '0.16.0',
      }),
    ).toThrow('Local artifact must be @nestarc/tenancy');
    expect(() =>
      assertTenancyPackageManifest({
        name: '@nestarc/tenancy',
        version: 'next',
      }),
    ).toThrow('valid package version');
  });

  it('rejects duplicate manifests that could change identity during extraction', () => {
    const temporaryDirectory = fs.mkdtempSync(
      path.join(os.tmpdir(), 'tenancy-candidate-test-'),
    );
    const tarballPath = path.join(temporaryDirectory, 'candidate.tgz');
    const validManifest = {
      name: '@nestarc/tenancy',
      version: '0.16.0',
    };
    try {
      fs.writeFileSync(
        tarballPath,
        zlib.gzipSync(
          Buffer.concat([
            createTarEntry('package/package.json', validManifest),
            createTarEntry('package/package.json', {
              name: '@nestarc/not-tenancy',
              version: '0.16.0',
            }),
            Buffer.alloc(1024),
          ]),
        ),
      );
      expect(() => readPackageManifestFromTarball(tarballPath)).toThrow(
        'duplicate package/package.json',
      );
    } finally {
      fs.rmSync(temporaryDirectory, { recursive: true, force: true });
    }
  });

  it('replaces only declared fixture dependencies with absolute tarballs', () => {
    const manifest = {
      dependencies: {
        '@nestarc/tenancy': '0.15.0',
        '@nestarc/rbac': '0.2.0',
      },
    };

    const result = applyPackageSpecs(manifest, {
      '@nestarc/tenancy': './tenancy.tgz',
    });

    expect(result.dependencies).toEqual({
      '@nestarc/tenancy': `file:${path.resolve('./tenancy.tgz')}`,
      '@nestarc/rbac': '0.2.0',
    });
    expect(manifest.dependencies['@nestarc/tenancy']).toBe('0.15.0');
    expect(() =>
      applyPackageSpecs(manifest, { '@nestarc/missing': './missing.tgz' }),
    ).toThrow('Fixture dependency is missing');
  });

  it('locks every Nestarc package to an exact public registry artifact', () => {
    const fixtureDirectory = path.join(
      process.cwd(),
      'test',
      'ecosystem',
      'fixture',
    );
    const manifest = JSON.parse(
      fs.readFileSync(path.join(fixtureDirectory, 'package.json'), 'utf8'),
    );
    const lockfile = JSON.parse(
      fs.readFileSync(path.join(fixtureDirectory, 'package-lock.json'), 'utf8'),
    );

    for (const packageName of ECOSYSTEM_PACKAGE_NAMES) {
      const requested = manifest.dependencies[packageName];
      const lockEntry = lockfile.packages[`node_modules/${packageName}`];

      expect(requested).toMatch(/^\d+\.\d+\.\d+$/);
      expect(lockEntry.version).toBe(requested);
      expect(lockEntry.resolved).toMatch(
        /^https:\/\/registry\.npmjs\.org\//,
      );
      expect(lockEntry.integrity).toMatch(/^sha512-/);
      expect(lockEntry.link).not.toBe(true);
    }
    expect(manifest.dependencies).not.toHaveProperty('@nestarc/audit-log');
    expect(manifest.dependencies).not.toHaveProperty('@nestarc/soft-delete');
  });

  it('changes only tenancy provenance in explicit local-artifact mode', () => {
    expect(expectedPackageSource('published-only', '@nestarc/tenancy')).toBe(
      'published-lock',
    );
    expect(expectedPackageSource('published-only', '@nestarc/rbac')).toBe(
      'published-lock',
    );
    expect(expectedPackageSource('local-artifact', '@nestarc/tenancy')).toBe(
      'local-artifact',
    );
    expect(expectedPackageSource('local-artifact', '@nestarc/rbac')).toBe(
      'published-lock',
    );
  });

  it('rejects transitive lock drift while allowing the explicit artifact entry', () => {
    const baseline = {
      name: 'fixture',
      lockfileVersion: 3,
      packages: {
        '': {
          dependencies: {
            '@nestarc/tenancy': '0.15.0',
            rxjs: '7.8.2',
          },
        },
        'node_modules/@nestarc/tenancy': {
          version: '0.15.0',
          resolved: 'https://registry.npmjs.org/@nestarc/tenancy/-/tenancy-0.15.0.tgz',
        },
        'node_modules/rxjs': {
          version: '7.8.2',
          resolved: 'https://registry.npmjs.org/rxjs/-/rxjs-7.8.2.tgz',
        },
      },
    };
    const overlay = structuredClone(baseline);
    overlay.packages[''].dependencies['@nestarc/tenancy'] =
      'file:/tmp/tenancy.tgz';
    overlay.packages['node_modules/@nestarc/tenancy'] = {
      version: '0.15.0',
      resolved: 'file:../../tmp/tenancy.tgz',
    };

    expect(() =>
      assertArtifactOverlayPreservesLockedGraph(baseline, overlay, [
        '@nestarc/tenancy',
      ]),
    ).not.toThrow();

    const drifted = structuredClone(overlay);
    drifted.packages['node_modules/rxjs'].version = '7.8.3';
    expect(() =>
      assertArtifactOverlayPreservesLockedGraph(baseline, drifted, [
        '@nestarc/tenancy',
      ]),
    ).toThrow('changed the locked transitive graph');
  });
});
