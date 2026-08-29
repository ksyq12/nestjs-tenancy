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

const REQUIRED_RELEASE_GATES = [
  'test',
  'compat',
  'package-smoke',
  'e2e',
  'pgbouncer-e2e',
  'redis-e2e',
  'ecosystem-e2e',
];

function readJobBlock(workflow: string, jobId: string): string {
  const lines = workflow.split('\n');
  const start = lines.findIndex((line) => line === `  ${jobId}:`);

  if (start === -1) {
    throw new Error(`Missing release workflow job: ${jobId}`);
  }

  const nextJob = lines.findIndex(
    (line, index) => index > start && /^ {2}[a-z0-9-]+:$/.test(line),
  );

  return lines.slice(start, nextJob === -1 ? undefined : nextJob).join('\n');
}

function readInlineList(block: string, key: string): string[] {
  const match = block.match(new RegExp(`^    ${key}: \\[([^\\]]*)\\]$`, 'm'));
  if (!match) {
    throw new Error(`Missing inline ${key} list`);
  }

  return match[1]
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

describe('release workflow', () => {
  it('runs the package-shape smoke in pull request CI', () => {
    const workflow = fs.readFileSync(ciWorkflowPath, 'utf8');
    const packageSmoke = readJobBlock(workflow, 'package-smoke');

    expect(packageSmoke).toContain('npm run test:package');
  });

  it('requires every source, compatibility, and infrastructure gate before publish', () => {
    const workflow = fs.readFileSync(releaseWorkflowPath, 'utf8');
    const compat = readJobBlock(workflow, 'compat');
    const packageSmoke = readJobBlock(workflow, 'package-smoke');
    const publish = readJobBlock(workflow, 'publish');
    const needs = readInlineList(publish, 'needs');

    for (const jobId of REQUIRED_RELEASE_GATES) {
      readJobBlock(workflow, jobId);
    }
    expect(compat).toContain('npm run test:compat');
    for (const lane of [
      'nest10-prisma6',
      'nest10-prisma7',
      'nest11-prisma6',
      'nest11-prisma7',
    ]) {
      expect(compat).toContain(lane);
    }
    expect(packageSmoke).toContain('npm run test:package');
    expect(compat).not.toContain('continue-on-error: true');
    expect(packageSmoke).not.toContain('continue-on-error: true');
    expect(needs).toEqual(expect.arrayContaining(REQUIRED_RELEASE_GATES));
    expect(new Set(needs).size).toBe(needs.length);
    expect(publish).not.toMatch(/^ {4}if:/m);
  });

  it('verifies release version and target provenance before npm publish', () => {
    const workflow = fs.readFileSync(releaseWorkflowPath, 'utf8');
    const publish = readJobBlock(workflow, 'publish');
    const verificationIndex = publish.indexOf('node scripts/verify-release.js');
    const publishIndex = publish.indexOf('npm publish --access public');

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
