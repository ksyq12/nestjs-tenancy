import type { Config } from 'jest';

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '../../..',
  testRegex: 'test/e2e/redis/.*\\.e2e-spec\\.ts$',
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      { diagnostics: { ignoreCodes: [151002] } },
    ],
  },
  testEnvironment: 'node',
  testTimeout: 30_000,
};

export default config;
