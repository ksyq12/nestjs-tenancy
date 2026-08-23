import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '../../..',
  testMatch: [
    '<rootDir>/test/e2e/pgbouncer/pgbouncer.e2e-spec.ts',
  ],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      { diagnostics: { ignoreCodes: [151002] } },
    ],
  },
  testEnvironment: 'node',
  globalSetup: '<rootDir>/test/e2e/global-setup.ts',
  globalTeardown: '<rootDir>/test/e2e/global-teardown.ts',
};

export default config;
