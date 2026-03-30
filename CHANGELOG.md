# Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/).

## [0.4.0] - 2026-03-30

### Added

- **Fail-Closed mode** — `failClosed: true` option on `createPrismaTenancyExtension()`. When enabled, throws `TenancyContextRequiredError` if a model query is executed without a tenant context (unless the model is in `sharedModels` or `withoutTenant()` was used). Prevents accidental data exposure when RLS policies are misconfigured. Note: raw queries (`$queryRaw`/`$executeRaw`) bypass the Prisma extension and are not covered.
- **Testing utilities** — new `@nestarc/tenancy/testing` subpath export with:
  - `TestTenancyModule.register()` — lightweight NestJS test module without middleware/guard
  - `withTenant(tenantId, callback)` — async helper to run code in tenant context (replaces verbose `new Promise + context.run` pattern)
  - `expectTenantIsolation(prismaModel, tenantA, tenantB)` — E2E assertion that verifies no cross-tenant data leakage
- **Event system** — optional integration with `@nestjs/event-emitter`. Emits lifecycle events:
  - `tenant.resolved` — tenant extracted and validated successfully
  - `tenant.not_found` — no tenant found in request
  - `tenant.validation_failed` — tenant ID format validation failed
  - `tenant.context_bypassed` — tenancy bypassed via `@BypassTenancy()` decorator
- **`TenancyEventService`** — injectable service for event emission, gracefully degrades when `@nestjs/event-emitter` is not installed
- **`isTenantBypassed()`** method on `TenancyService` — distinguishes "no tenant context" from "explicitly bypassed via `withoutTenant()`"
- **`TenancyEvents`** constant object with typed event name constants
- **`TenancyContextRequiredError`** — typed error class with `model` and `operation` properties

### Changed

- `TenancyContext` internal store now uses `{ tenantId: string | null; bypassed?: boolean }` (previously `{ tenantId: string }` with unsafe cast for `withoutTenant()`)
- `TenancyGuard` and `TenantMiddleware` now accept `TenancyEventService` injection
- `@nestjs/event-emitter` added as optional peer dependency (`^2.0.0 || ^3.0.0`)

### Migration Guide

**No breaking changes.** All new features are opt-in:
- Fail-closed: pass `failClosed: true` to `createPrismaTenancyExtension()`
- Events: install `@nestjs/event-emitter` and import `EventEmitterModule.forRoot()` to enable
- Testing: import from `@nestarc/tenancy/testing`

## [0.3.0] - 2026-03-26

### Added

- **`withoutTenant()`** — programmatic tenant bypass on `TenancyService`. Clears tenant context inside the callback; Prisma extension automatically skips `set_config()`. With RLS enabled, queries return 0 rows when no tenant is set — use a superuser/RLS-exempt connection for cross-tenant queries. Primarily useful for shared tables (`sharedModels`), tenant lookup during login, and code that uses a separate admin connection.
- **ccTLD support** — `SubdomainTenantExtractor` now uses the `psl` (Public Suffix List) library for accurate subdomain extraction from multi-part TLDs (`.co.uk`, `.co.jp`, `.com.au`, etc.)
- **`tenancyTransaction()`** — standalone helper function for Prisma interactive transactions with RLS. Runs `set_config()` inside the transaction's connection, ensuring tenant isolation works correctly.
- **`experimentalTransactionSupport`** — opt-in option on `createPrismaTenancyExtension`. Attempts transparent interactive transaction support via Prisma internal APIs. Falls back to batch transaction with runtime warning if internal API unavailable.
- **CLI tool** — `npx @nestarc/tenancy init` scaffolds `tenancy-setup.sql` (RLS policies) and `tenancy.module-setup.ts` (module configuration) from your Prisma schema. Supports `@@map` table name mappings, shared models, and file overwrite protection.
- E2E-ready test infrastructure for `withoutTenant()` and `tenancyTransaction()`

### Changed

- `SubdomainTenantExtractor` now requires the `psl` package as a dependency

### Migration Guide

**SubdomainTenantExtractor users:** `psl` is now a direct dependency and installed automatically. No manual installation needed. The extractor API is unchanged.

## [0.2.0] - 2026-03-24

### Added

- **SubdomainTenantExtractor** — extract tenant ID from subdomain (e.g., `tenant1.app.com`)
- **JwtClaimTenantExtractor** — extract tenant ID from JWT payload claim (no signature verification; requires prior auth middleware)
- **PathTenantExtractor** — extract tenant ID from URL path parameters (e.g., `/api/tenants/:tenantId/...`)
- **CompositeTenantExtractor** — fallback chain of multiple extractors (first non-null wins)
- **Lifecycle hooks** — `onTenantResolved(tenantId, req)` and `onTenantNotFound(req, res)` callbacks on `TenancyModuleOptions`
- **`onTenantNotFound` control flow** — return `'skip'` to prevent `next()` from being called, enabling custom error handling without throwing
- **`autoInjectTenantId`** option on `createPrismaTenancyExtension` — automatically injects tenant ID into `create`, `createMany`, `createManyAndReturn`, and `upsert` operations
- **`sharedModels`** option — whitelist models that bypass RLS entirely (e.g., `Country`, `Currency`)
- **`tenantIdField`** option — configurable column name for tenant ID injection (default: `tenant_id`)
- **`PrismaTenancyExtensionOptions`** type export
- E2E tests for `autoInjectTenantId` and `sharedModels` with real PostgreSQL

### Fixed

- `createManyAndReturn` now handled by `autoInjectTenantId` (previously only `createMany` was covered)

### Documentation

- Added JSDoc security warning on `JwtClaimTenantExtractor` regarding lack of signature verification
- Documented interactive transaction limitation in Prisma extension JSDoc
- Updated README with all new extractors, lifecycle hooks, and Prisma extension options

## [0.1.0] - 2026-03-23

### Added

- **TenancyModule** with `forRoot()` and `forRootAsync()` (useFactory, useClass, useExisting)
- **TenancyService** — `getCurrentTenant()` / `getCurrentTenantOrThrow()`
- **TenancyContext** — `AsyncLocalStorage`-based request-scoped tenant storage
- **TenantMiddleware** — extracts tenant ID from request, validates format
- **TenancyGuard** — global guard enforcing tenant presence (HTTP-only, skips WebSocket/gRPC)
- **HeaderTenantExtractor** — built-in header-based tenant extraction
- **`@CurrentTenant()`** parameter decorator
- **`@BypassTenancy()`** method decorator for public routes
- **`createPrismaTenancyExtension()`** — Prisma Client Extension using `Prisma.defineExtension` with batch `$transaction` and `set_config()` bind parameters for RLS
- **TenantExtractor** interface for custom extraction strategies
- UUID validation by default, customizable via `validateTenantId`
- E2E test suite with Docker Compose PostgreSQL (pg client RLS + Prisma extension RLS)
- CI workflow (Node 18/20/22) with E2E job using GitHub Actions service containers
- Release workflow with E2E gate — npm publish blocked if Prisma RLS tests fail

### Security

- Prisma extension uses `$executeRaw` tagged template with bind parameters via `set_config()`, eliminating SQL injection risk structurally
- `set_config(key, value, TRUE)` is transaction-scoped — no cross-request tenant leakage via connection pool
