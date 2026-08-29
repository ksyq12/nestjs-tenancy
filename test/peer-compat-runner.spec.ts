import path from 'path';

const {
  COMPATIBILITY_LANES,
  INSTALL_ARGS,
  createConsumerManifest,
  selectCompatibilityLanes,
} = require('../scripts/test-peer-compat');

describe('packed consumer peer compatibility runner', () => {
  it('defines the complete Nest 10/11 and Prisma 6/7 cross-product', () => {
    expect(
      COMPATIBILITY_LANES.map(
        (lane: { nestMajor: number; prismaMajor: number }) =>
          `${lane.nestMajor}/${lane.prismaMajor}`,
      ),
    ).toEqual(['10/6', '10/7', '11/6', '11/7']);
  });

  it('uses strict npm install without peer-dependency bypass flags', () => {
    expect(INSTALL_ARGS).toEqual([
      'install',
      '--strict-peer-deps',
      '--no-audit',
      '--no-fund',
    ]);
    expect(INSTALL_ARGS).not.toContain('--force');
    expect(INSTALL_ARGS).not.toContain('--legacy-peer-deps');
  });

  it('covers representative optional peer lower bounds and current versions', () => {
    const minimum = COMPATIBILITY_LANES.find(
      (lane: { optionalPeerProfile: string }) =>
        lane.optionalPeerProfile === 'minimum',
    );
    const current = COMPATIBILITY_LANES.find(
      (lane: { optionalPeerProfile: string }) =>
        lane.optionalPeerProfile === 'current',
    );

    expect(minimum.optionalPeers).toEqual({
      '@nestjs/cache-manager': '2.0.0',
      '@nestjs/event-emitter': '2.0.0',
      'cache-manager': '5.0.0',
    });
    expect(minimum.reflectMetadataVersion).toBe('0.1.13');
    expect(current.optionalPeers).toEqual({
      '@nestjs/cache-manager': '3.1.3',
      '@nestjs/event-emitter': '3.1.0',
      'cache-manager': '7.2.8',
    });
    expect(current.supportingDependencies).toEqual({
      cacheable: '2.5.0',
      keyv: '5.6.0',
    });
    expect(current.reflectMetadataVersion).toBe('0.2.2');
  });

  it('builds an exact consumer manifest around the packed tarball', () => {
    const tarballPath = path.resolve('/tmp/nestarc-tenancy.tgz');
    const manifest = createConsumerManifest(
      { name: 'fixture', private: true },
      COMPATIBILITY_LANES[1],
      tarballPath,
    );

    expect(manifest.dependencies).toEqual({
      '@nestarc/tenancy': `file:${tarballPath}`,
      '@nestjs/common': '10.4.22',
      '@nestjs/core': '10.4.22',
      '@nestjs/testing': '10.4.22',
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

  it('selects one requested lane and rejects unknown lanes', () => {
    expect(selectCompatibilityLanes(['--lane', 'nest10-prisma7'])).toEqual([
      COMPATIBILITY_LANES[1],
    ]);
    expect(selectCompatibilityLanes([])).toEqual(COMPATIBILITY_LANES);
    expect(() => selectCompatibilityLanes(['--lane', 'unknown'])).toThrow(
      /Unknown compatibility lane/,
    );
  });
});
