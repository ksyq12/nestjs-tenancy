# @nestarc/tenancy

[![npm version](https://img.shields.io/npm/v/@nestarc/tenancy.svg)](https://www.npmjs.com/package/@nestarc/tenancy)
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

> **Note:** When using interactive transactions (`$transaction(async (tx) => ...)`), the `set_config` call runs in a separate connection. Call `set_config` manually as the first statement inside interactive transactions.

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

> **Security:** This extractor does **not** verify the JWT signature. Ensure an authentication guard (e.g., `@nestjs/passport`) runs before the tenancy middleware.

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
  onTenantNotFound: (req) => {
    // Option 1: Observation only (return void → next() is called)
    logger.warn({ path: req.path }, 'no tenant');

    // Option 2: Block the request (throw an exception)
    throw new ForbiddenException('Tenant header required');

    // Option 3: Return 'skip' to prevent next() — you handle the response yourself
    return 'skip';
  },
})
```

| Hook | Signature | When |
|------|-----------|------|
| `onTenantResolved` | `(tenantId: string, req: Request) => void \| Promise<void>` | After successful extraction and validation |
| `onTenantNotFound` | `(req: Request) => void \| 'skip' \| Promise<void \| 'skip'>` | When no tenant ID could be extracted |

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

## License

MIT
