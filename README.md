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
- **Prisma Client Extensions** — Automatic `set_config()` before every query
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
- **Multi-schema support** — `@@schema()` directives generate schema-qualified SQL (e.g., `"auth"."users"`)
- **ccTLD-aware subdomain extraction** — accurate parsing for `.co.uk`, `.co.jp`, `.com.au`, etc.
- **Framework-agnostic** — public API uses `TenancyRequest` / `TenancyResponse` instead of Express types. Works with Express, Fastify, and raw Node.js HTTP
- **SQL injection safe** — `set_config()` with bind parameters, plus UUID validation by default
- **NestJS 10 & 11** compatible, **Prisma 5 & 6** compatible (E2E-tested with Prisma 6; Prisma 5 unit-tested)

## Performance

Measured with PostgreSQL 16, Prisma 6, 1005 rows, 500 iterations on Apple Silicon:

| Scenario | Avg | P50 | P95 | P99 |
|----------|-----|-----|-----|-----|
| Direct query (no extension, 1005 rows) | 4.11ms | 3.32ms | 6.28ms | 9.96ms |
| **findMany with extension** (tenant-filtered via RLS) | **3.12ms** | **2.63ms** | **5.63ms** | **8.94ms** |
| **findFirst with extension** (1 row via RLS) | **1.27ms** | **1.23ms** | **1.58ms** | **2.00ms** |

Extension overhead: **-24%** (faster with RLS). The batch transaction overhead (`set_config` + query) is negligible — RLS reduces the returned row count, which often makes queries faster than unfiltered equivalents.

> Reproduce: `docker compose up -d && npx ts-node benchmarks/rls-overhead.ts`

## Prerequisites

- Node.js >= 18
- NestJS 10 or 11
- Prisma 5 or 6
- PostgreSQL (with RLS support)

## Installation

```bash
npm install @nestarc/tenancy
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

-- Create isolation policy
CREATE POLICY tenant_isolation ON users
  USING (tenant_id = current_setting('app.current_tenant', true)::text);

-- The `true` parameter means missing_ok: returns '' instead of error when unset.
-- This ensures queries without tenant context return 0 rows (not an error).
-- Repeat for each tenant-scoped table
```

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

```typescript
import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { TenancyService, createPrismaTenancyExtension } from '@nestarc/tenancy';

@Injectable()
export class PrismaService implements OnModuleInit {
  public readonly client;

  constructor(private readonly tenancyService: TenancyService) {
    const prisma = new PrismaClient();
    this.client = prisma.$extends(
      createPrismaTenancyExtension(tenancyService),
    );
  }

  async onModuleInit() {
    await this.client.$connect();
  }
}
```

#### Extension Options

```typescript
createPrismaTenancyExtension(tenancyService, {
  dbSettingKey: 'app.current_tenant',  // PostgreSQL setting key (default)
  autoInjectTenantId: true,            // Auto-inject tenant_id on create/upsert
  tenantIdField: 'tenant_id',          // Column name for tenant ID (default)
  sharedModels: ['Country', 'Currency'], // Models that skip RLS entirely
})
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dbSettingKey` | `string` | `'app.current_tenant'` | PostgreSQL session variable name |
| `autoInjectTenantId` | `boolean` | `false` | Auto-inject tenant ID into `create`, `createMany`, `createManyAndReturn`, `upsert` |
| `tenantIdField` | `string` | `'tenant_id'` | Column name to inject tenant ID into |
| `sharedModels` | `string[]` | `[]` | Models that bypass RLS (no `set_config`, no injection) |
| `failClosed` | `boolean` | `false` | Block queries when no tenant context is set (prevents accidental data exposure if RLS is misconfigured) |
| `interactiveTransactionSupport` | `boolean` | `false` | Enable transparent `set_config` inside interactive transactions. Validates Prisma compatibility at startup — throws immediately if unsupported. Alternative: `tenancyTransaction()` helper |

> **Important:** If you customize `dbSettingKey` in `TenancyModule.forRoot()`, pass the same value to `createPrismaTenancyExtension()` and `tenancyTransaction()`. These are independent configurations that must match your PostgreSQL `current_setting()` calls.

> **Note:** By default, the Prisma extension uses batch transactions internally, which do not propagate `set_config` into interactive transactions (`$transaction(async (tx) => ...)`). Enable `interactiveTransactionSupport: true` for transparent handling, or use the `tenancyTransaction()` helper. See [Interactive Transactions](#interactive-transactions) below.

### Interactive Transactions

The default Prisma extension wraps queries in batch transactions, which breaks inside `$transaction(async (tx) => ...)`. Two approaches are available:

**Option 1: `tenancyTransaction()` helper (recommended)**

Uses only public Prisma APIs. Works with all Prisma versions.

```typescript
import { tenancyTransaction } from '@nestarc/tenancy';

await tenancyTransaction(prisma, tenancyService, async (tx) => {
  const user = await tx.user.findFirst();
  await tx.order.create({ data: { userId: user.id } });
});
```

**Option 2: Transparent mode**

Sets RLS context automatically inside interactive transactions. Validates Prisma compatibility at startup.

```typescript
const prisma = basePrisma.$extends(
  createPrismaTenancyExtension(tenancyService, {
    interactiveTransactionSupport: true,
  })
);
```

> `interactiveTransactionSupport` relies on Prisma internal APIs. If your Prisma version is incompatible, extension creation throws immediately with a clear error message. Use `tenancyTransaction()` as a fallback.

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

All Prisma queries are automatically scoped to that tenant via RLS.

## API

### TenancyModule

```typescript
// Synchronous
TenancyModule.forRoot({
  tenantExtractor: 'X-Tenant-Id',           // header name (string)
  dbSettingKey: 'app.current_tenant',        // PostgreSQL setting (default)
  validateTenantId: (id) => UUID_REGEX.test(id), // sync or async (default: UUID)
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

> **Important:** `@BypassTenancy()` only bypasses the guard — it does **not** clear the tenant context. If the request contains a tenant header, `TenantMiddleware` still sets the context, so `getCurrentTenant()` may return a value and Prisma queries will still be RLS-filtered. To explicitly run without tenant context, use `withoutTenant()`.

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

Use `withoutTenant()` to clear the tenant context so the Prisma extension skips `set_config()`. With RLS enabled, this means queries return **0 rows** — RLS blocks access when no tenant session variable is set.

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
// adminPrisma uses a superuser connection — not subject to RLS
const allUsers = await tenancyService.withoutTenant(async () => {
  return adminPrisma.user.findMany(); // Returns ALL tenants' data
});
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
  // Without X-Tenant-Id header: returns 0 rows (RLS blocks)
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

> **Security:** This extractor does **not** verify the JWT signature. You must ensure JWT signature verification happens at the **middleware level** — not in a NestJS Guard.
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
| Non-HTTP context (WebSocket, gRPC) | — | Guard skips (no enforcement) |

## Fail-Closed Mode

By default, model queries without a tenant context pass through silently. Enable `failClosed` to block them:

```typescript
const prisma = new PrismaClient().$extends(
  createPrismaTenancyExtension(tenancyService, {
    failClosed: true, // throws TenancyContextRequiredError if no tenant
  })
);
```

Queries are still allowed when:
- The model is listed in `sharedModels`
- `withoutTenant()` is used (explicit bypass)

> **Scope**: `failClosed` applies to Prisma **model operations** (`findMany`, `create`, `update`, etc.). Raw queries (`$queryRaw`, `$executeRaw`) bypass the extension and are **not** covered — use parameterized `set_config()` manually for raw queries.

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

Events: `tenant.resolved`, `tenant.not_found`, `tenant.validation_failed`, `tenant.context_bypassed`, `tenant.cross_check_failed`.

If `@nestjs/event-emitter` is not installed, events are silently skipped — no errors.

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

> **Deprecated format:** The flat `crossCheckExtractor` / `onCrossCheckFailed` fields still work but emit a deprecation warning. They will be removed in v2.0.

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

When enabled, `tenant.id` is automatically added as a span attribute to the active span on every request. If `createSpans` is `true`, a `tenant.resolved` span is also created.

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
import { TenantContextInterceptor, TenancyContext } from '@nestarc/tenancy';

// Recommended: specify transport explicitly to avoid duck-typing ambiguity
app.useGlobalInterceptors(
  new TenantContextInterceptor(new TenancyContext(), { transport: 'kafka' }),
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

- **SQL Injection**: The Prisma extension uses `set_config()` with bind parameters via `$executeRaw` tagged template. This eliminates SQL injection risk at the database layer. Additionally, tenant IDs are validated by the middleware (UUID format by default).
- **Transaction-scoped**: `set_config(key, value, TRUE)` is equivalent to `SET LOCAL` — scoped to the batch transaction. No cross-request leakage via connection pool.
- **Custom validators**: If your tenant IDs are not UUIDs, provide a `validateTenantId` function that rejects any unsafe input.

### Security Considerations

**Tenant ID is client-supplied by default.** The built-in extractors (Header, Subdomain, Path) read tenant identifiers directly from the request without verifying the caller's authorization to access that tenant.

For production use, you **must** add a trust boundary — verify that the authenticated user belongs to the claimed tenant. Options:

1. **Use `JwtClaimTenantExtractor`** with a pre-validated JWT (tenant ID embedded by your auth server)
2. **Add validation in `onTenantResolved` hook** — check the user's tenant membership
3. **Use authentication middleware** before the tenancy middleware to establish trust

Without a trust boundary, any client can access any tenant's data by changing the header value.

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

```bash
npx @nestarc/tenancy init
```

This generates:
- `tenancy-setup.sql` — PostgreSQL RLS policies, roles, and grants
- `tenancy.module-setup.ts` — NestJS module registration code

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

Validates table coverage, FORCE ROW LEVEL SECURITY, isolation/insert policies, and setting key consistency across all policies. Exits with code 0 (in sync) or 1 (drift detected).

## License

MIT
