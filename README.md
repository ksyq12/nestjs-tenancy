# @nestarc/tenancy

[![npm version](https://img.shields.io/npm/v/@nestarc/tenancy.svg)](https://www.npmjs.com/package/@nestarc/tenancy)
[![npm downloads](https://img.shields.io/npm/dm/@nestarc/tenancy.svg)](https://www.npmjs.com/package/@nestarc/tenancy)
[![CI](https://github.com/nestarc/nestjs-tenancy/actions/workflows/ci.yml/badge.svg)](https://github.com/nestarc/nestjs-tenancy/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Docs](https://img.shields.io/badge/docs-nestarc.dev-blue.svg)](https://nestarc.dev/packages/tenancy/)

Multi-tenancy module for NestJS with **PostgreSQL Row Level Security (RLS)** and **Prisma** support.

One line of code. Automatic tenant isolation.

## Features

- **RLS-based isolation** — PostgreSQL enforces tenant boundaries at the database level
- **AsyncLocalStorage** — Zero-overhead request-scoped tenant context (no `REQUEST` scope)
- **Prisma Client Extensions** — Automatic transaction-local `set_config()` for tenant-scoped Prisma model operations
- **5 built-in extractors** — Header, Subdomain, JWT Claim, Path, Composite (fallback chain)
- **Lifecycle hooks** — `onTenantResolved` / `onTenantNotFound` for logging, auditing, custom error handling
- **Auto-inject tenant ID** — Optionally inject `tenant_id` into `create` / `createMany` / `upsert` operations
- **Shared models** — Whitelist models that skip RLS (e.g., `Country`, `Currency`)
- **`withoutTenant()`** — programmatic bypass for background jobs and admin queries
- **`tenancyTransaction()`** — interactive transaction support with RLS
- **Fail-Closed mode** — `failClosed: true` blocks model queries without tenant context, preventing accidental data exposure
- **Testing utilities** — `TestTenancyModule`, `withTenant()`, `expectTenantIsolation()` via `@nestarc/tenancy/testing`
- **Event system** — optional `@nestjs/event-emitter` integration for `tenant.resolved`, `tenant.not_found`, etc.
- **Microservice propagation** — HTTP (`propagateTenantHeaders()`), Bull, Kafka, gRPC propagators with zero transport dependencies
- **Inbound context restoration** — `TenantContextInterceptor` auto-restores tenant context from incoming microservice messages
- **Error hierarchy** — `TenantContextMissingError` base class enables unified `instanceof` catch handling
- **CLI scaffolding** — `npx @nestarc/tenancy init` generates RLS policies and module config
- **CLI drift detection** — `npx @nestarc/tenancy check` validates SQL against Prisma schema
- **Live DB doctor** — `npx @nestarc/tenancy doctor` audits the runtime role, RLS catalogs, policy drift, and optional fail-closed behavior
- **PgBouncer matrix** — transaction-mode isolation, forced backend reuse/replacement, and Prisma 6/7 are covered by a real-database CI matrix
- **Multi-schema support** — `@@schema()` directives generate schema-qualified SQL (e.g., `"auth"."users"`)
- **ccTLD-aware subdomain extraction** — accurate parsing for `.co.uk`, `.co.jp`, `.com.au`, etc.
- **Framework-agnostic** — public API uses `TenancyRequest` / `TenancyResponse` instead of Express types. Works with Express, Fastify, and raw Node.js HTTP
- **SQL injection safe** — `set_config()` with bind parameters, plus HTTP UUID-like validation by default and explicit RPC validation during 0.x
- **NestJS 10 & 11** compatible, **Prisma 7 first-class** with a Prisma 6 compatibility lane

## Performance

The benchmark separates extension overhead from row-count and database-role effects:

| Scenario | Purpose |
|----------|---------|
| Admin direct `findMany` over all rows | Context only; not used as the extension overhead baseline |
| Admin tenant-filtered `findMany` with `WHERE tenant_id` | Same returned row count with RLS bypassed |
| `app_user` manual RLS transaction | `set_config` + query, no extension |
| `app_user` tenancy extension `findMany` | Same role, RLS policy, and returned row count as the manual RLS transaction |
| `app_user` tenancy extension `findFirst` | Single-row reference path |

The headline number is `extension findMany - manual RLS transaction`, not extension vs unfiltered admin query. The script prints row counts, Node/PostgreSQL/Prisma versions, and p50/p95/p99 timings so results can be compared across environments.

Example result from Apple M1 Pro, Node v24.11.1, PostgreSQL 16.14, Prisma Client 7.9.1, 1005 total rows, 500 measured iterations:

| Scenario | Rows | Avg | P50 | P95 | P99 |
|----------|------|-----|-----|-----|-----|
| Admin direct `findMany` (all rows, no RLS) | 1005 | 1.779ms | 1.585ms | 3.199ms | 5.261ms |
| Admin tenant-filtered `findMany` (`WHERE tenant_id`, no RLS) | 402 | 1.081ms | 0.972ms | 1.643ms | 3.616ms |
| `app_user` manual RLS transaction (`set_config` + `findMany`) | 402 | 2.375ms | 2.253ms | 3.057ms | 5.337ms |
| `app_user` tenancy extension `findMany` | 402 | 2.372ms | 2.276ms | 2.891ms | 5.987ms |
| `app_user` tenancy extension `findFirst` | 1 | 1.605ms | 1.561ms | 2.209ms | 2.695ms |

Measured extension overhead: **-0.003ms avg (-0.1%)**, **-0.166ms p95** compared with the manual RLS transaction. Treat sub-millisecond differences as run-to-run noise; the important result is that the extension remains on par with the equivalent manual transaction.

> Reproduce: `docker compose up -d --wait && npm run bench`

## Prerequisites

- Node.js 22.13 or newer within Node 22, or Node.js 24
- NestJS 10 or 11
- Prisma 7 (recommended) or Prisma 6
- PostgreSQL (with RLS support). Use a patched minor release: CVE-2024-10976 is fixed in PostgreSQL 17.1, 16.5, 15.9, 14.14, 13.17, and 12.21.

## Support and Compatibility

`@nestarc/tenancy` is pre-1.0. Security fixes are provided for the latest
published minor release line only; `0.15.x` is the current supported line. See
the [security policy](./SECURITY.md) for reporting and response targets.

Package compatibility ranges and repository verification are related, but
they are not the same claim:

| Area | Unreleased contract in this source tree | Current repository evidence |
|------|--------------------|----------------------------------------|
| Node.js | `^22.13.0 \|\| ^24.0.0` | Lint, unit/coverage, and build run on exact 22.13.0, the current Node 22 release, and the current Node 24 release. Database and infrastructure jobs run on current Node 22; publishing runs on current Node 24. |
| NestJS | Peer range `^10.0.0 \|\| ^11.0.0` | A strict, isolated packed-tarball consumer matrix covers exact NestJS 10.4.22 and 11.2.1 across both supported Prisma majors on current Node 22. The locked primary graph uses NestJS 11.2.1, and the ecosystem fixture uses exact NestJS 10.4.20. |
| Prisma | Peer range `^6.0.0 \|\| ^7.0.0` | The packed consumer matrix covers exact Prisma 6.19.3 and 7.10.0 with each supported NestJS major. The locked primary and direct PostgreSQL lanes use 7.10.0, the PgBouncer matrix uses both exact versions, and the ecosystem lane uses 6.19.3. |

The four-way consumer matrix installs the actual packed tarball with
`--strict-peer-deps` and without `--force`, `--legacy-peer-deps`, or another
peer bypass, then runs declaration typechecking and a minimal Nest/Prisma
runtime smoke. Its Nest 10 + Prisma 6 lane
also verifies the optional cache/event lower-bound representatives
`@nestjs/cache-manager@2.0.0`, `cache-manager@5.0.0`, and
`@nestjs/event-emitter@2.0.0` with `reflect-metadata@0.1.13`; its Nest 11 +
Prisma 7 lane verifies the repository-locked supported representatives 3.1.3,
7.2.8, and 3.1.0 respectively with `reflect-metadata@0.2.2`. The latter fixture
also pins `keyv@5.6.0` and `cacheable@2.5.0` so the cache module's peer and
declaration dependencies are reproducible. Optional peer ranges are not an
arbitrary cross-product: cache module 2 pairs with cache-manager 5, cache module
3 pairs with cache-manager 6/7, event-emitter 2 is verified on NestJS 10, and
event-emitter 3 supports NestJS 10/11. These exact versions describe the
top-level lane targets, not new patch-level minimums inside the declared peer
ranges. Each run intentionally resolves a fresh transitive graph so CI detects
upstream install drift; it is not a byte-for-byte frozen dependency snapshot.
Prisma data-path behavior remains the responsibility of the direct
PostgreSQL and Prisma 6/7 PgBouncer lanes rather than being duplicated in every
install-only consumer lane. Already-published 0.15.x artifacts retain their
Node.js `>=20.19.0`
metadata, but Node.js 20 is [upstream EOL](https://nodejs.org/en/about/previous-releases)
and is no longer supported by this source tree. The Node floor change is a
breaking pre-1.0 change planned for 0.16.0; Node 20 consumers must upgrade their
runtime or remain on 0.15.x. Publishing 0.16.0 remains on hold until the tracked
sibling-package compatibility evidence is complete. Node 26 support is not yet
declared and requires separate validation.

The Nestarc ecosystem gate is also artifact-explicit. Hosted CI and release
validation run the committed `published-only` lock for tenancy, API Keys, RBAC,
Jobs, Outbox, and Webhook. An unpublished tenancy tarball is tested separately
with `npm run test:e2e:ecosystem:local-artifact -- --tenancy-tarball <absolute.tgz>`;
only tenancy is replaced, while the five sibling packages remain registry-locked. The
runner records and asserts each installed package's name, version, source, and
integrity, and never discovers adjacent repositories automatically. See the
[fixture contract](./test/ecosystem/fixture/README.md) for exact commands.

The automatic tenant-isolation guarantee does not currently cover:

- Raw Prisma operations (`$queryRaw` / `$executeRaw`), which bypass the model extension.
- WebSocket inbound tenant enforcement or context restoration; the supported non-HTTP transports are Kafka, Bull, and gRPC.
- Prisma Data Proxy, managed poolers, or custom PgBouncer configurations. These remain outside the repository support guarantee; deployment owners must validate their exact configuration with equivalent matrix scenarios.

See [Fail-Closed Mode](#fail-closed-mode), [Inbound Context Restoration](#inbound-context-restoration-interceptor), and the [PgBouncer Support Contract](#pgbouncer-support-contract) for the corresponding operational requirements.

## Installation

```bash
npm install @nestarc/tenancy
npm install @prisma/client @prisma/adapter-pg pg dotenv
npm install --save-dev prisma
```

## Quick Start

### 1. Enable RLS on your PostgreSQL tables

Every table that needs tenant isolation must have a `tenant_id` column and an RLS policy:

```sql
-- Ensure your table has a tenant_id column
ALTER TABLE users ADD COLUMN tenant_id TEXT NOT NULL;

-- Enable RLS (FORCE ensures table owners also obey policies)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;

-- Add an index for the policy column to avoid full table scans
CREATE INDEX IF NOT EXISTS tenancy_users_tenant_id_idx ON users (tenant_id);

-- Create isolation policy
CREATE POLICY tenant_isolation ON users
  USING (tenant_id = current_setting('app.current_tenant', true)::text);

-- Keep a reset transaction-local setting from matching an empty TEXT tenant.
-- AS RESTRICTIVE combines this guard with every permissive tenant policy.
CREATE POLICY tenant_context_guard_users ON users
  AS RESTRICTIVE
  USING (NULLIF(current_setting('app.current_tenant', true), '') IS NOT NULL)
  WITH CHECK (NULLIF(current_setting('app.current_tenant', true), '') IS NOT NULL);

-- The `true` parameter means missing_ok: returns NULL instead of error when unset.
-- The restrictive guard also treats PostgreSQL's reset empty string as no context.
-- At the database layer, queries without tenant context return 0 rows (not an error).
-- Repeat for each tenant-scoped table
```

This example uses a PostgreSQL `TEXT` tenant column. For a native `UUID`
column, keep the column side uncast so PostgreSQL can use the tenant index and
use the generated UUID predicate:

```sql
USING (
  tenant_id = NULLIF(current_setting('app.current_tenant', true), '')::uuid
);
```

`NULLIF(..., '')` preserves fail-closed behavior after a transaction-local
custom setting is cleaned up and PostgreSQL exposes its reset value as an empty
string. For UUID it prevents an invalid reset-value cast; for TEXT the generated
restrictive policy prevents that reset value from matching or inserting an
empty tenant ID. A missing or reset setting therefore matches no row.

> **Critical:** RLS is bypassed by superusers and (without `FORCE ROW LEVEL SECURITY`) by table owners. Create a dedicated application role that does **not** own the tables:
> ```sql
> CREATE ROLE app_user LOGIN PASSWORD 'your_password';
> GRANT USAGE ON SCHEMA public TO app_user;
> GRANT SELECT, INSERT, UPDATE, DELETE ON your_table TO app_user;
> ```
> Use this role's connection string in your application. If you connect as a superuser, RLS policies are silently bypassed.

### 2. Register the module

```typescript
import { TenancyModule } from '@nestarc/tenancy';

@Module({
  imports: [
    TenancyModule.forRoot({
      tenantExtractor: 'X-Tenant-Id', // header name
    }),
  ],
})
export class AppModule {}
```

### 3. Extend your Prisma client

Configure Prisma 7 to generate the client into your source tree and keep the connection URL in Prisma Config:

```prisma
generator client {
  provider = "prisma-client"
  output   = "../src/generated/prisma"
}

datasource db {
  provider = "postgresql"
}
```

```typescript
// prisma.config.ts
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  datasource: {
    url: env('DATABASE_URL'),
  },
});
```

Run `npx prisma generate`, then extend the generated client:

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from './generated/prisma/client';
import {
  TenancyService,
  createPrismaTenancyExtension,
  tenancyTransaction,
  type TenancyTransactionOptions,
} from '@nestarc/tenancy';

@Injectable()
export class PrismaService implements OnModuleInit {
  private readonly baseClient;
  public readonly client;

  constructor(private readonly tenancyService: TenancyService) {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL!,
    });
    this.baseClient = new PrismaClient({ adapter });
    this.client = this.baseClient.$extends(
      createPrismaTenancyExtension(tenancyService),
    );
  }

  withTenantTransaction<T>(
    callback: (tx: Prisma.TransactionClient) => Promise<T>,
    options?: TenancyTransactionOptions,
  ): Promise<T> {
    return tenancyTransaction(
      this.baseClient,
      this.tenancyService,
      callback,
      options,
    );
  }

  async onModuleInit() {
    await this.client.$connect();
  }
}
```

The example uses the Prisma 7 `prisma-client` generator and its required PostgreSQL driver adapter. Prisma 6 consumers can keep their existing client construction and apply the same extension to their base client.

#### Extension Options

```typescript
createPrismaTenancyExtension(tenancyService, {
  autoInjectTenantId: true,            // Auto-inject tenant_id on create/upsert
  tenantIdField: 'tenant_id',          // Logical Prisma field name (default)
  sharedModels: ['Country', 'Currency'], // Models that skip RLS entirely
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dbSettingKey` | `string` | Inherited from `TenancyService` | Optional compatibility assertion; normally omit it in module-based applications. A mismatch fails before extension creation. |
| `autoInjectTenantId` | `boolean` | `false` | Auto-inject tenant ID into `create`, `createMany`, `createManyAndReturn`, `upsert` |
| `tenantIdField` | `string` | `'tenant_id'` | Logical Prisma field name to inject tenant ID into |
| `sharedModels` | `string[]` | `[]` | Models that bypass RLS (no `set_config`, no injection) |
| `failClosed` | `boolean` | `true` | Block queries when no tenant context is set (prevents accidental data exposure if RLS is misconfigured) |
| `interactiveTransactionSupport` | `boolean` | `false` | **Deprecated.** Compatibility-only transparent mode based on Prisma internals. Supported through v0.16.x; scheduled for removal in v0.17.0. Use `tenancyTransaction()` for interactive transactions |

> **Important:** Configure a custom `dbSettingKey` once in `TenancyModule.forRoot()` or `forRootAsync()`. `createPrismaTenancyExtension()` and `tenancyTransaction()` inherit the canonical value from `TenancyService`. An explicitly repeated identical value remains accepted for compatibility, while a different value fails before extension creation or transaction start. PostgreSQL RLS `current_setting()` calls must still use the same key.

> **Migration note:** Existing repeated identical values can be removed gradually. If a custom key currently exists only on the extension or helper, add it to `TenancyModule` before removing those options. Standalone consumers that construct `TenancyService` directly may continue to pass an explicit custom key. Changing the key itself also requires updating the RLS policies and passing the same `--db-setting-key` to `check` and `doctor`.

> **Note:** By default, the Prisma extension uses batch transactions internally, which do not propagate `set_config` into interactive transactions (`$transaction(async (tx) => ...)`). Use the `tenancyTransaction()` helper. The deprecated `interactiveTransactionSupport: true` mode remains only as a compatibility path through v0.16.x. See [Interactive Transactions](#interactive-transactions) below.

> **Migration note:** If you intentionally rely on model queries without tenant context falling through to PostgreSQL RLS, set `failClosed: false` explicitly. Prefer `sharedModels`, `withoutTenant()`, or a separate admin client for intentional unscoped access.

### Interactive Transactions

The default Prisma extension wraps queries in batch transactions, which breaks inside `$transaction(async (tx) => ...)`. Two approaches are available:

**Option 1: `tenancyTransaction()` helper (recommended)**

Uses only public Prisma APIs. The supported Prisma 6 and 7 majors are covered by the real-database PgBouncer matrix.

```typescript
const tenantId = tenancyService.getCurrentTenantOrThrow();

await prismaService.withTenantTransaction(async (tx) => {
  const user = await tx.user.findFirstOrThrow();
  await tx.order.create({ data: { userId: user.id, tenant_id: tenantId } });
}, {
  maxWait: 2_000,                 // Wait to start the transaction (ms)
  timeout: 5_000,                 // Maximum transaction duration (ms)
  isolationLevel: 'Serializable', // Optional PostgreSQL isolation level
});
```

`withTenantTransaction()` above is a narrow application wrapper around the
exported `tenancyTransaction()` helper. It keeps the raw client private so
ordinary application code cannot accidentally bypass the extension.

The helper forwards Prisma's public interactive transaction options (`maxWait`, `timeout`, and `isolationLevel`). It resolves the canonical database setting key and tenant before starting the transaction, applies transaction-local `set_config()` before invoking your callback, and propagates transaction-start, context-setup, callback, timeout, and database errors unchanged. A mismatched explicit key fails before `$transaction()` is called.

`maxWait` enforcement belongs to the Prisma runtime. The verified Prisma 7.10.0 `PrismaPg` adapter and Prisma 6.19.3 native engine reject when their client connection pool cannot start in time. Prisma 6.19.3 `PrismaPg` accepts the option but does not enforce it under adapter-pool contention; the matrix keeps this as a negative contract. If bounded transaction admission is required on Prisma 6, use the native engine or enforce admission before calling the helper.

The wrapper passes its raw, unextended Prisma client to the helper; direct helper
users must do the same. Use only the callback's `tx` client inside the
transaction. Because that transaction client does not run the extension's model
hooks, `autoInjectTenantId`, `sharedModels`, and `failClosed` do not apply there.
Writes must provide the configured logical tenant field explicitly (as above) or
use a reviewed database default; RLS still uses the transaction-local tenant
setting. The helper itself remains fail-closed: it calls
`getCurrentTenantOrThrow()` and rejects before opening `$transaction()` when
tenant context is missing.

> **Compatibility note:** `interactiveTransactionSupport: true` is deprecated because it relies on Prisma internal APIs. It remains supported through v0.16.x and is scheduled for removal in v0.17.0. Existing users should keep an exact-version E2E lane while migrating to `tenancyTransaction()`. See the [deprecated API removal ADR](https://github.com/nestarc/nestjs-tenancy/blob/main/docs/2026-08-30-deprecated-api-removal-adr.md) for a before/after migration and the transparent-mode differences.

**Option 2: Deprecated transparent compatibility mode**

This mode remains available for existing consumers, but is not recommended for new code. Startup checks the required `_createItxClient` hook, but cannot guarantee the full internal transaction metadata shape and can silently miss an interactive transaction after a Prisma internal change.

```typescript
const prisma = basePrisma.$extends(
  createPrismaTenancyExtension(tenancyService, {
    interactiveTransactionSupport: true,
  })
);
```

### 4. Use it

```typescript
import { Injectable } from '@nestjs/common';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    // Automatically filtered by RLS — only current tenant's data returned
    return this.prisma.client.user.findMany();
  }
}
```

Send requests with the tenant header:

```bash
curl -H "X-Tenant-Id: 550e8400-e29b-41d4-a716-446655440000" http://localhost:3000/users
```

Prisma model operations executed through the extension are automatically scoped
to that tenant via RLS. Raw operations are outside this automatic contract.

## API

### TenancyModule

```typescript
// Synchronous
TenancyModule.forRoot({
  tenantExtractor: 'X-Tenant-Id',           // header name (string)
  dbSettingKey: 'app.current_tenant',        // PostgreSQL setting (default)
  // Optional sync/async override; omitted HTTP validation uses a UUID-like format
  validateTenantId: (id) => /^org_[a-z0-9-]+$/.test(id),
})

// Async with factory
TenancyModule.forRootAsync({
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    tenantExtractor: config.get('TENANT_HEADER'),
  }),
})

// Async with class
TenancyModule.forRootAsync({
  useClass: TenancyConfigService,
})

// Async with existing provider
TenancyModule.forRootAsync({
  useExisting: TenancyConfigService,
})
```

### TenancyService

```typescript
@Injectable()
export class SomeService {
  constructor(private readonly tenancy: TenancyService) {}

  doSomething() {
    const tenantOrNull = this.tenancy.getCurrentTenant();    // string | null
    const tenantId = this.tenancy.getCurrentTenantOrThrow(); // string (throws if missing)
    const settingKey = this.tenancy.getDbSettingKey();       // canonical PostgreSQL setting
  }
}
```

### @CurrentTenant() Decorator

```typescript
import { Controller, Get } from '@nestjs/common';
import { CurrentTenant } from '@nestarc/tenancy';

@Controller('users')
export class UsersController {
  @Get('me')
  whoAmI(@CurrentTenant() tenantId: string) {
    return { tenantId };
  }
}
```

### @BypassTenancy() Decorator

Skip the `TenancyGuard` tenant-required check on specific routes (e.g., health checks, public endpoints).

> **Important:** `@BypassTenancy()` only bypasses the guard's tenant-required check. It does **not** clear tenant context. If a request includes a valid tenant header, downstream services and Prisma queries can still run inside that tenant context. Use `tenancyService.withoutTenant()` to explicitly run with no tenant context.

```typescript
import { Controller, Get } from '@nestjs/common';
import { BypassTenancy } from '@nestarc/tenancy';

@Controller('health')
export class HealthController {
  @BypassTenancy()
  @Get()
  check() {
    return { status: 'ok' }; // No tenant header required
  }
}
```

### Programmatic Bypass

Use `withoutTenant()` to clear the tenant context so the Prisma extension skips `set_config()`. With RLS enabled, this means queries return **0 rows** — `current_setting(..., true)` returns `NULL`, so the equality policy does not match any tenant row.

```typescript
// Background job — clears tenant context, Prisma extension skips set_config()
// With RLS enabled, queries return 0 rows (RLS blocks access when no tenant is set)
const result = await tenancyService.withoutTenant(async () => {
  return prisma.user.findMany(); // Returns 0 rows when RLS is active
});
```

`withoutTenant()` is primarily useful for:
- **Shared tables** (models listed in `sharedModels`) — RLS is not applied, so all rows are returned
- **Tenant lookup during login** — e.g., looking up a tenant record before the tenant context is established
- **Code that uses a separate admin connection** — see below

To actually query across all tenants, you need one of:

1. **A superuser/RLS-exempt database connection** — use a separate `PrismaClient` with admin credentials that bypasses RLS:

```typescript
@BypassTenancy()
@Get('/admin/users')
async listAllUsers() {
  return this.tenancyService.withoutTenant(async () => {
    return this.adminPrisma.user.findMany();
  });
}
```

2. **A PostgreSQL bypass policy** — add a policy that allows access when a bypass flag is set:

```sql
CREATE POLICY admin_bypass ON users
  USING (current_setting('app.bypass_rls', true) = 'on');
```

```typescript
// @BypassTenancy() bypasses the GUARD only (no 403 error).
// If a tenant header is present, Prisma still scopes to that tenant.
// If no tenant header is present, Prisma skips set_config() entirely.
@Get('/admin/users')
@BypassTenancy()
async getAllUsers() {
  // With X-Tenant-Id header: returns that tenant's data
  // Without X-Tenant-Id header: throws TenancyContextRequiredError by default
  // For true cross-tenant access, use withoutTenant() + admin connection
  return this.prisma.user.findMany();
}
```

### Tenant Extractors

Five built-in extractors cover common multi-tenancy patterns:

#### Header (default)

```typescript
TenancyModule.forRoot({
  tenantExtractor: 'X-Tenant-Id', // shorthand for HeaderTenantExtractor
})
```

#### Subdomain

```typescript
import { SubdomainTenantExtractor } from '@nestarc/tenancy';

TenancyModule.forRoot({
  tenantExtractor: new SubdomainTenantExtractor({
    excludeSubdomains: ['www', 'api'], // optional, defaults to ['www']
  }),
  validateTenantId: (id) => /^[a-z0-9-]+$/.test(id),
})
// tenant1.app.com → 'tenant1'
```

> **Note:** Uses the `psl` package for accurate ccTLD parsing (installed automatically as a dependency).

#### JWT Claim

```typescript
import { JwtClaimTenantExtractor } from '@nestarc/tenancy';

TenancyModule.forRoot({
  tenantExtractor: new JwtClaimTenantExtractor({
    claimKey: 'org_id',       // JWT payload key
    headerName: 'authorization', // optional, defaults to 'authorization'
  }),
})
// Authorization: Bearer eyJ... → payload.org_id
```

> **Security:** `JwtClaimTenantExtractor` decodes JWT claims and checks time-based claims such as `exp` / `nbf`, but it does **not** verify the JWT signature. Verify the token before tenant extraction, or validate the resolved tenant against authenticated user state in `onTenantResolved`.
>
> NestJS execution order is: **Middleware → Guards → Interceptors → Pipes**. Since `TenantMiddleware` runs at the middleware stage, a NestJS Guard (e.g., `@nestjs/passport` `AuthGuard`) runs *after* the tenant is already resolved and cannot protect it.
>
> **Middleware ordering:** `TenancyModule` registers `TenantMiddleware` globally via its own `configure()` call. To run JWT verification *before* tenant extraction, you have two options:
>
> **Option 1 (recommended) — Import an auth module before TenancyModule:**
>
> NestJS applies middleware in the order modules are initialized. If your auth middleware is registered in a module that is imported before `TenancyModule`, it will run first.
>
> ```typescript
> // auth.module.ts — registers JWT verification middleware globally
> @Module({})
> export class AuthModule implements NestModule {
>   configure(consumer: MiddlewareConsumer) {
>     consumer
>       .apply(JwtVerifyMiddleware) // verifies signature, populates req.user
>       .forRoutes('*');
>   }
> }
>
> // app.module.ts — import AuthModule BEFORE TenancyModule
> @Module({
>   imports: [
>     AuthModule,        // middleware runs first
>     TenancyModule.forRoot({
>       tenantExtractor: new JwtClaimTenantExtractor({ claimKey: 'org_id' }),
>     }),
>   ],
> })
> export class AppModule {}
> ```
>
> **Option 2 — Verify the JWT claim in `onTenantResolved`:**
>
> If you need to ensure the resolved tenant matches the authenticated user, use the `onTenantResolved` hook. This does not replace signature verification but lets you add an authorization check after extraction:
>
> ```typescript
> TenancyModule.forRoot({
>   tenantExtractor: new JwtClaimTenantExtractor({ claimKey: 'org_id' }),
>   onTenantResolved: (tenantId, req) => {
>     // req.user is populated by an upstream auth middleware
>     if (req.user?.org_id !== tenantId) {
>       throw new ForbiddenException('Tenant mismatch');
>     }
>   },
> })
> ```

#### Path Parameter

```typescript
import { PathTenantExtractor } from '@nestarc/tenancy';

TenancyModule.forRoot({
  tenantExtractor: new PathTenantExtractor({
    pattern: '/api/tenants/:tenantId/resources',
    paramName: 'tenantId',
  }),
})
// /api/tenants/acme/resources → 'acme'
```

#### Composite (Fallback Chain)

```typescript
import {
  CompositeTenantExtractor,
  HeaderTenantExtractor,
  SubdomainTenantExtractor,
  JwtClaimTenantExtractor,
} from '@nestarc/tenancy';

TenancyModule.forRoot({
  tenantExtractor: new CompositeTenantExtractor([
    new HeaderTenantExtractor('X-Tenant-Id'),
    new SubdomainTenantExtractor(),
    new JwtClaimTenantExtractor({ claimKey: 'org_id' }),
  ]),
})
// Tries each extractor in order, returns the first non-null result
```

#### Custom Extractor

```typescript
import { TenantExtractor, TenancyRequest } from '@nestarc/tenancy';

export class CookieTenantExtractor implements TenantExtractor {
  extract(request: TenancyRequest): string | null {
    return request.cookies?.['tenant_id'] ?? null;
  }
}
```

> **Framework-agnostic:** `TenancyRequest` is satisfied by Express `Request`, Fastify `FastifyRequest`, and any object with a `headers` property. If you need platform-specific properties, use type assertion: `(request as import('express').Request).ip`.

### Lifecycle Hooks

React to tenant resolution events without extending the middleware:

```typescript
TenancyModule.forRoot({
  tenantExtractor: 'X-Tenant-Id',
  onTenantResolved: async (tenantId, req) => {
    // Runs inside AsyncLocalStorage context — getCurrentTenant() works here
    logger.info({ tenantId, path: req.path }, 'tenant resolved');
    await auditService.recordAccess(tenantId);
  },
  onTenantNotFound: (req, res) => {
    // Option 1: Observation only (return void → next() is called)
    logger.warn({ path: req.path }, 'no tenant');

    // Option 2: Block the request (throw an exception)
    throw new ForbiddenException('Tenant header required');

    // Option 3: Return 'skip' to prevent next() — use res to send your own response
    res.status(401).json({ message: 'Tenant header required' });
    return 'skip';
  },
})
```

| Hook | Signature | When |
|------|-----------|------|
| `onTenantResolved` | `(tenantId: string, req: TenancyRequest) => void \| Promise<void>` | After successful extraction and validation |
| `onTenantNotFound` | `(req: TenancyRequest, res: TenancyResponse) => void \| 'skip' \| Promise<void \| 'skip'>` | When no tenant ID could be extracted |

## Error Responses

| Scenario | Status | Message |
|----------|--------|---------|
| Missing tenant header (no `@BypassTenancy`) | 403 | `Tenant ID is required` |
| Invalid tenant ID format | 400 | `Invalid tenant ID format` |
| Extractor throws or rejects | Propagates | Original error; emits `tenant.extraction_failed` first |
| Cross-check mismatch | 403 | `Tenant ID mismatch` |
| `crossCheck.required: true` and no secondary tenant source | 403 | `Cross-check source is required but returned null` |
| Prisma query without tenant context (`failClosed`, default) | Throws | `TenancyContextRequiredError` |
| WebSocket context | — | `TenancyGuard` skips it; no built-in restoration or enforcement |
| Kafka, Bull, or gRPC context | Policy-dependent | Configure `TenantContextInterceptor`; the HTTP guard does not handle RPC |
| Explicit Kafka, Bull, or gRPC validator returns/resolves `false` | Throws | `BadRequestException: Invalid tenant ID format`; handler is not invoked |
| Explicit Kafka, Bull, or gRPC validator throws/rejects | Propagates | Original validator error; handler is not invoked |

## Fail-Closed Mode

By default, model queries without a tenant context throw `TenancyContextRequiredError`. This avoids silent unscoped query paths when RLS is misconfigured or accidentally bypassed.

```typescript
const prisma = basePrisma.$extends(
  createPrismaTenancyExtension(tenancyService, {
    failClosed: true, // default
  })
);
```

Queries are still allowed when:
- The model is listed in `sharedModels`
- `withoutTenant()` is used (explicit bypass)

To restore the previous pass-through behavior, opt out explicitly:

```typescript
const prisma = basePrisma.$extends(
  createPrismaTenancyExtension(tenancyService, {
    failClosed: false,
  })
);
```

> **Scope**: `failClosed` applies to Prisma **model operations** (`findMany`, `create`, `update`, etc.). Raw queries (`$queryRaw`, `$executeRaw`) bypass the extension and are **not** covered. Use `tenancyTransaction()` and execute the raw operation through its transaction client, or use an equivalent explicit transaction that performs parameterized `set_config()` and the raw operation on the same transaction connection.

## Testing Utilities

Import from `@nestarc/tenancy/testing`:

```typescript
import { TestTenancyModule, withTenant, expectTenantIsolation } from '@nestarc/tenancy/testing';

// 1. Use TestTenancyModule in unit/integration tests (no middleware or guard)
const module = await Test.createTestingModule({
  imports: [TestTenancyModule.register()],
  providers: [MyService],
}).compile();

// 2. Run code in a tenant context
const result = await withTenant('tenant-1', () => service.findAll());

// 3. Assert tenant isolation in E2E tests
await expectTenantIsolation(prisma.user, 'tenant-a-uuid', 'tenant-b-uuid');
```

## Event System

Optional integration with `@nestjs/event-emitter`. Install the package and import `EventEmitterModule`:

```typescript
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TenancyEvents } from '@nestarc/tenancy';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    TenancyModule.forRoot({ tenantExtractor: 'x-tenant-id' }),
  ],
})
export class AppModule {}

// Listen for events anywhere in your app
@Injectable()
class TenantLogger {
  @OnEvent(TenancyEvents.RESOLVED)
  handleResolved({ tenantId }: { tenantId: string }) {
    console.log(`Tenant resolved: ${tenantId}`);
  }
}
```

Events: `tenant.resolved`, `tenant.not_found`, `tenant.extraction_failed`, `tenant.validation_failed`, `tenant.context_bypassed`, `tenant.cross_check_failed`, `tenant.context_missing`, `tenant.context_invalid`.

If `@nestjs/event-emitter` is not installed, events are silently skipped — no errors.

Built-in request-bearing event producers emit only `requestSummary` (`method`,
`path`, `ip`, `userAgent`, and `host`) so listeners do not accidentally retain credentials,
cookies, bodies, or framework-specific request references. The deprecated
optional `request` type field remains through v0.15.x for source compatibility
and is scheduled for removal in v0.16.0, but built-in middleware and guard
producers have not included the raw request object since v0.11.0. Migrate
listeners to the optional `event.requestSummary`; do not expect built-in
producers to populate `event.request`. Summary fields are observability metadata,
not authorization inputs, and applications should still apply their own
redaction and retention policy to values such as path, host, IP address, and
user agent. See
the [deprecated API removal ADR](https://github.com/nestarc/nestjs-tenancy/blob/main/docs/2026-08-30-deprecated-api-removal-adr.md) for the migration and privacy rationale.

## Tenant ID Forgery Prevention

Cross-validate the tenant ID against a secondary source to prevent header forgery:

```typescript
import { JwtClaimTenantExtractor } from '@nestarc/tenancy';

TenancyModule.forRoot({
  tenantExtractor: 'X-Tenant-Id',
  crossCheck: {
    extractor: new JwtClaimTenantExtractor({ claimKey: 'tenantId' }),
    onFailed: 'reject',  // 'reject' (default) | 'log'
    required: false,      // when true, rejects requests without cross-check source
  },
})
```

If the cross-check extractor returns `null` (e.g., no JWT present), validation is skipped by default — unauthenticated endpoints work normally. Set `required: true` to reject requests when the cross-check source is missing, enforcing that every request must have a verifiable secondary source. On mismatch, `tenant.cross_check_failed` event is emitted.

> **HTTP-only contract:** `crossCheck` and `onTenantResolved` are executed by `TenantMiddleware`. `TenantContextInterceptor` does not apply them to RPC messages, and they do not replace RPC producer authentication or authorization.

> **v0.12.0 migration:** The flat `crossCheckExtractor` / `onCrossCheckFailed` fields were removed. Use `crossCheck: { extractor, onFailed, required }`.

```typescript
// Before v0.12.0
TenancyModule.forRoot({
  tenantExtractor: 'X-Tenant-Id',
  crossCheckExtractor: new JwtClaimTenantExtractor({ claimKey: 'org_id' }),
  onCrossCheckFailed: 'reject',
});

// v0.12.0+
TenancyModule.forRoot({
  tenantExtractor: 'X-Tenant-Id',
  crossCheck: {
    extractor: new JwtClaimTenantExtractor({ claimKey: 'org_id' }),
    onFailed: 'reject',
  },
});
```

### Deprecation Policy

Deprecated public APIs are marked with `@deprecated` JSDoc and listed in the changelog. Unless a security issue requires faster removal, deprecated APIs are planned for removal two minor versions later or at the next major release, whichever comes first.

The exact schedule and migration contract are recorded in the
[deprecated API removal ADR](https://github.com/nestarc/nestjs-tenancy/blob/main/docs/2026-08-30-deprecated-api-removal-adr.md).

| API | Added | Deprecated | Last supported | Removal target | Replacement |
|-----|-------|------------|----------------|----------------|-------------|
| `interactiveTransactionSupport` | v0.6.0 | v0.15.0 | v0.16.x | v0.17.0 | `tenancyTransaction()` (public Prisma APIs) |
| Event payload optional `request` type field | v0.4.0 | v0.11.0 | v0.15.x | v0.16.0 | `requestSummary` (v0.11.0) |

## OpenTelemetry Integration

Optional integration with `@opentelemetry/api`. Install the package to enable automatic tenant context in traces:

```bash
npm install @opentelemetry/api
```

```typescript
TenancyModule.forRoot({
  tenantExtractor: 'X-Tenant-Id',
  telemetry: {
    spanAttributeKey: 'tenant.id', // default
    createSpans: true,              // create custom spans for tenant lifecycle
  },
})
```

When enabled, `tenant.id` is automatically added as a span attribute to the active span on every request. If `createSpans` is `true`, a `tenant.resolved` span is also created with the configured tenant attribute.

If `@opentelemetry/api` is not installed, telemetry is silently skipped — no errors.

## Microservice Propagation

Forward the current tenant context to downstream services using `propagateTenantHeaders()`. Works with any HTTP client — zero dependencies.

```typescript
import { propagateTenantHeaders } from '@nestarc/tenancy';

// With fetch
const res = await fetch('http://orders-service/api/orders', {
  headers: { 'Content-Type': 'application/json', ...propagateTenantHeaders() },
});

// With axios
const res = await axios.get('http://orders-service/api/orders', {
  headers: propagateTenantHeaders(),
});

// With @nestjs/axios HttpService
this.httpService.get('http://orders-service/api/orders', {
  headers: propagateTenantHeaders(),
});
```

By default, the function uses `X-Tenant-Id` as the header name. Pass a custom name if needed:

```typescript
propagateTenantHeaders('X-Custom-Tenant'); // { 'X-Custom-Tenant': 'tenant-abc' }
```

Returns an empty object `{}` when no tenant context is available (e.g., outside a request or inside `withoutTenant()`).

> **How it works:** `propagateTenantHeaders()` reads from the same static `AsyncLocalStorage` used by `TenancyContext`. No dependency injection required — it works anywhere in the call stack.

For more control, use `HttpTenantPropagator` directly:

```typescript
import { HttpTenantPropagator, TenancyContext } from '@nestarc/tenancy';

const propagator = new HttpTenantPropagator(new TenancyContext(), {
  headerName: 'X-Tenant-Id',
});
const headers = propagator.getHeaders(); // { 'X-Tenant-Id': 'tenant-abc' }
```

### Message Queue & RPC Propagation

Transport-specific propagators for Bull, Kafka, and gRPC. All use structural typing with zero runtime dependencies on transport packages.

#### Bull (BullMQ)

```typescript
import { BullTenantPropagator, TenancyContext } from '@nestarc/tenancy';

const propagator = new BullTenantPropagator(new TenancyContext());

// Producer: inject tenant into job data
await queue.add('process-order', propagator.inject({ orderId: '123' }));
// → { orderId: '123', __tenantId: 'tenant-abc' }

// Consumer: extract tenant from job data
const tenantId = propagator.extract(job.data); // 'tenant-abc'
```

#### Kafka

```typescript
import { KafkaTenantPropagator, TenancyContext } from '@nestarc/tenancy';

const propagator = new KafkaTenantPropagator(new TenancyContext());

// Producer: inject tenant into message headers
await producer.send({
  topic: 'orders',
  messages: [propagator.inject({ value: JSON.stringify(payload) })],
});

// Consumer: extract tenant from message
const tenantId = propagator.extract(message); // handles string & Buffer headers
```

#### gRPC

```typescript
import { GrpcTenantPropagator, TenancyContext } from '@nestarc/tenancy';

const propagator = new GrpcTenantPropagator(new TenancyContext());

// Client: inject tenant into metadata
const metadata = new Metadata();
propagator.inject(metadata); // sets 'x-tenant-id' key

// Server: extract tenant from metadata
const tenantId = propagator.extract(call.metadata);
```

### Inbound Context Restoration (Interceptor)

`TenantContextInterceptor` automatically restores tenant context from incoming microservice messages. It wraps handler execution in `TenancyContext.run()`.

```typescript
import {
  TenantContextDiagnostics,
  TenantContextInterceptor,
  TenancyContext,
  type TenantIdValidator,
} from '@nestarc/tenancy';

const validateTenantId: TenantIdValidator = (tenantId) =>
  /^org_[a-z0-9-]+$/.test(tenantId);
const diagnostics = app.get(TenantContextDiagnostics);

// Specify the transport explicitly to avoid duck-typing ambiguity.
app.useGlobalInterceptors(
  new TenantContextInterceptor(new TenancyContext(), {
    transport: 'kafka',
    validateTenantId,
    diagnostics,
    resource: 'orders',
  }),
);
```

Supported transports: `'kafka'` | `'bull'` | `'grpc'`.

> **HTTP is skipped** — `TenantMiddleware` + `TenancyGuard` already handle HTTP tenant extraction. The interceptor is designed for RPC transports only.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `transport` | `'kafka' \| 'bull' \| 'grpc'` | auto-detect | Explicit transport selection (recommended) |
| `kafkaHeaderName` | `string` | `'X-Tenant-Id'` | Kafka message header name |
| `bullDataKey` | `string` | `'__tenantId'` | Bull job data key |
| `grpcMetadataKey` | `string` | `'x-tenant-id'` | gRPC metadata key |
| `validateTenantId` | `TenantIdValidator` | unset during 0.x | Optional sync/async validator run before tenant context and handler execution |
| `diagnostics` | `TenantContextDiagnostics` | none | Module-backed missing/invalid-context event and telemetry reporting |
| `resource` | `string` | none | Stable, low-cardinality, non-sensitive topic, queue, service, or handler name |

> **0.x compatibility:** HTTP extraction uses built-in UUID-like validation when `TenancyModuleOptions.validateTenantId` is omitted. RPC restoration historically accepted any non-empty string, so the interceptor preserves that default throughout 0.x. Pass `validateTenantId` explicitly now. The planned v1.0.0 default is the same UUID-like validation as HTTP; custom identifiers will continue to require a custom validator. See the [compatibility ADR](https://github.com/nestarc/nestjs-tenancy/blob/main/docs/2026-08-29-rpc-tenant-validation-compatibility-adr.md).

When an explicit RPC validator returns `false`, the handler is not invoked and the interceptor rejects with `BadRequestException('Invalid tenant ID format')`. A supplied module-resolved `TenantContextDiagnostics` reports the exported `InvalidTenantContextDiagnostic` payload (`transport`, `operation: 'consume'`, and optional stable `resource`) to the optional event and telemetry integrations. When configured, this emits `tenant.context_invalid`, adds an active-span event of the same name, and increments `nestarc.tenancy.invalid_context` with `tenant.transport`, `tenant.operation`, and optional `tenant.resource` attributes. The interceptor never copies the rejected ID or raw carrier contents into that payload. Keep the caller-supplied `resource` non-sensitive; do not place tenant/user IDs or secrets in it. Invalid input is independent of `missingContext.policy` and always rejects.

#### RPC Trust Boundary

RPC carrier values are tenant claims, not authenticated identities. `TenantContextInterceptor` does not authenticate producers, verify message signatures, configure broker/channel security, or authorize a producer for the claimed tenant. The HTTP `crossCheck` and `onTenantResolved` contracts are not automatically applied to RPC messages.

Authenticate the producer or channel and authorize that principal for the claimed tenant before tenant-scoped handler work. `validateTenantId` provides format or allow-list validation only; successful validation and context restoration are not authorization.

### Non-HTTP Missing-Context Diagnostics

The default policy is `ignore`, which preserves the existing pass-through behavior. Opt in at module level with `warn` for observation or `throw` to fail closed:

```typescript
TenancyModule.forRoot({
  tenantExtractor: 'X-Tenant-Id',
  missingContext: { policy: 'warn' }, // 'ignore' | 'warn' | 'throw'
});
```

Resolve the configured diagnostics object when constructing transport propagators manually. Use a stable, low-cardinality `resource` such as a queue, topic, service, cache, or index name:

```typescript
import {
  BullTenantPropagator,
  TenantContextDiagnostics,
  TenancyContext,
} from '@nestarc/tenancy';

const diagnostics = app.get(TenantContextDiagnostics);
const propagator = new BullTenantPropagator(new TenancyContext(), {
  diagnostics,
  resource: 'orders',
});
```

`warn` and `throw` both emit `tenant.context_missing`, add a `tenant.context_missing` event to the active OpenTelemetry span, and increment `nestarc.tenancy.missing_context`. Telemetry attributes are `tenant.transport`, `tenant.operation`, and optional `tenant.resource`. The `throw` policy raises `TenantContextMissingError` after reporting. HTTP extraction is intentionally outside this policy because middleware and `TenancyGuard` already define its fail-closed contract. An RPC value rejected by an explicit validator uses the separate, always-rejecting `tenant.context_invalid` path described above; it is not treated as missing.

The same diagnostics object can be supplied to `TenantContextInterceptor`, `TenantCacheInterceptor`, `TenantResourceKey`, and `TenantSearch`. `TenantResourceKey` creates collision-safe Redis/search keys, while `TenantSearch` is a vendor-neutral adapter boundary that never invokes the adapter without tenant scope:

```typescript
const keys = new TenantResourceKey(new TenancyContext(), {
  transport: 'redis',
  resource: 'response-cache',
  diagnostics,
});

const search = new TenantSearch(new TenancyContext(), searchAdapter, {
  index: 'products',
  diagnostics,
});
```

With `ignore` or `warn`, a missing resource key/search scope returns `null` and no Redis/search operation is performed. With `throw`, it fails before the adapter or resource is accessed.

## Tenant-Aware Caching

PostgreSQL RLS protects database rows, but it does not protect Redis, in-memory response caches, or other application cache stores. If two tenants hit the same route and the cache key is only the URL, an unscoped response cache can leak one tenant's data to another tenant.

Install Nest's optional cache runtime when you want response caching:

```bash
npm install @nestjs/cache-manager cache-manager
```

Register Nest caching alongside the tenancy module. Keep core tenancy imports from `@nestarc/tenancy`:

```typescript
import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { TenancyModule } from '@nestarc/tenancy';

@Module({
  imports: [
    CacheModule.register(),
    TenancyModule.forRoot({
      tenantExtractor: 'X-Tenant-Id',
    }),
  ],
})
export class AppModule {}
```

Use `TenantCacheInterceptor` from the cache subpath on routes that should cache per tenant:

```typescript
import { CacheTTL } from '@nestjs/cache-manager';
import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { TenantCacheInterceptor } from '@nestarc/tenancy/cache';

@Controller('products')
export class ProductsController {
  @UseInterceptors(TenantCacheInterceptor)
  @CacheTTL(60)
  @Get()
  findAll() {
    return this.productsService.findAll();
  }
}
```

By default, the interceptor turns Nest's base cache key into `tenant:{tenantIdLength}:{tenantId}:{baseCacheKey}`. The length prefix keeps tenant IDs containing `:` or another configured separator from colliding with opaque Nest cache keys. The base cache key is the same key Nest's `CacheInterceptor` would have used, including any `@CacheKey()` override.

For routes where the response is intentionally public or shared across tenants, opt in with `@SharedTenantCache()` from `@nestarc/tenancy/cache`:

```typescript
import { CacheTTL } from '@nestjs/cache-manager';
import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { BypassTenancy } from '@nestarc/tenancy';
import { SharedTenantCache, TenantCacheInterceptor } from '@nestarc/tenancy/cache';

@Controller('catalog')
export class CatalogController {
  @BypassTenancy()
  @SharedTenantCache()
  @UseInterceptors(TenantCacheInterceptor)
  @CacheTTL(300)
  @Get()
  publicCatalog() {
    return this.catalogService.publicCatalog();
  }
}
```

`@SharedTenantCache()` affects cache keys only: shared routes use `shared:{baseCacheKey}` instead of a tenant-prefixed key. It does not bypass `TenancyGuard`, clear tenant context, or authorize access. If a public route should skip the tenant-required guard, it still needs `@BypassTenancy()`.

To apply tenant-aware caching globally, register the interceptor as an `APP_INTERCEPTOR`. Optional cache interceptor settings are provided through the cache subpath token:

```typescript
import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { CacheModule } from '@nestjs/cache-manager';
import { TenancyModule } from '@nestarc/tenancy';
import {
  TENANT_CACHE_INTERCEPTOR_OPTIONS,
  TenantCacheInterceptor,
} from '@nestarc/tenancy/cache';

@Module({
  imports: [
    CacheModule.register(),
    TenancyModule.forRoot({
      tenantExtractor: 'X-Tenant-Id',
    }),
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: TenantCacheInterceptor },
    {
      provide: TENANT_CACHE_INTERCEPTOR_OPTIONS,
      useValue: { hashTenantId: true },
    },
  ],
})
export class AppModule {}
```

Cache invalidation remains application- and store-specific. Invalidate every tenant-scoped key shape your application writes, including any shared cache keys you opt into.

## Error Hierarchy

All tenancy context errors follow a class hierarchy for flexible catch handling:

```
Error
  └── TenantContextMissingError          ← getCurrentTenantOrThrow()
        └── TenancyContextRequiredError   ← Prisma fail-closed (has model, operation)
```

```typescript
import { TenantContextMissingError, TenancyContextRequiredError } from '@nestarc/tenancy';

try {
  // any operation that requires tenant context
} catch (e) {
  if (e instanceof TenantContextMissingError) {
    // Catches both service-level and Prisma-level errors
  }
  if (e instanceof TenancyContextRequiredError) {
    // Catches only Prisma fail-closed errors (e.model, e.operation available)
  }
}
```

## Security

- **SQL Injection**: The Prisma extension uses `set_config()` with bind parameters via `$executeRaw` tagged template. This eliminates SQL injection risk at the database layer. HTTP tenant IDs are validated by the middleware (UUID-like format by default); RPC validation is explicit during 0.x.
- **Transaction-scoped**: `set_config(key, value, TRUE)` is equivalent to `SET LOCAL` and is scoped to the database transaction. The supported PgBouncer transaction-mode matrix verifies A → B → no-context isolation on reused physical backends.
- **Custom validators**: Reuse a `TenantIdValidator` in HTTP module options and RPC interceptor options when tenant IDs are not UUIDs or require an allow-list. Format validation does not authenticate or authorize the caller or producer.

### RLS Operational Notes

- **Patch PostgreSQL**: Use a currently supported PostgreSQL minor release. CVE-2024-10976 affects row-security policies in older 17.x, 16.x, 15.x, 14.x, 13.x, and 12.x patch releases.
- **Index the tenant column**: RLS policies behave like implicit filters. Add an index on `tenant_id` (or your configured tenant column) for every tenant-scoped table. The CLI now generates this index and `tenancy check` warns when it is missing.
- **Keep policies simple**: The generated policy is a direct equality check. If you replace it with subqueries or non-leakproof functions, validate query plans under realistic data volume.
- **RLS is not resource isolation**: It does not prevent noisy-neighbor CPU/IO issues, cache key leaks, or cross-tenant data in Redis/search queues. Include tenant IDs in non-database cache keys and job payloads.
- **PgBouncer/Prisma**: Use the [verified transaction-mode contract](#pgbouncer-support-contract) below and re-run it for any production-specific pooler configuration.

### PgBouncer Support Contract

The verified pooler contract covers the repository's pinned, self-hosted **PgBouncer transaction mode** configuration for pooled application queries. The matrix currently verifies PostgreSQL 16.14, PgBouncer 1.25.2, Prisma 6.19.3, and Prisma 7.10.0.

- Configure `pool_mode = transaction` and `max_prepared_statements = 200`. With the tested PgBouncer 1.25.2 configuration, do not add the legacy `pgbouncer=true` URL parameter.
- Use a direct PostgreSQL URL for Prisma CLI, migration, and test setup operations. Route application queries through the PgBouncer URL.
- Session mode is not a supported application contract. The matrix keeps a pool-size-one negative test that demonstrates backend pinning and a second client remaining queued until the first disconnects.
- Pool-size-one tests force the same physical backend through tenant A, tenant B, no-context, commit, callback rollback, database-error rollback, and high logical concurrency scenarios. The timeout lane separately verifies rollback and clean state while allowing PgBouncer or the client pool to replace the backend.
- A pool-size-two lane verifies real overlap on two backends, clean state on both, and clean replacement sessions after PgBouncer `RECONNECT`.
- `tenancyTransaction()` is the canonical path. Its timeout, isolation, custom-key, context-setup failure, and rollback contracts are exercised against both supported Prisma majors. `maxWait` is positive-tested on Prisma 7 `PrismaPg` and Prisma 6 native, with the Prisma 6 `PrismaPg` limitation fixed as a negative contract. The batch extension and deprecated transparent compatibility mode are tested separately.
- The runner fails fast unless the Prisma CLI, client, and PostgreSQL adapter all use the same exact supported version in major 6 or 7.
- Prisma Data Proxy, managed PgBouncer services, and other custom pooler settings remain outside the repository support guarantee. Deployment owners must validate the exact production mode and prepared-statement settings with equivalent isolation, rollback, reuse, and concurrency scenarios.

Reproduce the pinned local matrix with Docker:

```bash
npm run test:e2e:pgbouncer
```

CI and release workflows run this command against the pinned Prisma 6.19.3 and 7.10.0 lanes. See [`docker-compose.yml`](./docker-compose.yml), [`scripts/test-pgbouncer-e2e.js`](./scripts/test-pgbouncer-e2e.js), and the [PgBouncer E2E specification](./test/e2e/pgbouncer/pgbouncer.e2e-spec.ts).

### Security Considerations

**Tenant ID is caller-supplied by default.** HTTP extractors read request data, and RPC restoration reads Kafka headers, Bull job data, or gRPC metadata. Neither source proves that the caller or producer may access the claimed tenant.

For production use, you **must** add a trust boundary — verify that the authenticated caller or producer belongs to the claimed tenant. HTTP options include:

1. **Use `JwtClaimTenantExtractor`** with a pre-validated JWT (tenant ID embedded by your auth server)
2. **Add validation in `onTenantResolved` hook** — check the user's tenant membership
3. **Use authentication middleware** before the tenancy middleware to establish trust

For RPC, authenticate the broker/channel or message producer and perform principal-to-tenant authorization before tenant-scoped work. Tenant ID format validation, successful context restoration, broker delivery, and PostgreSQL RLS do not perform that authorization. Without this boundary, a caller or producer that can choose the carrier value can cause work to run under another tenant.

## How It Works

```
HTTP Request (X-Tenant-Id: 550e8400-e29b-41d4-a716-446655440000)
  → TenantMiddleware (extracts & validates tenant ID)
    → AsyncLocalStorage (stores tenant context)
      → TenancyGuard (rejects if missing, unless @BypassTenancy)
        → Your Controller / Service
          → Prisma Extension ($transaction → set_config() → query)
            → PostgreSQL RLS (automatic row filtering)
```

### CLI

Scaffold RLS policies and module configuration from your Prisma schema:

Before running `init`, declare a required scalar field mapped to the physical
`tenant_id` column on every tenant-scoped model. The CLI derives the policy cast
from the Prisma field metadata, not from the interactive `tenantFormat` choice:

| Prisma tenant field | Generated policy type |
| --- | --- |
| `String`, `String @db.Text` | `TEXT` |
| `String @db.VarChar(n)`, `String @db.Char(n)` | `TEXT` |
| `String @db.Uuid` | `UUID` |

Field-level mapping is supported, for example
`tenantId String @map("tenant_id") @db.Uuid`. When auto-injection is enabled,
all non-shared models must use the same logical Prisma field name; the generated
extension setup emits that name as `tenantIdField`. Shared models are excluded
from tenant-field validation.

The CLI does not guess from value shape: `String @db.VarChar(36)` remains a
text policy. Missing, duplicate, nullable, list, ignored (`@ignore`), non-`String`, `Unsupported`,
or unsupported native tenant fields such as `Citext`, `Xml`, `Inet`, `Bit`, and
`VarBit` stop scaffolding before either output file is written. `tenantFormat`
controls inbound ID validation only; it does not select the database storage
type or policy cast.

```bash
npx @nestarc/tenancy init
```

This generates:
- `tenancy-setup.sql` — PostgreSQL RLS policies, tenant indexes, roles, and grants
- `tenancy.module-setup.ts` — NestJS module registration code

Run `tenancy-setup.sql` as a standalone migration with a client that stops on the
first SQL error. For `psql`, use:

```bash
psql -X -v ON_ERROR_STOP=1 -f tenancy-setup.sql "$DATABASE_URL"
```

`-X` ignores settings in `.psqlrc`. Do not run this script with
`ON_ERROR_ROLLBACK=on`: its per-statement savepoints can let execution continue
to the final `COMMIT` after an error. Other clients must also stop on the first
error and then issue `ROLLBACK` or close the connection. Under that execution
contract, the generated `BEGIN` / `COMMIT` makes its roles, grants, indexes, RLS
flags, and policies all-or-nothing. Do not nest the script inside a caller-owned
transaction. Its `ALTER TABLE` statements hold table locks until commit, so
schedule large production schemas in an appropriate maintenance window.

Models without `@@schema` are emitted as explicitly qualified
`"public"."Table"` targets, so `search_path` cannot redirect the generated DDL
to a shadow table. Inside a generated section, `tenancy check` requires the
intact boundary markers, transaction envelope, guarded policies, and model-bound
table/schema targets. It also flags unqualified targets; declare `@@schema` for
every non-public model. Markerless legacy SQL remains structurally accepted,
but it must still satisfy the current tenant-policy semantics, including the
restrictive non-empty context guard described below.

The same generated script is safe to reapply sequentially; concurrent applies
are not part of this guarantee. Existing policies with the generated table/name
pair are preserved instead of being dropped or rewritten, including policies
that have drifted from the generated expression. Use `tenancy doctor` against
the application role to detect applied policy drift. When replacement is
intentional, review the live policy and place an explicit `DROP POLICY` directly
after `BEGIN` in a temporary reviewed execution copy of the generated
transaction. Do not keep that state-reversing statement in the canonical
`tenancy-setup.sql`; `tenancy check` intentionally rejects it. Running the
temporary copy with the fail-fast contract makes the drop and recreation atomic;
a separate autocommitted drop can leave a policy gap if the later setup fails.

Existing `TEXT` schemas keep the same canonical
`current_setting(..., true)::text` isolation and insert predicates. Generated
SQL now adds a separate `AS RESTRICTIVE` context-guard policy so PostgreSQL's
reset empty string cannot match or insert a `tenant_id=''` row. The guard has a
new deterministic name and is added automatically on a sequential reapply;
`tenancy check` reports a missing or invalid guard in both canonical generated
and markerless legacy SQL, and `tenancy doctor` reports a missing or drifted live
guard. A markerless file may keep its legacy policy names, but its guard must be
`AS RESTRICTIVE` and use
`NULLIF(current_setting(..., true), '') IS NOT NULL` in both `USING` and
`WITH CHECK`. If a generated policy name already exists, the drift-preservation
rule still applies, so review and replace it through the transaction procedure
above. For an existing deployment, preview or regenerate with `init --dry-run`,
run `tenancy check`, apply the reviewed SQL, and finish with live `tenancy doctor`
verification.

To adopt a native UUID column, add `@db.Uuid`, preview the regenerated SQL with
`init --dry-run`, and perform any TEXT-to-UUID column/data conversion as a
separate reviewed Prisma/PostgreSQL migration; `init` never changes column types
or data. Isolation/insert policy names do not include the column type, and
sequential reapply preserves an existing same-name policy. Replace an old
text/manual policy only through the reviewed transaction procedure above, then
run `tenancy check` on the canonical file and `tenancy doctor --active` as the
application role for tenant A/B, no-context, COMMIT-cleanup, and
ROLLBACK-cleanup verification.

A non-empty invalid UUID setting intentionally fails at PostgreSQL's cast rather
than broadening visibility. Applications using UUID storage should validate
inbound IDs as UUIDs on every transport; in particular, the 0.x RPC interceptor
keeps its compatibility behavior unless an explicit validator is supplied.

Generated index and policy names retain the legacy readable form only when the
resolved schema, table, and (for indexes) tenant-column components are lowercase
ASCII letters, digits, or underscores and the complete name fits PostgreSQL's
63-byte limit. Inputs that would lose information through punctuation, Unicode,
case folding, or truncation receive a deterministic 12-hex SHA-256 suffix; the
readable prefix is shortened so the complete identifier remains at most 63
bytes. Explicit and implicit `public` schemas use the same identity.

When upgrading a setup generated for a non-canonical or overlong name, or one
that explicitly declared `@@schema("public")` and therefore used the old
`public_` name prefix, compare the live legacy objects with the newly generated
names before applying.
Do not blindly keep both policy sets: a drifted legacy permissive policy can
broaden access even when the new policy is correct. Use a reviewed transaction
to rename or explicitly replace the legacy policies and indexes, then run
`tenancy check` on the canonical file and `tenancy doctor` on every affected
table. Existing lowercase ASCII short names remain unchanged except that the
old explicit-`public_` form now shares the implicit-public identity.

Preview without writing files:

```bash
npx @nestarc/tenancy init --dry-run
```

Check if your SQL is in sync with the Prisma schema:

```bash
npx @nestarc/tenancy check
# With custom setting key:
npx @nestarc/tenancy check --db-setting-key=custom.tenant_key
```

Validates table coverage, tenant indexes, FORCE ROW LEVEL SECURITY,
isolation/insert policies, the restrictive context guard, and setting key
consistency across all policies. Exits with code 0 (in sync) or 1 (drift
detected). Markerless legacy SQL without the semantic guard returns code 1 with
a `missing or invalid context guard policy` warning.

`check` and `doctor` do not load Nest module configuration. When the canonical module key is custom, pass the same `--db-setting-key` to both commands. `init` writes that selected key to the generated SQL and the module configuration once; the generated Prisma extension inherits it from `TenancyService`.

Audit an applied RLS configuration through the same non-superuser database role used by the application:

```bash
DATABASE_URL='postgresql://app_user:...@localhost/app' \
  npx @nestarc/tenancy doctor \
  --table=public.users \
  --role=app_user
```

The catalog audit checks the current and login roles, `SUPERUSER` / `BYPASSRLS` and reachable role risks, table ownership, `ENABLE` / `FORCE` / active RLS state, tenant column and index, grants (including forbidden `TRUNCATE`), and the exact generated `USING` / `WITH CHECK` policy contract. Run the command once per tenant-scoped table.

Add an opt-in, read-only behavior probe with two tenant IDs that already have rows:

```bash
DATABASE_URL='postgresql://app_user:...@localhost/app' \
  npx @nestarc/tenancy doctor \
  --table=public.users \
  --role=app_user \
  --active \
  --tenant-a=11111111-1111-1111-1111-111111111111 \
  --tenant-b=22222222-2222-2222-2222-222222222222
```

The active probe verifies no-context fail-closed behavior, tenant A/B isolation, and setting cleanup after both COMMIT and ROLLBACK. It does not write data. If either tenant has no visible fixture row, the result is inconclusive rather than a false pass. Add `--json` for machine-readable output. Exit codes are 0 (healthy), 1 (finding or inconclusive probe), and 2 (usage, connection, or query error). Prefer `DATABASE_URL` over `--url` so credentials do not enter shell history or the process list.

## License

MIT
