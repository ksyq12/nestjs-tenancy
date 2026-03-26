# @nestarc/tenancy

[![npm version](https://img.shields.io/npm/v/@nestarc/tenancy.svg)](https://www.npmjs.com/package/@nestarc/tenancy)
[![CI](https://github.com/ksyq12/nestjs-tenancy/actions/workflows/ci.yml/badge.svg)](https://github.com/ksyq12/nestjs-tenancy/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/ksyq12/nestjs-tenancy/graph/badge.svg)](https://codecov.io/gh/ksyq12/nestjs-tenancy)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

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
- **CLI scaffolding** — `npx @nestarc/tenancy init` generates RLS policies and module config
- **ccTLD-aware subdomain extraction** — accurate parsing for `.co.uk`, `.co.jp`, `.com.au`, etc.
- **SQL injection safe** — `set_config()` with bind parameters, plus UUID validation by default
- **NestJS 10 & 11** compatible, **Prisma 5 & 6** compatible

## Performance

Measured with PostgreSQL 16, Prisma 6, 1005 rows, 500 iterations on Apple Silicon:

| Scenario | Avg | P50 | P95 | P99 |
|----------|-----|-----|-----|-----|
| Direct query (no extension, 1005 rows) | 3.74ms | 3.07ms | 6.13ms | 10.44ms |
| **findMany with extension** (402 rows via RLS) | **2.91ms** | **2.66ms** | **4.59ms** | **6.52ms** |
| **findFirst with extension** (1 row via RLS) | **1.23ms** | **1.20ms** | **1.62ms** | **2.00ms** |

The batch transaction overhead (`set_config` + query) is negligible — RLS reduces the returned row count, which often makes queries faster than unfiltered equivalents.

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

-- Enable RLS
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Create isolation policy
CREATE POLICY tenant_isolation ON users
  USING (tenant_id = current_setting('app.current_tenant', true)::text);

-- The `true` parameter means missing_ok: returns '' instead of error when unset.
-- This ensures queries without tenant context return 0 rows (not an error).
-- Repeat for each tenant-scoped table
```

> **Critical:** RLS only applies to non-superuser roles. Create a dedicated application role:
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

> **Important:** If you customize `dbSettingKey` in `TenancyModule.forRoot()`, pass the same value to `createPrismaTenancyExtension()` and `tenancyTransaction()`. These are independent configurations that must match your PostgreSQL `current_setting()` calls.

> **Note:** When using interactive transactions (`$transaction(async (tx) => ...)`), the `set_config` call runs in a separate connection. Call `set_config` manually as the first statement inside interactive transactions.

### Interactive Transactions

The default Prisma extension wraps queries in batch transactions, which breaks inside `$transaction(async (tx) => ...)`. Use the `tenancyTransaction()` helper:

```typescript
import { tenancyTransaction } from '@nestarc/tenancy';

await tenancyTransaction(prisma, tenancyService, async (tx) => {
  const user = await tx.user.findFirst();
  await tx.order.create({ data: { userId: user.id } });
});
```

**Experimental: Transparent Mode**

```typescript
const prisma = basePrisma.$extends(
  createPrismaTenancyExtension(tenancyService, {
    experimentalTransactionSupport: true, // opt-in
  })
);
```

> ⚠️ `experimentalTransactionSupport` relies on undocumented Prisma internals. It may break on Prisma upgrades. Use `tenancyTransaction()` for production-critical code.

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

Skip tenant enforcement on specific routes (e.g., health checks, public endpoints):

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

> **Note:** Requires the `psl` package for accurate ccTLD parsing. Install: `npm install psl`

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
> **Option 1 — Apply auth middleware in the same `configure()` call, before `TenantMiddleware`:**
>
> ```typescript
> // app.module.ts — register auth middleware before tenancy reads the token
> import { expressjwt } from 'express-jwt';
>
> export class AppModule implements NestModule {
>   configure(consumer: MiddlewareConsumer) {
>     consumer
>       .apply(
>         expressjwt({ secret: process.env.JWT_SECRET, algorithms: ['RS256'] }),
>         TenantMiddleware, // runs after JWT is verified and req.auth is populated
>       )
>       .forRoutes('*');
>   }
> }
> ```
>
> **Option 2 — Use a module imported before `AppModule` registers `TenancyModule`:**
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
> **Option 3 — Verify the JWT claim in `onTenantResolved`:**
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
import { TenantExtractor } from '@nestarc/tenancy';
import { Request } from 'express';

export class CookieTenantExtractor implements TenantExtractor {
  extract(request: Request): string | null {
    return request.cookies?.['tenant_id'] ?? null;
  }
}
```

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
| `onTenantResolved` | `(tenantId: string, req: Request) => void \| Promise<void>` | After successful extraction and validation |
| `onTenantNotFound` | `(req: Request, res: Response) => void \| 'skip' \| Promise<void \| 'skip'>` | When no tenant ID could be extracted |

## Error Responses

| Scenario | Status | Message |
|----------|--------|---------|
| Missing tenant header (no `@BypassTenancy`) | 403 | `Tenant ID is required` |
| Invalid tenant ID format | 400 | `Invalid tenant ID format` |
| Non-HTTP context (WebSocket, gRPC) | — | Guard skips (no enforcement) |

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

## License

MIT
