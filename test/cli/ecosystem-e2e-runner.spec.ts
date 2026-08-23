import path from 'path';

const {
  DEFAULT_APP_DATABASE_URL,
  DEFAULT_DATABASE_URL,
  FIXTURE_INSTALL_ARGS,
  applyDefaultEnv,
  applyPackageSpecs,
  discoverLocalPackageSources,
} = require('../../scripts/test-ecosystem-e2e');

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
  });

  it('uses strict npm install without peer-dependency bypass flags', () => {
    expect(FIXTURE_INSTALL_ARGS).toEqual([
      'install',
      '--no-audit',
      '--no-fund',
    ]);
    expect(FIXTURE_INSTALL_ARGS).not.toContain('--legacy-peer-deps');
    expect(FIXTURE_INSTALL_ARGS).not.toContain('--force');
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

  it('discovers only matching built sibling packages', () => {
    const sources = discoverLocalPackageSources(
      path.resolve(__dirname, '..', '..'),
    );

    for (const [packageName, directory] of Object.entries(sources)) {
      expect(packageName).toMatch(/^@nestarc\//);
      expect(path.isAbsolute(directory as string)).toBe(true);
    }
  });
});
