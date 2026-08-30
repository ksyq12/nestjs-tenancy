const {
  AGGREGATE_THRESHOLDS,
  coverageDirectoryFromArgs,
  validateAggregateCoverage,
} = require('../scripts/test-coverage');

describe('coverage runner', () => {
  it('resolves both coverage directory option forms', () => {
    expect(coverageDirectoryFromArgs(
      ['--coverageDirectory=reports/coverage'],
      '/workspace',
    )).toBe('/workspace/reports/coverage');
    expect(coverageDirectoryFromArgs(
      ['--coverageDirectory', '/tmp/coverage'],
      '/workspace',
    )).toBe('/tmp/coverage');
    expect(coverageDirectoryFromArgs([], '/workspace')).toBe('/workspace/coverage');
  });

  it('accepts the exact aggregate coverage floor', () => {
    const total = Object.fromEntries(Object.entries(AGGREGATE_THRESHOLDS).map(
      ([metric, pct]) => [metric, { pct }],
    ));
    expect(validateAggregateCoverage(total)).toEqual([]);
  });

  it('reports every missing or sub-threshold metric', () => {
    expect(validateAggregateCoverage({
      statements: { pct: 97.99 },
      branches: { pct: 95 },
      functions: { pct: 'Unknown' },
      lines: { pct: 97 },
    })).toEqual([
      'statements: expected >= 98%, received 97.99%',
      'functions: expected >= 100%, received Unknown%',
      'lines: expected >= 98%, received 97%',
    ]);
  });
});
