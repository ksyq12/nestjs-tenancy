# Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/).

## [0.7.0] - 2026-04-03

### Added

- **Tenant ID forgery prevention** — `crossCheckExtractor` option on `TenancyModuleOptions` for cross-validating the primary tenant ID against a secondary source (e.g., JWT claim vs header). Emits `tenant.cross_check_failed` event on mismatch. Configurable via `onCrossCheckFailed: 'reject' | 'log'` (default: `'reject'`).
- **OpenTelemetry integration** — `TenancyTelemetryService` automatically adds `tenant.id` attribute to active spans. Optional `createSpans` option creates custom `tenant.resolved` spans. Follows the same graceful degradation pattern as event-emitter integration — silently skips if `@opentelemetry/api` is not installed.
- **`TelemetryOptions`** interface — configurable `spanAttributeKey` (default: `'tenant.id'`) and `createSpans` (default: `false`).
- **`TenantCrossCheckFailedEvent`** type — typed payload for the `tenant.cross_check_failed` event.
- **CLI `check --db-setting-key`** flag — pass a custom PostgreSQL setting key to `npx @nestarc/tenancy check` for projects that don't use the default `app.current_tenant`.

### Fixed

- **Bull duck-typing false positives** — `TenantContextInterceptor` now requires the `bullDataKey` to actually exist in the RPC payload data before matching as Bull transport. Previously, any object-typed RPC payload would enter the Bull extraction path.
- **CLI `check` setting key validation** — now validates ALL `current_setting()` occurrences in the SQL file, not just the first. Prevents false green when some policies reference the wrong key.
- **Telemetry span lifecycle** — `tenant.resolved` span is now closed in a `finally` block, preventing span leaks when `onTenantResolved` hook throws.

### Changed

- **CI compatibility matrix** — added `compat` job testing Nest 10 + Prisma 5 (Node 20) alongside Nest 11 + Prisma 6 (Node 22), matching the declared peer dependency range.
- **`@opentelemetry/api`** added as optional peer dependency (`^1.0.0`).

### Migration Guide

**No breaking changes.** All new features are opt-in:
- Cross-check: pass `crossCheckExtractor` to `TenancyModule.forRoot()`
- Telemetry: install `@opentelemetry/api` and optionally set `telemetry` options
- CLI: use `--db-setting-key=your.key` with `check` command if using a non-default key

## [0.6.0] - 2026-04-02

### Added

- **Bull tenant propagator** — `BullTenantPropagator` implements `TenantContextCarrier<Record<string, unknown>>` for injecting/extracting tenant context from BullMQ job data. Uses a configurable data key (default: `__tenantId`). Zero runtime dependency on `bullmq`.
- **Kafka tenant propagator** — `KafkaTenantPropagator` implements both `TenantContextCarrier<KafkaMessageLike>` and `TenantPropagator`. Handles Kafka headers that may be `string` or `Buffer`. Zero runtime dependency on `kafkajs`.
- **gRPC tenant propagator** — `GrpcTenantPropagator` implements `TenantContextCarrier<GrpcMetadataLike>`. Uses lowercase metadata keys per gRPC convention. Zero runtime dependency on `@grpc/grpc-js`.
- **`TenantContextCarrier<T>` interface** — transport-agnostic contract for propagating tenant context, following the OpenTelemetry inject/extract pattern. Complements the existing `TenantPropagator` interface (which remains unchanged).
- **`TenantContextInterceptor`** — NestJS interceptor that automatically restores tenant context from incoming microservice messages (Kafka, Bull, gRPC). HTTP is skipped (handled by `TenantMiddleware`). Supports explicit `transport` option to avoid duck-typing ambiguity. Properly propagates Observable teardown for streaming/long-lived handlers.
- **CLI `check` command** — `npx @nestarc/tenancy check` compares `tenancy-setup.sql` against the Prisma schema to detect drift (missing or extra RLS policies). Exits with code 0 (in sync) or 1 (drift detected).
- **CLI `--dry-run` flag** — `npx @nestarc/tenancy init --dry-run` previews generated SQL and module code without writing files.
- **Multi-schema CLI support** — `@@schema("name")` directives are now fully supported. Generated SQL uses schema-qualified table names (e.g., `"auth"."users"`) and includes `GRANT USAGE ON SCHEMA` for each non-public schema.

### Changed

- **`TenancyContext`** is now exported from the root package entrypoint, enabling direct construction for propagator and interceptor usage.
- **`interactiveTransactionSupport`** — new stable option replacing `experimentalTransactionSupport`. Validates Prisma internal API availability at extension creation time (startup-time error instead of runtime failure).
- **`experimentalTransactionSupport`** is now deprecated. A console warning is emitted when used. **Backwards-compatible**: preserves the original fallback-to-batch behavior when Prisma internals are unavailable (no startup throw). Will be removed in v1.0.
- **CLI `check` deep validation** — now verifies `FORCE ROW LEVEL SECURITY`, isolation/insert policy presence, and `current_setting()` key consistency in addition to table coverage.
- **@@schema CLI message** — changed from a warning about manual adjustment to an informational message, since schema-qualified SQL is now generated automatically.
- **SQL schema grants** — `GRANT USAGE ON SCHEMA` now always quotes the schema name (e.g., `"public"`) for consistency with schema-qualified table names.

### Migration Guide

**Interactive transaction support (non-breaking):**

```typescript
// Before (v0.5.x) — experimental flag
createPrismaTenancyExtension(tenancyService, {
  experimentalTransactionSupport: true, // still works, deprecated warning
});

// After (v0.6.0) — stable flag
createPrismaTenancyExtension(tenancyService, {
  interactiveTransactionSupport: true, // recommended
});
```

**Microservice propagation (new):**

```typescript
// Producer: inject tenant into Bull job
const propagator = new BullTenantPropagator(new TenancyContext());
await queue.add('process', propagator.inject({ orderId: '123' }));

// Consumer: auto-restore tenant via interceptor
app.useGlobalInterceptors(
  new TenantContextInterceptor(new TenancyContext()),
);
```

## [0.5.1] - 2026-04-01

### Fixed

- **FORCE ROW LEVEL SECURITY** — CLI-generated SQL now includes `ALTER TABLE ... FORCE ROW LEVEL SECURITY` in addition to `ENABLE`. Without `FORCE`, table owners bypass RLS silently. README Quick Start updated with the same fix and an expanded warning about table ownership.
- **dbSettingKey CLI emission** — CLI `module-setup.ts` now always emits `dbSettingKey` into the Prisma extension options block when it differs from the default, even if `autoInjectTenantId` and `sharedModels` are not set.
- **Custom regex slash injection** — CLI scaffold now uses `new RegExp('...')` instead of `/.../` literal for `validateTenantId`, preventing syntax errors when user-provided regex contains `/`.
- **@@schema detection** — Prisma schema parser now detects `@@schema(...)` directives and emits a warning during `npx @nestarc/tenancy init` for multi-schema projects. Full schema-qualified SQL generation added in v0.6.0.
- **Express types peer dependency** — Added `@types/express` as an optional peer dependency. Public interfaces (`TenantExtractor`, `TenancyModuleOptions`, event types) import Express `Request`/`Response`, which could cause type resolution failures for consumers without Express types installed.
- **Internal `any` cleanup** — Replaced 6 `any` usages in internal logic (`expect-tenant-isolation.ts`, `prisma-tenancy.extension.ts`) with `Record<string, unknown>`. Remaining `any` usages are at external system boundaries (Prisma `defineExtension`, NestJS `DynamicModule`, optional `@nestjs/event-emitter`).
- **Handover doc safety** — Replaced `$executeRawUnsafe` string interpolation example in `docs/handover.md` with safe `$executeRaw` tagged template pattern matching shipping code.

## [0.5.0] - 2026-04-01

### Added

- **HTTP tenant propagation** — `propagateTenantHeaders()` helper function returns the current tenant ID as an HTTP header object. Works with any HTTP client (fetch, axios, got, undici) without additional dependencies.
- **`HttpTenantPropagator`** class — injectable propagator for HTTP-based tenant context forwarding between microservices
- **`TenantPropagator`** interface — extensibility point for future transport propagation (Kafka, gRPC, Bull planned for v0.6.0)
- **`TenantContextMissingError`** — new base error class for all tenancy context errors. Enables unified `instanceof` catch handling for both service-level and Prisma-level errors.
- **`DEFAULT_PROPAGATION_HEADER`** constant (`'X-Tenant-Id'`)

### Changed (Breaking)

- **`getCurrentTenantOrThrow()`** now throws `TenantContextMissingError` instead of a generic `Error`. The error message is unchanged (`'No tenant context available'`), but `catch` blocks using `instanceof Error` will still work. Blocks using exact class checks need to update.
- **`TenancyContextRequiredError`** now extends `TenantContextMissingError` instead of `Error`. This enables a clean error hierarchy where `instanceof TenantContextMissingError` catches both service-level and Prisma fail-closed errors.

### Migration Guide

**Error handling (breaking):**

```typescript
// Before (v0.4.0) — generic Error, no way to distinguish
try {
  tenancyService.getCurrentTenantOrThrow();
} catch (e) {
  if (e instanceof Error) { /* catches everything */ }
}

// After (v0.5.0) — typed errors with hierarchy
import { TenantContextMissingError, TenancyContextRequiredError } from '@nestarc/tenancy';

try {
  tenancyService.getCurrentTenantOrThrow();
} catch (e) {
  if (e instanceof TenantContextMissingError) {
    // Catches both service-level and Prisma fail-closed errors
  }
  if (e instanceof TenancyContextRequiredError) {
    // Catches only Prisma fail-closed errors (has model, operation)
  }
}
```

**Tenant propagation (new, opt-in):**

```typescript
import { propagateTenantHeaders } from '@nestarc/tenancy';

// In any service method running inside a tenant context:
const res = await fetch('http://orders-service/api/orders', {
  headers: { ...propagateTenantHeaders() },
});
```

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
