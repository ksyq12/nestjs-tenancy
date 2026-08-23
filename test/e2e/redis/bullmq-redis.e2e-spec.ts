import { Queue, QueueEvents, Worker } from 'bullmq';
import Redis from 'ioredis';
import { TenantContextDiagnostics } from '../../../src/diagnostics/tenant-context-diagnostics';
import type { MissingTenantContextDiagnostic } from '../../../src/diagnostics/tenant-context-diagnostics';
import { BullTenantPropagator } from '../../../src/propagation/bull-tenant-propagator';
import { TenantResourceKey } from '../../../src/resources/tenant-resource-key';
import { TenancyContext } from '../../../src/services/tenancy-context';

const redisUrl = process.env.REDIS_URL ?? 'redis://127.0.0.1:6380';
const parsedRedisUrl = new URL(redisUrl);
const connection = {
  host: parsedRedisUrl.hostname,
  port: Number(parsedRedisUrl.port || 6379),
  ...(parsedRedisUrl.password ? { password: parsedRedisUrl.password } : {}),
};

describe('BullMQ/Redis tenant context diagnostics', () => {
  const queueName = `tenancy-context-${process.pid}`;
  const context = new TenancyContext();
  const diagnosticsReceived: MissingTenantContextDiagnostic[] = [];
  const diagnostics = new TenantContextDiagnostics({
    policy: 'throw',
    onMissing: (diagnostic) => diagnosticsReceived.push(diagnostic),
  });
  const propagator = new BullTenantPropagator(context, {
    resource: 'orders',
    diagnostics,
  });
  const resourceKeys = new TenantResourceKey(context, {
    transport: 'redis',
    resource: 'order-results',
    diagnostics,
  });

  let redis: Redis;
  let queue: Queue;
  let queueEvents: QueueEvents;
  let worker: Worker;
  let processorCalls = 0;

  beforeAll(async () => {
    redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
    queue = new Queue(queueName, { connection });
    queueEvents = new QueueEvents(queueName, { connection });
    await queueEvents.waitUntilReady();

    worker = new Worker(
      queueName,
      async (job) => {
        const tenantId = propagator.extract(job.data);
        processorCalls += 1;
        return context.run(tenantId!, async () => {
          const key = resourceKeys.create(`job:${job.name}`);
          await redis.set(key!, String(job.data.value));
          return { tenantId, key, value: await redis.get(key!) };
        });
      },
      { connection },
    );
    await worker.waitUntilReady();
  });

  beforeEach(async () => {
    diagnosticsReceived.length = 0;
    processorCalls = 0;
    await queue.drain(true);
    await redis.flushdb();
  });

  afterAll(async () => {
    await worker.close();
    await queueEvents.close();
    await queue.close();
    await redis.quit();
  });

  it('propagates tenant context and writes isolated keys in real Redis', async () => {
    const jobA = await context.run('tenant-a', () =>
      queue.add('same-resource', propagator.inject({ value: 'A' })),
    );
    const jobB = await context.run('tenant-b', () =>
      queue.add('same-resource', propagator.inject({ value: 'B' })),
    );

    await expect(jobA.waitUntilFinished(queueEvents, 10_000)).resolves.toEqual({
      tenantId: 'tenant-a',
      key: 'tenant:8:tenant-a:job:same-resource',
      value: 'A',
    });
    await expect(jobB.waitUntilFinished(queueEvents, 10_000)).resolves.toEqual({
      tenantId: 'tenant-b',
      key: 'tenant:8:tenant-b:job:same-resource',
      value: 'B',
    });

    await expect(redis.mget(
      'tenant:8:tenant-a:job:same-resource',
      'tenant:8:tenant-b:job:same-resource',
    )).resolves.toEqual(['A', 'B']);
    expect(diagnosticsReceived).toEqual([]);
  });

  it('prevents enqueue when producer context is missing under throw policy', async () => {
    await expect(queue.getJobCounts('waiting', 'active')).resolves.toEqual({
      waiting: 0,
      active: 0,
    });

    expect(() => propagator.inject({ value: 'unscoped' })).toThrow(
      'Tenant context is missing during bull.inject for resource "orders"',
    );

    await expect(queue.getJobCounts('waiting', 'active')).resolves.toEqual({
      waiting: 0,
      active: 0,
    });
    expect(diagnosticsReceived).toEqual([{
      transport: 'bull', operation: 'inject', resource: 'orders',
    }]);
  });

  it('fails an unscoped raw job before its processor can access Redis', async () => {
    const job = await queue.add('unscoped', { value: 'unsafe' });

    await expect(job.waitUntilFinished(queueEvents, 10_000)).rejects.toThrow(
      'Tenant context is missing during bull.extract for resource "orders"',
    );
    expect(processorCalls).toBe(0);
    await expect(redis.keys('tenant:*')).resolves.toEqual([]);
    expect(diagnosticsReceived).toEqual([{
      transport: 'bull', operation: 'extract', resource: 'orders',
    }]);
  });
});
