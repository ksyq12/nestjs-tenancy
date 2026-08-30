import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ApiKeysService } from '@nestarc/api-keys';
import { JobsService } from '@nestarc/jobs';
import { RbacService } from '@nestarc/rbac';
import {
  WebhookDeliveryWorker,
  WebhookEndpointAdminService,
} from '@nestarc/webhook';
import { Client } from 'pg';
import request from 'supertest';
import { EcosystemModule } from '../src/ecosystem.module';
import { prisma, TENANT_A, TENANT_B } from '../src/runtime';

type ReceivedWebhook = {
  path: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
};

const expectedPackages = {
  '@nestarc/tenancy': '0.16.0',
  '@nestarc/api-keys': '0.3.2',
  '@nestarc/rbac': '0.2.1',
  '@nestarc/jobs': '0.3.1',
  '@nestarc/outbox': '0.2.1',
  '@nestarc/webhook': '0.13.1',
};
const received: ReceivedWebhook[] = [];
let receiver: Server | undefined;
let receiverBaseUrl: string;
let app: INestApplication;
let keyA: { id: string; key: string };
let keyB: { id: string; key: string };
let deniedKey: { id: string; key: string };

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for ecosystem side effect');
}

async function setupDatabase(): Promise<void> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const sql = await readFile(path.join(__dirname, 'setup.sql'), 'utf8');
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function countProjectsAsOwner(): Promise<bigint> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const result = await client.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM ecosystem_projects',
    );
    return BigInt(result.rows[0]?.count ?? '0');
  } finally {
    await client.end();
  }
}

function startReceiver(): Promise<void> {
  const server = createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      received.push({
        path: req.url ?? '/',
        headers: req.headers,
        body: JSON.parse(raw) as Record<string, unknown>,
      });
      res.statusCode = 204;
      res.end();
    });
  });
  receiver = server;

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      receiverBaseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
}

function closeReceiver(): Promise<void> {
  const server = receiver;
  if (!server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

describe('installed modern Nestarc ecosystem compatibility fixture', () => {
  beforeAll(async () => {
    await setupDatabase();
    await startReceiver();

    const moduleRef = await Test.createTestingModule({
      imports: [EcosystemModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const apiKeys = app.get(ApiKeysService);
    keyA = await apiKeys.create({
      tenantId: TENANT_A,
      name: 'tenant-a',
      scopes: [{ resource: 'projects', level: 'write' }],
    });
    keyB = await apiKeys.create({
      tenantId: TENANT_B,
      name: 'tenant-b',
      scopes: [{ resource: 'projects', level: 'write' }],
    });
    deniedKey = await apiKeys.create({
      tenantId: TENANT_A,
      name: 'tenant-a-no-role',
      scopes: [{ resource: 'projects', level: 'write' }],
    });

    const rbac = app.get(RbacService);
    for (const [tenantId, key] of [
      [TENANT_A, keyA],
      [TENANT_B, keyB],
    ] as const) {
      const role = await rbac.createRole({
        tenantId,
        key: 'project-editor',
        permissions: ['projects.create', 'projects.read'],
      });
      await rbac.assignRole({
        tenantId,
        subject: { type: 'api_key', id: key.id, tenantId },
        roleKey: role.key,
      });
    }

    const endpoints = app.get(WebhookEndpointAdminService);
    await endpoints.createEndpoint({
      url: `${receiverBaseUrl}/tenant-a`,
      events: ['project.created'],
      tenantId: TENANT_A,
      secret: 'auto',
    });
    await endpoints.createEndpoint({
      url: `${receiverBaseUrl}/tenant-b`,
      events: ['project.created'],
      tenantId: TENANT_B,
      secret: 'auto',
    });
  });

  afterAll(async () => {
    await app?.close();
    await prisma.$disconnect();
    await closeReceiver();
  });

  it('loads every package from the isolated published artifact graph', () => {
    expect(process.env.ECOSYSTEM_MODE).toBe('modern-published-only');
    const fixtureManifest = JSON.parse(
      readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'),
    );
    const fixtureLock = JSON.parse(
      readFileSync(path.join(process.cwd(), 'package-lock.json'), 'utf8'),
    );

    for (const [packageName, version] of Object.entries(expectedPackages)) {
      const requested = fixtureManifest.dependencies[packageName];
      const lockEntry = fixtureLock.packages[`node_modules/${packageName}`];
      const entry = require.resolve(packageName);
      const manifest = require(
        path.join(
          entry.slice(0, entry.lastIndexOf(`${path.sep}dist${path.sep}`)),
          'package.json',
        ),
      );
      expect(requested).toBe(version);
      expect(manifest.name).toBe(packageName);
      expect(manifest.version).toBe(version);
      expect(entry).toContain(`${path.sep}node_modules${path.sep}`);
      expect(lockEntry.version).toBe(version);
      expect(lockEntry.resolved).toMatch(/^https:\/\/registry\.npmjs\.org\//);
      expect(lockEntry.integrity).toMatch(/^sha512-/);
      expect(lockEntry.link).not.toBe(true);
    }
  });

  it('propagates tenant identity through RBAC, RLS, outbox, jobs, and webhooks', async () => {
    const server = app.getHttpServer();
    const createdA = await request(server)
      .post('/projects')
      .set('Authorization', `Bearer ${keyA.key}`)
      .send({ name: 'Alpha' })
      .expect(201);
    const createdB = await request(server)
      .post('/projects')
      .set('Authorization', `Bearer ${keyB.key}`)
      .send({ name: 'Beta' })
      .expect(201);

    const listA = await request(server)
      .get('/projects')
      .set('Authorization', `Bearer ${keyA.key}`)
      .expect(200);
    const listB = await request(server)
      .get('/projects')
      .set('Authorization', `Bearer ${keyB.key}`)
      .expect(200);
    expect(listA.body.map((project: { id: string }) => project.id)).toEqual([
      createdA.body.id,
    ]);
    expect(listB.body.map((project: { id: string }) => project.id)).toEqual([
      createdB.body.id,
    ]);

    await waitFor(async () => {
      const rows = await prisma.$queryRaw<Array<{ status: string }>>`
        SELECT status FROM outbox_events ORDER BY created_at
      `;
      return rows.length === 2 && rows.every((row) => row.status === 'SENT');
    });

    const jobs = app.get(JobsService);
    const outboxRows = await prisma.$queryRaw<
      Array<{ id: string; tenantId: string; payload: Record<string, unknown> }>
    >`
      SELECT id, tenant_id AS "tenantId", payload
      FROM outbox_events ORDER BY created_at
    `;
    for (const row of outboxRows) {
      await waitFor(async () => {
        const status = (await jobs.getJob(row.id))?.status;
        return (
          status === 'succeeded' ||
          status === 'failed' ||
          status === 'dead_letter'
        );
      });
      const job = await jobs.getJob(row.id);
      expect(job?.error).toBeUndefined();
      expect(job).toMatchObject({ status: 'succeeded' });
      expect(job?.context).toMatchObject({
        tenantId: row.tenantId,
        outboxEventId: row.id,
      });
    }

    await waitFor(async () => {
      const events = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count FROM webhook_events
      `;
      return events[0]?.count === 2n;
    });
    await app.get(WebhookDeliveryWorker).poll();
    await waitFor(() => received.length === 2);

    const byPath = Object.fromEntries(
      received.map((delivery) => [delivery.path, delivery]),
    );
    expect(byPath['/tenant-a'].body).toMatchObject({
      type: 'project.created',
      data: {
        projectId: createdA.body.id,
        name: 'Alpha',
        observedTenantId: TENANT_A,
      },
    });
    expect(byPath['/tenant-b'].body).toMatchObject({
      type: 'project.created',
      data: {
        projectId: createdB.body.id,
        name: 'Beta',
        observedTenantId: TENANT_B,
      },
    });
    expect(byPath['/tenant-a'].headers['webhook-signature']).toBeDefined();
    expect(byPath['/tenant-b'].headers['webhook-signature']).toBeDefined();
  });

  it('fails closed before data or side effects on invalid context', async () => {
    const server = app.getHttpServer();
    const beforeProjects = await countProjectsAsOwner();
    const beforeOutbox = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM outbox_events
    `;
    expect(beforeProjects).toBe(2n);

    await request(server).post('/projects').send({ name: 'Missing' }).expect(401);
    await request(server)
      .post('/projects')
      .set('Authorization', `Bearer ${keyA.key}`)
      .set('X-Tenant-Id', TENANT_B)
      .send({ name: 'Forged' })
      .expect(403);
    await request(server)
      .post('/projects')
      .set('Authorization', `Bearer ${deniedKey.key}`)
      .send({ name: 'Denied' })
      .expect(403);

    const afterProjects = await countProjectsAsOwner();
    const afterOutbox = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM outbox_events
    `;
    expect(afterProjects).toBe(beforeProjects);
    expect(afterOutbox[0]?.count).toBe(beforeOutbox[0]?.count);
    expect(received).toHaveLength(2);
  });
});
