/**
 * Benchmark: RLS extension overhead measurement
 *
 * Compares:
 *   A) Admin direct query, all rows (context only; not an extension baseline)
 *   B) Admin direct query, tenant-filtered with WHERE (same returned row count, RLS bypassed)
 *   C) app_user manual RLS transaction (set_config + query, no extension)
 *   D) app_user tenancy extension (same app role, RLS policy, and returned row count)
 *   E) app_user tenancy extension findFirst (single-row reference)
 *
 * The headline extension overhead is D - C. This keeps database role, RLS policy,
 * set_config, transaction wrapping, and returned row count aligned.
 *
 * Usage:
 *   docker compose up -d --wait
 *   DATABASE_URL=postgresql://tenancy:tenancy@localhost:5433/tenancy_test \
 *     npx ts-node benchmarks/rls-overhead.ts
 */

import { execFileSync } from 'child_process';
import { Client } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { TenancyContext } from '../src/services/tenancy-context';
import { TenancyService } from '../src/services/tenancy.service';
import { createPrismaTenancyExtension } from '../src/prisma/prisma-tenancy.extension';
import { DEFAULT_DB_SETTING_KEY } from '../src/tenancy.constants';

const ADMIN_URL =
  process.env.DATABASE_URL ?? 'postgresql://tenancy:tenancy@localhost:5433/tenancy_test';
const APP_URL =
  process.env.APP_DATABASE_URL ?? 'postgresql://app_user:app_user@localhost:5433/tenancy_test';

const TENANT_1 = '11111111-1111-1111-1111-111111111111';
const TENANT_2 = '22222222-2222-2222-2222-222222222222';
const TENANT_3 = '33333333-3333-3333-3333-333333333333';
const WARMUP = 50;
const ITERATIONS = 500;

interface BenchResult {
  label: string;
  iterations: number;
  rowCount: number;
  totalMs: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  minMs: number;
  maxMs: number;
}

interface PrismaUserDelegate {
  findMany(args?: Record<string, unknown>): Promise<unknown[]>;
  findFirst(args?: Record<string, unknown>): Promise<unknown | null>;
}

interface PrismaClientLike {
  user: PrismaUserDelegate;
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  $executeRaw(strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
  $transaction<T extends readonly unknown[]>(queries: T): Promise<unknown[]>;
  $extends(extension: unknown): PrismaClientLike;
}

interface PrismaClientConstructor {
  new(options: { adapter: unknown }): PrismaClientLike;
}

function createClient(
  PrismaClient: PrismaClientConstructor,
  connectionString: string,
): PrismaClientLike {
  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

type BenchTask<T> = () => Promise<T>;

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function roundMs(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function analyze(label: string, timings: number[], rowCount: number): BenchResult {
  const sorted = [...timings].sort((a, b) => a - b);
  const total = sorted.reduce((a, b) => a + b, 0);
  return {
    label,
    iterations: sorted.length,
    rowCount,
    totalMs: roundMs(total),
    avgMs: roundMs(total / sorted.length),
    p50Ms: roundMs(percentile(sorted, 50)),
    p95Ms: roundMs(percentile(sorted, 95)),
    p99Ms: roundMs(percentile(sorted, 99)),
    minMs: roundMs(sorted[0]),
    maxMs: roundMs(sorted[sorted.length - 1]),
  };
}

function inferRowCount(result: unknown): number {
  if (Array.isArray(result)) return result.length;
  return result == null ? 0 : 1;
}

function formatSigned(value: number, digits = 3): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;
}

function formatDelta(deltaMs: number, baselineMs: number): string {
  const pct = baselineMs === 0 ? 'n/a' : `${formatSigned((deltaMs / baselineMs) * 100, 1)}%`;
  return `${formatSigned(deltaMs)}ms (${pct})`;
}

async function runBenchmark<T>(label: string, task: BenchTask<T>): Promise<BenchResult> {
  console.log(`Warming up ${label} (${WARMUP} iterations)...`);
  for (let i = 0; i < WARMUP; i++) {
    await task();
  }

  const rowCount = inferRowCount(await task());
  console.log(`Running ${label} (${ITERATIONS} iterations, rows=${rowCount})...`);

  const timings: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await task();
    timings.push(performance.now() - start);
  }

  return analyze(label, timings, rowCount);
}

async function seedBenchmarkRows(adminClient: Client): Promise<void> {
  console.log('Seeding 1000 additional rows...');
  await adminClient.query('BEGIN');
  try {
    for (let i = 0; i < 200; i++) {
      await adminClient.query(
        `INSERT INTO users (tenant_id, name, email) VALUES
         ($1, $2, $3), ($1, $4, $5),
         ($6, $7, $8), ($6, $9, $10),
         ($11, $12, $13)`,
        [
          TENANT_1, `user_${i}_a`, `a${i}@t1.com`,
          `user_${i}_b`, `b${i}@t1.com`,
          TENANT_2, `user_${i}_c`, `c${i}@t2.com`,
          `user_${i}_d`, `d${i}@t2.com`,
          TENANT_3, `user_${i}_e`, `e${i}@t3.com`,
        ],
      );
    }
    await adminClient.query('COMMIT');
  } catch (err) {
    await adminClient.query('ROLLBACK');
    throw err;
  }
}

async function printEnvironment(adminClient: Client): Promise<void> {
  const postgres = await adminClient.query('SHOW server_version');
  let prismaVersion = 'unknown';
  try {
    prismaVersion = require('@prisma/client/package.json').version;
  } catch {
    // Keep benchmark runnable even when package metadata is unavailable.
  }

  console.log('Environment:');
  console.log(`  Node: ${process.version}`);
  console.log(`  Platform: ${process.platform} ${process.arch}`);
  console.log(`  CPU: ${os.cpus()[0]?.model ?? 'unknown'}`);
  console.log(`  PostgreSQL: ${postgres.rows[0]?.server_version ?? 'unknown'}`);
  console.log(`  Prisma Client: ${prismaVersion}`);
  console.log(`  Warmup: ${WARMUP} | Iterations: ${ITERATIONS}\n`);
}

async function findManyWithManualRls(prisma: PrismaClientLike): Promise<unknown[]> {
  const [, rows] = await prisma.$transaction([
    prisma.$executeRaw`SELECT set_config(${DEFAULT_DB_SETTING_KEY}, ${TENANT_1}, TRUE)`,
    prisma.user.findMany(),
  ]);

  return rows as unknown[];
}

async function runWithTenant<T>(
  context: TenancyContext,
  task: () => Promise<T>,
): Promise<T> {
  return context.run(TENANT_1, async () => {
    // PrismaPromise execution must be awaited inside the ALS callback.
    const result = await task();
    return result;
  });
}

async function main() {
  console.log('=== @nestarc/tenancy Benchmark ===\n');

  // --- Setup ---
  console.log('Setting up database...');
  const adminClient = new Client({ connectionString: ADMIN_URL });
  await adminClient.connect();

  const setupSql = fs.readFileSync(
    path.join(__dirname, '..', 'test', 'e2e', 'setup.sql'),
    'utf-8',
  );
  await adminClient.query(setupSql);
  await seedBenchmarkRows(adminClient);

  const countResult = await adminClient.query('SELECT count(*) FROM users');
  console.log(`Total rows: ${countResult.rows[0].count}\n`);
  await printEnvironment(adminClient);

  // --- Prisma generate ---
  console.log('Generating Prisma client...');
  const schemaPath = path.join(__dirname, '..', 'test', 'e2e', 'schema.prisma');
  execFileSync('npx', ['prisma', 'generate', `--schema=${schemaPath}`], {
    env: { ...process.env, DATABASE_URL: APP_URL },
    stdio: 'inherit',
  });

  const generatedPath = path.join(__dirname, '..', 'test', 'e2e', 'generated', 'client');
  const { PrismaClient } = require(generatedPath) as { PrismaClient: PrismaClientConstructor };

  const prismaAdmin = createClient(PrismaClient, ADMIN_URL);
  await prismaAdmin.$connect();

  const prismaAppManual = createClient(PrismaClient, APP_URL);
  await prismaAppManual.$connect();

  const context = new TenancyContext();
  const service = new TenancyService(context);
  const prismaBase = createClient(PrismaClient, APP_URL);
  const prismaWithExt = prismaBase.$extends(createPrismaTenancyExtension(service));
  await prismaWithExt.$connect();

  // --- Benchmarks ---
  const adminAllRows = await runBenchmark(
    'A) Admin direct findMany (all rows, no RLS)',
    () => prismaAdmin.user.findMany(),
  );

  const adminTenantFilter = await runBenchmark(
    'B) Admin tenant-filtered findMany (WHERE tenant_id, no RLS)',
    () => prismaAdmin.user.findMany({ where: { tenant_id: TENANT_1 } }),
  );

  const manualRls = await runBenchmark(
    'C) app_user manual RLS transaction (set_config + findMany)',
    () => findManyWithManualRls(prismaAppManual),
  );

  const extensionRls = await runBenchmark(
    'D) app_user tenancy extension findMany',
    () => runWithTenant(context, () => prismaWithExt.user.findMany()),
  );

  const extensionFindFirst = await runBenchmark(
    'E) app_user tenancy extension findFirst',
    () => runWithTenant(context, () => prismaWithExt.user.findFirst()),
  );

  // --- Results ---
  const results = [
    adminAllRows,
    adminTenantFilter,
    manualRls,
    extensionRls,
    extensionFindFirst,
  ];

  const extensionOverhead = extensionRls.avgMs - manualRls.avgMs;
  const extensionP95Overhead = extensionRls.p95Ms - manualRls.p95Ms;
  const rlsCost = manualRls.avgMs - adminTenantFilter.avgMs;

  console.log('\n' + '='.repeat(78));
  console.log('RESULTS');
  console.log('='.repeat(78));

  for (const r of results) {
    console.log(`\n${r.label}`);
    console.log(`  Iterations: ${r.iterations} | Rows: ${r.rowCount}`);
    console.log(`  Avg: ${r.avgMs}ms | P50: ${r.p50Ms}ms | P95: ${r.p95Ms}ms | P99: ${r.p99Ms}ms`);
    console.log(`  Min: ${r.minMs}ms | Max: ${r.maxMs}ms`);
  }

  console.log('\n' + '-'.repeat(78));
  console.log(`Extension overhead vs manual RLS transaction (avg): ${formatDelta(extensionOverhead, manualRls.avgMs)}`);
  console.log(`Extension overhead vs manual RLS transaction (p95): ${formatSigned(extensionP95Overhead)}ms`);
  console.log(`RLS + transaction cost vs admin tenant-filtered query (avg): ${formatDelta(rlsCost, adminTenantFilter.avgMs)}`);
  console.log('Admin all-rows result is context only; it is not used as the extension overhead baseline.');
  console.log('-'.repeat(78));

  // --- Cleanup ---
  await prismaAdmin.$disconnect();
  await prismaAppManual.$disconnect();
  await prismaWithExt.$disconnect();
  await adminClient.query('DROP TABLE IF EXISTS users CASCADE');
  await adminClient.end();

  console.log('\nDone.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
