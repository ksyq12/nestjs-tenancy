const {
  verifyReleaseProvenance,
} = require('../scripts/verify-release');

const commit = '448338ac9dc91152fe674a59015f3df937460aa4';
const validRelease = {
  packageVersion: '0.15.0',
  releaseTag: 'v0.15.0',
  releaseCommit: commit,
  releaseTarget: commit,
  releaseRef: 'refs/tags/v0.15.0',
  headCommit: commit,
  tagCommit: commit,
};

describe('release provenance verification', () => {
  it('accepts one version and commit across the package, event, checkout, and tag', () => {
    expect(() => verifyReleaseProvenance(validRelease)).not.toThrow();
  });

  it('rejects a release tag that does not match the package version', () => {
    expect(() =>
      verifyReleaseProvenance({ ...validRelease, releaseTag: 'v0.15.1' }),
    ).toThrow(/Release tag\/package version mismatch/);
  });

  it('rejects a checkout or tag that does not match the release target commit', () => {
    const otherCommit = '048e55bb85ac93f1a22c0caf1be9ff8a128a279e';

    expect(() =>
      verifyReleaseProvenance({ ...validRelease, headCommit: otherCommit }),
    ).toThrow(/Checked-out commit\/release target mismatch/);
    expect(() =>
      verifyReleaseProvenance({ ...validRelease, tagCommit: otherCommit }),
    ).toThrow(/Release tag commit\/release target mismatch/);
  });

  it('rejects a GitHub Release target that is mutable or differs from the tag commit', () => {
    expect(() =>
      verifyReleaseProvenance({ ...validRelease, releaseTarget: 'main' }),
    ).toThrow(/GitHub Release target must be a full lowercase Git SHA/);
    expect(() =>
      verifyReleaseProvenance({
        ...validRelease,
        releaseTarget: '048e55bb85ac93f1a22c0caf1be9ff8a128a279e',
      }),
    ).toThrow(/GitHub Release target\/release commit mismatch/);
  });

  it('requires the release event tag ref and a full lowercase target SHA', () => {
    expect(() =>
      verifyReleaseProvenance({
        ...validRelease,
        releaseRef: 'refs/heads/main',
      }),
    ).toThrow(/Release ref mismatch/);
    expect(() =>
      verifyReleaseProvenance({ ...validRelease, releaseCommit: '448338a' }),
    ).toThrow(/full lowercase Git SHA/);
  });
});
