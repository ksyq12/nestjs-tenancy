# Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.11.0] - 2026-05-01

### Added

- **`tenant.extraction_failed` event** — extractor exceptions are now emitted with safe error metadata and `requestSummary` before the original error is rethrown.
- **Tenant index generation and drift checks** — generated RLS setup SQL now includes tenant indexes, and the CLI check command reports missing tenant indexes.
- **JWT extractor hardening** — `JwtClaimTenantExtractor` now validates `exp` / `nbf` claims and includes a base64url fallback for runtimes without native `Buffer` base64url support.
- **Bypass transition metadata** — `tenant.context_bypassed` payloads now include `previousTenantId` when `withoutTenant()` is called inside an existing tenant context.
- **Testing helper safeguards** — `expectTenantIsolation()` now fails on empty two-tenant datasets, and `TestTenancyModule` provides default module options for broader provider tests.
- **Structured error serialization** — `TenancyContextRequiredError` now exposes `toJSON()` with `name`, `message`, `model`, and `operation`.

### Changed (Breaking)

- **Prisma extension fail-closed by default** — `createPrismaTenancyExtension()` now treats `failClosed` as `true` when omitted. Model operations without tenant context throw `TenancyContextRequiredError` unless the model is listed in `sharedModels` or the call runs inside `withoutTenant()`. Set `failClosed: false` explicitly to keep the previous pass-through behavior.
- **Safe event request payloads** — built-in tenancy events now emit `requestSummary` (`{ method, path, ip, userAgent }`) instead of the raw request object. Listener code that reads `event.request` must migrate to `event.requestSummary`.

### Changed

- **Global DI symbols** — tenancy DI/metadata tokens now use `Symbol.for('@nestarc/tenancy/...')`, avoiding duplicate-package token mismatches in monorepos and bundled workspaces.
- **NestJS 11 wildcard route compatibility** — middleware registration uses the path-to-regexp v8 named wildcard pattern (`{*splat}`) while remaining compatible with NestJS 10.
- **Bearer token parsing** — JWT extraction now accepts case-insensitive `Bearer` schemes and flexible whitespace.
- **`runWithoutTenant()` return semantics** — sync callbacks now return sync values, matching `TenancyContext.run()` overload behavior.
- **Telemetry lifecycle spans** — tenant spans can now run as active OpenTelemetry scopes, preserving child-span parentage and tenant attributes.
- **Benchmark methodology** — RLS overhead benchmarks now compare like-for-like app-user scenarios and report pure extension overhead separately from row-count reduction.
- **TypeScript module resolution** — compiler settings now use the Node16 module resolution path required by modern TypeScript.
- **Root barrel type-only exports** — public interfaces and option types now use `export type`, improving compatibility with `isolatedModules` and `verbatimModuleSyntax`.
- **Async options inject typing** — `TenancyModuleAsyncOptions.inject` now reuses Nest's `FactoryProvider['inject']` type instead of `any[]`.
- **Flat cross-check deprecation target** — `crossCheckExtractor` and `onCrossCheckFailed` remain supported but are now documented for removal in `v0.12.0`.

### Fixed

- **`forRootAsync({})` validation** — invalid async module options now throw immediately during module construction instead of failing later during Nest dependency resolution.
- **CLI setup hardening** — custom regex input is validated before code generation, generated regex strings are safely escaped, and generated SQL no longer creates `app_user` with a hard-coded password.
- **Extractor edge cases** — path extraction now ignores query/hash fragments and decodes URL-encoded path segments, subdomain extraction rejects IP/IPv6 hosts, and composite extraction preserves synchronous return paths when all extractors are synchronous.
- **Error subclass behavior** — tenancy error classes now restore the prototype chain and capture V8 stack traces so `instanceof` works reliably in downlevel/transpiled consumers.
- **Prisma `upsert.update` tenant mutation** — auto-injection now prevents user-provided `tenantIdField` changes in the update branch.
- **Propagation edge cases** — Bull data-key collisions now fail fast, and gRPC fallback duck-typing is stricter to avoid non-metadata objects.
- **Test and build stability** — removed async test timeout traps, shared common mocks, and fixed strict TypeScript casts in telemetry and Prisma extension code.

### Security

- **RLS production guidance** — README now documents required PostgreSQL patch versions for CVE-2024-10976 and operational limits around indexes, owner bypass, connection pooling, caches, and noisy neighbors.
- **Default tenant indexes** — generated RLS SQL now adds tenant indexes to avoid full scans on common tenant-filtered queries.

### Deprecation Policy

Deprecated public APIs are marked with `@deprecated` JSDoc and documented here. Unless a security issue requires faster removal, deprecated APIs are planned for removal two minor versions later or at the next major release, whichever comes first. Current deprecated APIs:

| API | Deprecated since | Planned removal |
|-----|------------------|-----------------|
| `crossCheckExtractor` | v0.10.0 | v0.12.0 |
| `onCrossCheckFailed` | v0.10.0 | v0.12.0 |

## [0.10.1] - 2026-04-08

### Added

- **`crossCheck.required` option** — when `true`, rejects requests with `ForbiddenException` if the cross-check extractor returns `null` (e.g., missing JWT). Enforces that every request must have a verifiable secondary tenant source. Defaults to `false`, preserving existing skip-on-null behavior.

### Fixed

- **`TenancyContext.run()` async overload** — added function overloads so async callbacks correctly return `Promise<T>` instead of `T`. Prevents silent bugs where callers omit `await` without a TypeScript error.
- **Prisma schema parser brace handling** — replaced `[^}]*` regex with line-by-line brace-balancing parser. Fields with brace-containing defaults (e.g., `@default("{}")`) no longer cause `@@map` and `@@schema` directives to be missed.
- **`SubdomainTenantExtractor` non-null assertion** — replaced `pslModule!` with explicit null check after `require('psl')`, removing the unsafe TypeScript non-null assertion.

### Changed

- **Observable teardown subscription type** — `innerSub` in `TenantContextInterceptor` explicitly typed as `Subscription | undefined`, clarifying the optional-chaining intent in the teardown function.
- **`propagateTenantHeaders()` singleton** — replaced per-call `new TenancyContext()` with a module-level singleton instance, matching the pattern used in `current-tenant.decorator.ts`.

### Documentation

- **`onTenantResolved` JSDoc** — documented error propagation behavior: throwing is safe (telemetry span closes via `finally`), `getCurrentTenant()` is available inside the callback.
- **`@BypassTenancy()` JSDoc** — clarified that the decorator only bypasses the guard, not the tenant context. `getCurrentTenant()` may still return a value and Prisma queries remain RLS-filtered.
- **`onTenantNotFound` skip warning** — strengthened JSDoc to explicitly warn that returning `'skip'` without sending a response causes the HTTP request to hang indefinitely.
- **README** — removed deprecated `experimentalTransactionSupport` from extension options table, updated cross-check section with `crossCheck` sub-object format and `required` option, clarified `@BypassTenancy` behavior.

## [0.10.0] - 2026-04-08

### Added

- **`crossCheck` sub-object format** — new grouped configuration for tenant ID forgery prevention: `crossCheck: { extractor, onFailed }`. The flat `crossCheckExtractor` / `onCrossCheckFailed` fields are deprecated (planned removal in v0.12.0) and emit a warning when used.
- **`PrismaTransactionClient` structural type** — exported interface for typing the `prisma` parameter in `tenancyTransaction()`. Replaces the previous `any` type. `PrismaClient` satisfies this automatically.
- **`TenancyEventMap` type** — type-safe mapping from event names to payload types. `TenancyEventService.emit()` now enforces correct event/payload combinations at compile time.
- **`TenancyResponse` method signatures** — optional `status()`, `json()`, `end()` methods for better IDE guidance in `onTenantNotFound` callbacks.
- **`PathTenantExtractor` constructor validation** — throws immediately if `paramName` is not found in `pattern` (previously returned `null` silently for every request).
- **Test coverage audit** — 24 new unit tests closing P0–P3 coverage gaps: Prisma `$transaction` error propagation, concurrent tenant isolation, TelemetryService `onModuleInit` success path, TenancyModule `useExisting` branch, Interceptor gRPC/Kafka Buffer extraction, middleware extractor throw propagation, and more.

### Changed (Breaking)

- **`TenancyRequest` / `TenancyResponse` index signature** changed from `[key: string]: any` to `[key: string]: unknown`. Platform-specific properties now require type assertion: `(request as import('express').Request).cookies`. This was already the documented recommended pattern.
- **`experimentalTransactionSupport` removed** from `PrismaTenancyExtensionOptions`. Deprecated since v0.6.0 — use `interactiveTransactionSupport` instead.
- **`TenantContextInterceptorOptions`** changed from `interface` to discriminated union `type`. When `transport` is specified, only the matching transport key is accepted. Existing code without `transport` is fully compatible via the `transport?: undefined` variant.
- **`TenancyTransactionOptions.isolationLevel`** narrowed from `string` to `'ReadUncommitted' | 'ReadCommitted' | 'RepeatableRead' | 'Serializable'`.

### Changed (Non-Breaking)

- **`TenantStore`** (internal) changed from `interface` to discriminated union, preventing contradictory `tenantId + bypassed` states.
- **Constants consolidated** — `DEFAULT_BULL_DATA_KEY` and `DEFAULT_GRPC_METADATA_KEY` moved to `tenancy.constants.ts`, eliminating duplication in propagator and interceptor files.
- **`tenancyTransaction()` `prisma` parameter** typed as `PrismaTransactionClient` instead of `any`. No runtime change — `PrismaClient` already satisfies this structural type.

### Migration Guide

**`experimentalTransactionSupport` users:**
```typescript
// Before (v0.9.0)
createPrismaTenancyExtension(service, { experimentalTransactionSupport: true });
// After (v0.10.0)
createPrismaTenancyExtension(service, { interactiveTransactionSupport: true });
```

**`TenancyRequest` dynamic property access:**
```typescript
// Before — no type error
request.cookies.session;
// After — use type assertion
(request as import('express').Request).cookies.session;
```

**`crossCheck` configuration (optional — old format still works with deprecation warning):**
```typescript
// Before (deprecated, planned removal in v0.12.0)
TenancyModule.forRoot({
  crossCheckExtractor: new JwtClaimTenantExtractor({ claimKey: 'org_id' }),
  onCrossCheckFailed: 'reject',
})
// After (recommended)
TenancyModule.forRoot({
  crossCheck: {
    extractor: new JwtClaimTenantExtractor({ claimKey: 'org_id' }),
    onFailed: 'reject',
  },
})
```

## [0.9.0] - 2026-04-06

### Added

- **`TenancyRequest` / `TenancyResponse` interfaces** — framework-agnostic HTTP types that replace direct Express dependency in the public API. Compatible with Express, Fastify, and raw Node.js `http.IncomingMessage`.

### Changed (Breaking)

- **`TenantExtractor.extract()`** now accepts `TenancyRequest` instead of Express `Request`. Existing implementations using Express `Request` continue to work due to TypeScript's structural typing and method bivariance. If you need Express-specific properties, use type assertion: `(request as import('express').Request)`.
- **`TenancyModuleOptions` callbacks** (`onTenantResolved`, `onTenantNotFound`) now use `TenancyRequest` / `TenancyResponse` instead of Express types.
- **Event payload types** (`TenantResolvedEvent`, etc.) now use `TenancyRequest` instead of Express `Request`.
- **`@types/express`** removed from `peerDependencies`. Only needed as a devDependency if you use Express-specific type assertions.

### Fixed

- **Custom Extractor docs** updated to use `TenancyRequest` instead of Express `Request`
- **Compatibility claim** clarified: Prisma 6 is E2E-tested, Prisma 5 is unit-tested
- **Lifecycle hook table** in README updated to `TenancyRequest` / `TenancyResponse` signatures
- **`SECURITY.md`** updated with `0.9.x` supported release line
- **`postbuild` script** replaced POSIX-only `printf | cat | mv` with cross-platform Node.js one-liner
- **`test:e2e` script** replaced POSIX shell chaining with cross-platform `scripts/test-e2e.js` runner

### Migration Guide

**Express users (most common):** No code changes required. `express.Request` satisfies `TenancyRequest` structurally. Your existing extractors and callbacks compile without modification.

**Fastify users:** You can now use `@nestarc/tenancy` without installing `@types/express`. Fastify `FastifyRequest` satisfies `TenancyRequest`.

**Custom extractor authors:** If your extractor uses Express-specific properties (e.g., `req.cookies`, `req.ip`), they are still accessible via the `[key: string]: any` index signature. For full type safety, cast: `(request as import('express').Request).cookies`.

## [0.8.0] - 2026-04-04

### Fixed

- **Build regression** — `@opentelemetry/api` was declared as a devDependency but not installed, causing `TS2307` build failures on clean checkout. Now properly installed and verified.

### Added

- **Span lifecycle regression test** — verifies that the `tenant.resolved` telemetry span is closed (via `finally`) even when `onTenantResolved` hook throws.
- **CLI check regression tests** — verifies mixed `current_setting()` key detection across multiple policies, and validates that `--db-setting-key` custom flag works end-to-end.
- **interactiveTransactionSupport E2E test** — real-database test verifying RLS isolation inside interactive transactions using Prisma internal APIs (`_createItxClient`).

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
