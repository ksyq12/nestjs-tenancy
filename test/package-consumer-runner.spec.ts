import path from 'path';

const {
  INSTALL_ARGS,
  PACKAGE_CONSUMER_PROFILES,
  createConsumerManifest,
} = require('../scripts/test-package-consumer');

describe('packed package consumer runner', () => {
  it('uses strict installation without peer-dependency bypass flags', () => {
    expect(INSTALL_ARGS).toEqual([
      'install',
      '--strict-peer-deps',
      '--omit=optional',
      '--no-audit',
      '--no-fund',
    ]);
    expect(INSTALL_ARGS).not.toContain('--force');
    expect(INSTALL_ARGS).not.toContain('--legacy-peer-deps');
  });

  it('defines full public-shape and root-without-cache profiles', () => {
    expect(
      PACKAGE_CONSUMER_PROFILES.map((profile: { id: string }) => profile.id),
    ).toEqual(['public-shape', 'root-without-cache']);

    const publicShape = PACKAGE_CONSUMER_PROFILES[0];
    const rootWithoutCache = PACKAGE_CONSUMER_PROFILES[1];

    expect(publicShape).toMatchObject({
      fixture: 'public-shape.ts',
      verifyBin: true,
      verifyCachePeersAbsent: false,
    });
    expect(publicShape.dependencies).toMatchObject({
      '@nestjs/cache-manager': '3.1.3',
      'cache-manager': '7.2.8',
    });
    expect(rootWithoutCache).toMatchObject({
      fixture: 'root-without-cache.ts',
      verifyBin: false,
      verifyCachePeersAbsent: true,
    });
    expect(rootWithoutCache.dependencies).not.toHaveProperty(
      '@nestjs/cache-manager',
    );
    expect(rootWithoutCache.dependencies).not.toHaveProperty('cache-manager');
  });

  it('builds an exact consumer manifest around the actual tarball', () => {
    const tarballPath = path.resolve('/tmp/nestarc-tenancy.tgz');
    const manifest = createConsumerManifest(
      { name: 'fixture', private: true },
      PACKAGE_CONSUMER_PROFILES[1],
      tarballPath,
    );

    expect(manifest.dependencies).toEqual({
      '@nestarc/tenancy': `file:${tarballPath}`,
      '@nestjs/common': '11.2.1',
      '@nestjs/core': '11.2.1',
      '@opentelemetry/api': '1.9.1',
      '@prisma/client': '7.10.0',
      'reflect-metadata': '0.2.2',
      rxjs: '7.8.2',
    });
    expect(manifest.devDependencies).toEqual({
      '@types/node': '22.20.1',
      typescript: '5.9.3',
    });
  });
});
