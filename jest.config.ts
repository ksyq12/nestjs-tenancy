import type { Config } from 'jest';

const completeCriticalCoverage = {
  branches: 100,
  functions: 100,
  lines: 100,
  statements: 100,
};

const highCriticalCoverage = {
  branches: 95,
  functions: 100,
  lines: 95,
  statements: 95,
};

const lineCompleteCriticalCoverage = {
  branches: 95,
  functions: 100,
  lines: 100,
  statements: 100,
};

const broadCriticalCoverage = {
  branches: 90,
  functions: 100,
  lines: 95,
  statements: 95,
};

const aggregateCoverage = {
  branches: 95,
  functions: 100,
  lines: 98,
  statements: 98,
};

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  testPathIgnorePatterns: ['/test/e2e/', '/test/ecosystem/fixture/'],
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      { diagnostics: { ignoreCodes: [151002] } },
    ],
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/index.ts',
    '!src/{cache,diagnostics,events,propagation,resources,testing}/index.ts',
  ],
  coverageDirectory: './coverage',
  coverageThreshold: {
    global: aggregateCoverage,
    './src/cli/check.ts': broadCriticalCoverage,
    './src/cli/index.ts': completeCriticalCoverage,
    './src/cli/init.ts': broadCriticalCoverage,
    './src/cli/prisma-schema-parser.ts': broadCriticalCoverage,
    './src/cli/templates/module-setup.ts': lineCompleteCriticalCoverage,
    './src/cli/templates/setup-sql.ts': completeCriticalCoverage,
    './src/middleware/tenant.middleware.ts': highCriticalCoverage,
    './src/postgres-safety.ts': completeCriticalCoverage,
    './src/prisma/**/*.ts': highCriticalCoverage,
    './src/propagation/tenant-context.interceptor.ts': broadCriticalCoverage,
    './src/services/tenancy-context.ts': completeCriticalCoverage,
  },
  testEnvironment: 'node',
};

export default config;
