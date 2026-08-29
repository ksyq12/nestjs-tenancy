import fs from 'fs';
import path from 'path';

const releaseWorkflowPath = path.join(
  process.cwd(),
  '.github',
  'workflows',
  'release.yml',
);
const ciWorkflowPath = path.join(
  process.cwd(),
  '.github',
  'workflows',
  'ci.yml',
);
const packageManifestPath = path.join(process.cwd(), 'package.json');
const packageLockPath = path.join(process.cwd(), 'package-lock.json');

// Captured from the M08B graph at 1c6fb98e170a999bc775fb40f970496b8066b35c.
const PRE_REFACTOR_GRAPH = {
  validationJobs: [
    'test',
    'compat',
    'package-smoke',
    'e2e',
    'pgbouncer-e2e',
    'redis-e2e',
    'ecosystem-e2e',
  ],
  releaseJobs: [
    'test',
    'compat',
    'package-smoke',
    'e2e',
    'pgbouncer-e2e',
    'redis-e2e',
    'ecosystem-e2e',
    'publish',
  ],
  publishNeeds: [
    'test',
    'compat',
    'package-smoke',
    'e2e',
    'pgbouncer-e2e',
    'redis-e2e',
    'ecosystem-e2e',
  ],
  matrixCardinality: {
    test: 3,
    compat: 4,
    'package-smoke': 1,
    e2e: 1,
    'pgbouncer-e2e': 2,
    'redis-e2e': 1,
    'ecosystem-e2e': 1,
  },
} as const;

const JOB_TIMEOUTS = {
  test: 15,
  compat: 20,
  'package-smoke': 15,
  e2e: 15,
  'pgbouncer-e2e': 20,
  'redis-e2e': 10,
  'ecosystem-e2e': 20,
} as const;

const GATE_RUN_COMMANDS = {
  test: ['npm ci', 'npm run lint', 'npm run test:cov', 'npm run build'],
  compat: ['npm ci', 'npm run test:compat -- --lane ${{ matrix.lane }}'],
  'package-smoke': ['npm ci', 'npm run test:package'],
  e2e: [
    'npm ci',
    'npx prisma generate --schema=test/e2e/schema.prisma',
    'npx jest --config test/e2e/jest.e2e.config.ts --runInBand',
  ],
  'pgbouncer-e2e': [
    'npm ci',
    'npm install prisma@${{ matrix.prisma }} @prisma/client@${{ matrix.prisma }} @prisma/adapter-pg@${{ matrix.prisma }} --no-save',
    'npm run test:e2e:pgbouncer',
  ],
  'redis-e2e': [
    'npm ci',
    'npx jest --config test/e2e/redis/jest.redis.config.ts --runInBand',
  ],
  'ecosystem-e2e': ['npm ci', 'npm run test:e2e:ecosystem'],
} as const;

const GATE_ACTIONS = {
  test: [
    'actions/checkout@v6',
    'actions/setup-node@v6',
    'codecov/codecov-action@v5',
  ],
  compat: ['actions/checkout@v6', 'actions/setup-node@v6'],
  'package-smoke': ['actions/checkout@v6', 'actions/setup-node@v6'],
  e2e: ['actions/checkout@v6', 'actions/setup-node@v6'],
  'pgbouncer-e2e': ['actions/checkout@v6', 'actions/setup-node@v6'],
  'redis-e2e': ['actions/checkout@v6', 'actions/setup-node@v6'],
  'ecosystem-e2e': ['actions/checkout@v6', 'actions/setup-node@v6'],
} as const;

const POSTGRES_IMAGE =
  'postgres:16.15-alpine@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685';

function readTopLevelBlock(workflow: string, key: string): string {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line === `${key}:`);

  if (start === -1) {
    throw new Error(`Missing workflow block: ${key}`);
  }

  const nextBlock = lines.findIndex(
    (line, index) => index > start && /^[a-z][a-z-]*:$/.test(line),
  );

  return lines.slice(start, nextBlock === -1 ? undefined : nextBlock).join('\n');
}

function readJobBlock(workflow: string, jobId: string): string {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line === `  ${jobId}:`);

  if (start === -1) {
    throw new Error(`Missing workflow job: ${jobId}`);
  }

  const nextJob = lines.findIndex(
    (line, index) => index > start && /^ {2}[a-z0-9-]+:$/.test(line),
  );

  return lines.slice(start, nextJob === -1 ? undefined : nextJob).join('\n');
}

function readJobIds(workflow: string): string[] {
  return readTopLevelBlock(workflow, 'jobs')
    .split('\n')
    .flatMap((line) => line.match(/^ {2}([a-z0-9-]+):$/)?.[1] ?? []);
}

function readNeeds(block: string): string[] {
  const inline = block.match(/^ {4}needs\s*:\s*\[([^\]]*)\]$/m);
  if (inline) {
    return inline[1]
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
  }

  const scalar = block.match(/^ {4}needs\s*:\s*([a-z0-9-]+)$/m);
  if (scalar) return [scalar[1]];
  if (/^ {4}needs\s*:/m.test(block)) {
    throw new Error('Unsupported needs declaration');
  }
  return [];
}

function readTimeout(block: string): number | null {
  const match = block.match(/^ {4}timeout-minutes: (\d+)$/m);
  return match ? Number(match[1]) : null;
}

interface WorkflowStep {
  block: string;
  continueOnError: string | null;
  if: string | null;
  run: string | null;
  uses: string | null;
}

function readSteps(block: string): WorkflowStep[] {
  const lines = block.split('\n');
  const stepsStart = lines.findIndex((line) => /^ {4}steps\s*:$/.test(line));
  if (stepsStart === -1) return [];

  const stepBlocks: string[][] = [];
  for (const line of lines.slice(stepsStart + 1)) {
    if (/^ {6}-\s+/.test(line)) stepBlocks.push([line]);
    else if (stepBlocks.length > 0) stepBlocks.at(-1)?.push(line);
  }

  return stepBlocks.map((stepLines) => {
    const readScalar = (key: string): string | null => {
      const pattern = new RegExp(
        `^(?: {6}-\\s+| {8})${key}\\s*:\\s*(.+)$`,
      );
      return stepLines.map((line) => line.match(pattern)?.[1]).find(Boolean) ?? null;
    };

    return {
      block: stepLines.join('\n'),
      continueOnError: readScalar('continue-on-error'),
      if: readScalar('if'),
      run: readScalar('run'),
      uses: readScalar('uses'),
    };
  });
}

function readRunCommands(block: string): string[] {
  return readSteps(block).flatMap((step) => step.run ?? []);
}

function readJobMap(block: string, key: string): Record<string, string> {
  const lines = block.split('\n');
  const start = lines.findIndex((line) => line === `    ${key}:`);
  if (start === -1) throw new Error(`Missing job map: ${key}`);

  return Object.fromEntries(
    lines.slice(start + 1).flatMap((line) => {
      const entry = line.match(/^ {6}([a-z-]+)\s*:\s*(.+)$/);
      return entry ? [[entry[1], entry[2]]] : [];
    }),
  );
}

function expectRequiredJob(block: string): void {
  expect(block).not.toMatch(/^ {4}if\s*:/m);
  expect(block).not.toMatch(/^ {4}continue-on-error\s*:/m);
}

describe('shared validation workflow', () => {
  const ciWorkflow = fs.readFileSync(ciWorkflowPath, 'utf8');
  const releaseWorkflow = fs.readFileSync(releaseWorkflowPath, 'utf8');
  const packageManifest = JSON.parse(
    fs.readFileSync(packageManifestPath, 'utf8'),
  ) as { devDependencies: Record<string, string> };
  const packageLock = JSON.parse(fs.readFileSync(packageLockPath, 'utf8')) as {
    packages: Record<
      string,
      { devDependencies?: Record<string, string>; version?: string }
    >;
  };

  it('keeps the pre-refactor validation job and matrix inventory exact', () => {
    expect(readJobIds(ciWorkflow)).toEqual([
      ...PRE_REFACTOR_GRAPH.validationJobs,
    ]);

    const sourceGates = readJobBlock(ciWorkflow, 'test');
    const sourceVersions = [
      ...sourceGates.matchAll(/^ {10}- node-version: '([^']+)'$/gm),
    ].map((match) => match[1]);
    const sourceLanes = [
      ...sourceGates.matchAll(/^ {12}lane: ([a-z0-9-]+)$/gm),
    ].map((match) => match[1]);

    const compat = readJobBlock(ciWorkflow, 'compat');
    const compatLanes = [
      ...compat.matchAll(/^ {10}- (nest\d+-prisma\d+)$/gm),
    ].map((match) => match[1]);

    const pgbouncer = readJobBlock(ciWorkflow, 'pgbouncer-e2e');
    const prismaVersions =
      pgbouncer
        .match(/^ {8}prisma: \[([^\]]+)\]$/m)?.[1]
        .split(',')
        .map((version) => version.trim().replaceAll("'", '')) ?? [];
    const prismaPackages = [
      'prisma',
      '@prisma/client',
      '@prisma/adapter-pg',
    ];
    const declaredPrismaVersions = prismaPackages.map(
      (packageName) => packageManifest.devDependencies[packageName],
    );
    const lockRootPrismaVersions = prismaPackages.map(
      (packageName) =>
        packageLock.packages[''].devDependencies?.[packageName],
    );
    const resolvedPrismaVersions = prismaPackages.map(
      (packageName) =>
        packageLock.packages[`node_modules/${packageName}`].version,
    );
    const actualCardinality = {
      test: sourceVersions.length,
      compat: compatLanes.length,
      'package-smoke': 1,
      e2e: 1,
      'pgbouncer-e2e': prismaVersions.length,
      'redis-e2e': 1,
      'ecosystem-e2e': 1,
    };

    expect(sourceVersions).toEqual(['22.13.0', '22', '24']);
    expect(sourceLanes).toEqual(['minimum', 'current-22', 'current-24']);
    expect(compatLanes).toEqual([
      'nest10-prisma6',
      'nest10-prisma7',
      'nest11-prisma6',
      'nest11-prisma7',
    ]);
    expect(declaredPrismaVersions).toEqual([
      '^7.10.0',
      '^7.10.0',
      '^7.10.0',
    ]);
    expect(lockRootPrismaVersions).toEqual(declaredPrismaVersions);
    expect(resolvedPrismaVersions).toEqual([
      '7.10.0',
      '7.10.0',
      '7.10.0',
    ]);
    expect(prismaVersions).toEqual(['6.19.3', '7.10.0']);
    expect(actualCardinality).toEqual(PRE_REFACTOR_GRAPH.matrixCardinality);
    expect(Object.values(actualCardinality).reduce((a, b) => a + b, 0)).toBe(
      13,
    );
    expect(sourceGates).not.toMatch(/^ {8}exclude:/m);
    expect(compat).not.toMatch(/^ {8}(include|exclude):/m);
    expect(pgbouncer).not.toMatch(/^ {8}(include|exclude):/m);
  });

  it('is reusable without publishing duplicate release coverage', () => {
    const triggers = readTopLevelBlock(ciWorkflow, 'on');
    const sourceGates = readJobBlock(ciWorkflow, 'test');

    expect(triggers.trim()).toBe(
      [
        'on:',
        '  workflow_call:',
        '  push:',
        '    branches: [main]',
        '  pull_request:',
        '    branches: [main]',
      ].join('\n'),
    );
    const codecov = readSteps(sourceGates).find(
      (step) => step.uses === 'codecov/codecov-action@v5',
    );

    expect(codecov?.if).toBe(
      "matrix.lane == 'current-22' && github.event_name != 'release'",
    );
  });

  it('sets a bounded timeout on every validation job', () => {
    for (const [jobId, timeout] of Object.entries(JOB_TIMEOUTS)) {
      const job = readJobBlock(ciWorkflow, jobId);

      expect(readTimeout(job)).toBe(timeout);
      expect(readNeeds(job)).toEqual([]);
      expectRequiredJob(job);
    }
  });

  it('cancels only superseded pull request runs', () => {
    const concurrency = readTopLevelBlock(ciWorkflow, 'concurrency');

    expect(concurrency.trim()).toBe(
      [
        'concurrency:',
        '  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.run_id }}',
        "  cancel-in-progress: ${{ github.event_name == 'pull_request' }}",
      ].join('\n'),
    );
  });

  it('keeps validation read-only and limits OIDC to publish', () => {
    const ciPermissions = readTopLevelBlock(ciWorkflow, 'permissions');
    const releasePermissions = readTopLevelBlock(
      releaseWorkflow,
      'permissions',
    );
    const validation = readJobBlock(releaseWorkflow, 'validation');
    const publish = readJobBlock(releaseWorkflow, 'publish');

    expect(ciPermissions.trim()).toBe('permissions:\n  contents: read');
    expect(releasePermissions.trim()).toBe('permissions:\n  contents: read');
    expect(validation).not.toMatch(/^ {4}secrets:/m);
    expect(readJobMap(publish, 'permissions')).toEqual({
      contents: 'read',
      'id-token': 'write',
    });
  });

  it('uses one immutable PostgreSQL image across database gates', () => {
    const postgresImages = [
      ...ciWorkflow.matchAll(/^ {8}image: (postgres:.+)$/gm),
    ].map((match) => match[1]);

    expect(postgresImages).toEqual([POSTGRES_IMAGE, POSTGRES_IMAGE]);
  });

  it('keeps every validation gate command required and exact', () => {
    for (const [jobId, commands] of Object.entries(GATE_RUN_COMMANDS)) {
      const job = readJobBlock(ciWorkflow, jobId);
      const steps = readSteps(job);
      const runSteps = steps.filter((step) => step.run !== null);
      const actionSteps = steps.filter((step) => step.uses !== null);

      expect(readRunCommands(job)).toEqual(commands);
      expect(actionSteps.map((step) => step.uses)).toEqual(
        GATE_ACTIONS[jobId as keyof typeof GATE_ACTIONS],
      );
      for (const step of runSteps) {
        expect(step.if).toBeNull();
        expect(step.continueOnError).toBeNull();
      }
      for (const step of actionSteps) {
        const isCodecov = step.uses === 'codecov/codecov-action@v5';
        if (!isCodecov) expect(step.if).toBeNull();
        expect(step.continueOnError).toBeNull();
        if (step.uses === 'actions/checkout@v6') {
          expect(step.block).not.toMatch(/\bref\s*:/);
        }
      }
      expectRequiredJob(job);
    }
  });

  it('preserves the expanded release job and publish dependency graph', () => {
    const releaseJobIds = readJobIds(releaseWorkflow);
    const validation = readJobBlock(releaseWorkflow, 'validation');
    const publish = readJobBlock(releaseWorkflow, 'publish');
    const expandedReleaseJobs = releaseJobIds.flatMap((jobId) =>
      jobId === 'validation'
        ? [...PRE_REFACTOR_GRAPH.validationJobs]
        : [jobId],
    );
    const expandedPublishNeeds = readNeeds(publish).flatMap((jobId) =>
      jobId === 'validation'
        ? [...PRE_REFACTOR_GRAPH.validationJobs]
        : [jobId],
    );

    expect(releaseJobIds).toEqual(['validation', 'publish']);
    expect(validation).toMatch(
      /^ {4}uses: \.\/\.github\/workflows\/ci\.yml$/m,
    );
    expect(validation).not.toMatch(/^ {4}(runs-on|steps|with|secrets):/m);
    expectRequiredJob(validation);
    expect(readNeeds(publish)).toEqual(['validation']);
    expectRequiredJob(publish);
    expect(readTimeout(publish)).toBe(15);
    expect(expandedReleaseJobs).toEqual(PRE_REFACTOR_GRAPH.releaseJobs);
    expect(expandedPublishNeeds).toEqual(PRE_REFACTOR_GRAPH.publishNeeds);
  });

  it('verifies release provenance before npm publish', () => {
    const publish = readJobBlock(releaseWorkflow, 'publish');
    const publishSteps = readSteps(publish);
    const verificationIndex = publish.indexOf('node scripts/verify-release.js');
    const publishIndex = publish.indexOf('npm publish --access public');

    expect(readTopLevelBlock(releaseWorkflow, 'on').trim()).toBe(
      ['on:', '  release:', '    types: [published]'].join('\n'),
    );
    expect(readRunCommands(publish)).toEqual([
      'node scripts/verify-release.js',
      'npm ci',
      'npm run build',
      'npm publish --access public',
    ]);
    expect(publishSteps.flatMap((step) => step.uses ?? [])).toEqual([
      'actions/checkout@v6',
      'actions/setup-node@v6',
    ]);
    for (const step of publishSteps) {
      expect(step.if).toBeNull();
      expect(step.continueOnError).toBeNull();
    }
    const checkout = publishSteps.find(
      (step) => step.uses === 'actions/checkout@v6',
    );
    expect(checkout?.block.match(/\bref\s*:\s*(.+)$/m)?.[1]).toBe(
      '${{ github.sha }}',
    );
    expect(publish).toContain('ref: ${{ github.sha }}');
    expect(publish).toContain('fetch-depth: 0');
    expect(publish).toContain(
      'RELEASE_TAG: ${{ github.event.release.tag_name }}',
    );
    expect(publish).toContain('RELEASE_COMMIT: ${{ github.sha }}');
    expect(publish).toContain(
      'RELEASE_TARGET: ${{ github.event.release.target_commitish }}',
    );
    expect(publish).toContain('RELEASE_REF: ${{ github.ref }}');
    expect(verificationIndex).toBeGreaterThan(-1);
    expect(publishIndex).toBeGreaterThan(verificationIndex);
  });
});
