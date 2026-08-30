# Changelog

All notable changes to this project will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed (Breaking)

- Removed the deprecated optional raw `request` field from the exported
  `TenantResolvedEvent`, `TenantNotFoundEvent`, `TenantExtractionFailedEvent`,
  `TenantValidationFailedEvent`, and `TenantCrossCheckFailedEvent` payload
  declarations. Listeners must use the allow-listed `requestSummary`; JavaScript
  and custom emitters must also stop attaching or consuming the raw field.
- Raised the supported Node.js runtime contract from `>=20.19.0` to `^22.13.0 || ^24.0.0`, removed the EOL Node.js 20 CI lane, and aligned development types with Node.js 22. This pre-1.0 breaking change is planned for 0.16.0; Node.js 20 consumers must upgrade their runtime or remain on 0.15.x. Publishing 0.16.0 remains on hold until the tracked sibling-package compatibility evidence is complete.
- Changed CLI-generated index and policy names for uppercase, punctuation, Unicode, or overlong schema/table/tenant-column inputs to use deterministic 12-hex SHA-256 suffixes within PostgreSQL's 63-byte limit. Existing lowercase ASCII short names remain unchanged, except that the old explicit-`public_` form now shares the implicit-public identity; operators with affected generated names must review and migrate the live objects before adopting the regenerated canonical SQL.
- Changed `tenancy init` to require each non-shared model to map exactly one required scalar `String` field to the physical tenant column. Missing, duplicate, nullable, list, `@ignore`, non-String, `Unsupported`, and unknown native tenant types now stop scaffolding before generated files are written instead of falling back to an assumed text policy.
- Changed generated RLS to add one restrictive non-empty context guard per tenant table. Valid non-empty TEXT predicates remain unchanged, while reset/no-context access to an existing empty tenant row and no-context insertion of a new one are now denied; existing deployments must regenerate or sequentially reapply the SQL, pass `tenancy check`, and verify the new guard with `tenancy doctor`. Markerless legacy SQL remains structurally supported but is now reported as drift when this semantic guard is missing or invalid.

### Added

- Added the exported `TenantIdValidator` contract shared by HTTP module configuration and `TenantContextInterceptor`, with explicit sync or async validation for inbound Kafka, Bull, and gRPC tenant identifiers before context restoration and handler execution.
- Added RPC invalid-context diagnostics through `tenant.context_invalid` and `nestarc.tenancy.invalid_context`; the interceptor does not copy the rejected ID or raw carrier data and reports only transport, operation, and optional caller-supplied stable resource metadata.
- Added Prisma-schema-derived TEXT/UUID tenant policy generation. Required `String`, `Text`, `VarChar`, and `Char` fields preserve the existing text predicate, while `String @db.Uuid` uses `NULLIF(current_setting(..., true), '')::uuid`; mapped logical Prisma fields are carried into generated auto-injection configuration, including Unicode Prisma identifiers and datasource names.

### Changed

- Made `TenancyModule`'s validated `dbSettingKey` the canonical runtime setting inherited by the Prisma extension and `tenancyTransaction()`. Explicit identical values remain compatible, while mismatches now fail before database work starts.
- Updated CLI scaffolding to emit a custom database setting key once in module configuration while sharing the same default and validator across runtime, `init`, `check`, and `doctor`.
- Preserved the existing non-empty RPC tenant identifier behavior when no interceptor validator is supplied during 0.x. The planned v1.0.0 default is the same UUID-like validation used by HTTP; non-UUID consumers can preserve their contract with an explicit custom validator.
- Updated the repository Prisma 7 CLI, client, and PostgreSQL adapter baseline together from 7.9.1 to the stable 7.10.0 release while retaining the exact Prisma 6.19.3 compatibility lane.
- Made `tenancy check` and `tenancy doctor` validate the same per-table TEXT/UUID policy contract. `check` requires a semantically exact restrictive context guard even for markerless legacy SQL, while allowing a custom legacy guard name; doctor derives and checks the exact generated live name. Doctor now distinguishes PostgreSQL text-family and UUID catalog types and uses UUID-semantic comparisons during active probes.

### Fixed

- Preserved synchronous tenant-scoped cache keys for `@nestjs/cache-manager` 2.x while retaining asynchronous base-key support for 3.x, preventing a Promise object from being passed to 2.x cache stores as the key.
- Wrapped CLI-generated tenancy SQL in an explicit transaction that is atomic under the documented fail-fast client contract and safe to reapply sequentially. Existing same-table/name policies are preserved for live `doctor` drift review; an operator can place an explicit drop inside a reviewed transaction when replacement is intended.
- Qualified models without `@@schema` as `public` targets so `search_path` cannot redirect generated DDL, and made catalog guards independent of `standard_conforming_strings` for mapped identifiers.
- Kept `tenancy check` compatible with catalog-guarded policy blocks while accepting policy evidence inside `DO` only when the entire block has the canonical guard shape, and rejecting broken markers, a missing transaction envelope, unsupported statements, unguarded policies, non-model targets, or unqualified targets in generated sections.
- Preserved markerless legacy SQL's structural compatibility while making its tenant safety contract fail closed: a missing or malformed restrictive non-empty context guard now produces `inSync: false` and an actionable warning.
- Made generated index and policy names source-local and collision-resistant across lossy normalization, PostgreSQL case folding, and truncation; `check` and `doctor` now derive the same exact names as `init`.
- Prevented native UUID policies from raising an invalid-cast error after transaction-local tenant settings are cleaned up by guarding PostgreSQL's reset empty string before the UUID cast.
- Prevented the same reset empty string from matching or inserting an empty TEXT tenant by combining the existing permissive tenant policies with an additive `AS RESTRICTIVE` context guard.

### Security

- Reassessed the `prisma` development-tool path to vulnerable `deepmerge-ts@7.1.5`: production installs remain at zero audit findings, Prisma 7.10.0 still pins the affected dependency through `@prisma/config`, and npm's breaking downgrade suggestion is intentionally not applied while the upstream fix is pending.

### Tests

- Split the Nestarc ecosystem runner into explicit `published-only` and
  tenancy `local-artifact` modes, removed ambient sibling discovery, committed
  the fixture lockfile, and added strict installed name/version/source/SHA-512
  assertions while preserving the NestJS 10 + Prisma 6 full flow.
- Added source and strict packed-consumer public type probes that keep both
  deprecated surfaces available until their scheduled removal releases across
  the exact Prisma 6.19.3/7.10.0 compatibility matrix.
- Preserved the existing exact Prisma 6.19.3/7.10.0 transparent-mode
  real-database regression until `interactiveTransactionSupport` is removed.
- Replaced the diagonal in-repository NestJS/Prisma compatibility override with isolated, strict-install packed-tarball consumers covering NestJS 10/11 × Prisma 6/7, including supported lower-bound and repository-locked optional cache/event profiles.
- Added an isolated actual-tarball consumer smoke for the root, cache, and testing runtime/declaration exports; the cache-free root import; and the installed CLI bin, shebang, help, and invalid-invocation exit contract.
- Added Kafka string/Buffer, gRPC metadata, and Bull data validator coverage for valid, invalid, missing, async, cancellation, context isolation, and redacted diagnostics paths.
- Required the Prisma CLI, client, and PostgreSQL adapter to use one identical version before PgBouncer E2E starts, and moved the Prisma 7 consumer and pooler lanes to exact 7.10.0.
- Added real PostgreSQL coverage for generated SQL double apply, preserved policy drift and explicit replacement, post-reapply active doctor isolation, rollback of earlier models after a later failure, `search_path` shadowing, and mapped identifiers with non-standard string settings.
- Added same-schema PostgreSQL coverage for normalization and long-name collisions, including double apply, one tenant index and three generated policies per table, exact doctor recognition, global generated-name uniqueness, and the 63-byte bound.
- Added real PostgreSQL TEXT/UUID coverage from `init` through canonical `check`, SQL apply, catalog/contract `doctor`, tenant A/B isolation, no-context fail-closed behavior, and COMMIT/ROLLBACK setting cleanup.
- Added an empty TEXT tenant row and no-context insert attempt to the real PostgreSQL fixture so reset-value isolation is proved rather than inferred from non-empty tenant data.

### Documentation

- Selected v0.16.0 for removal of the deprecated event payload `request` type
  field and v0.17.0 for `interactiveTransactionSupport`, with last-supported
  versions, migrations, privacy rationale, and consumer-usage uncertainty in
  the [deprecated API removal ADR](https://github.com/nestarc/nestjs-tenancy/blob/main/docs/2026-08-30-deprecated-api-removal-adr.md). TEN-B09 now implements the v0.16.0 event-field removal while preserving transparent transaction support through v0.16.x.
- Documented the exact four-way NestJS/Prisma consumer evidence, valid optional cache/event pairings, and the separation between install/type/runtime smoke and database behavior lanes.
- Defined the latest-minor-only security support policy for the current 0.15.x line and separated the already-published Node.js contract, the Unreleased 0.16.0 contract, and the NestJS/Prisma combinations actually exercised by CI.
- Documented the exact Node.js 22.13.0 minimum lane, current Node.js 22/24 lanes, and the 0.16.0 compatibility-evidence release hold.
- Corrected the private vulnerability reporting path and centralized the current raw Prisma query, WebSocket, and managed-pooler guarantee boundaries.
- Added the inbound RPC validation compatibility ADR and clarified that tenant propagation, format validation, and context restoration do not authenticate message producers or authorize access to the claimed tenant.
- Documented the generated-name compatibility boundary and the reviewed migration required when legacy non-canonical names change to hashed identifiers.
- Documented the supported Prisma tenant field types, the distinction between inbound `tenantFormat` and database storage, unchanged TEXT output, and the reviewed data/policy migration required when adopting UUID storage.

### Current Deprecation Inventory

The exact decisions and migration contract are recorded in the
[deprecated API removal ADR](https://github.com/nestarc/nestjs-tenancy/blob/main/docs/2026-08-30-deprecated-api-removal-adr.md).

| API | Added | Deprecated since | Last supported | Removal target | Replacement |
|-----|-------|------------------|----------------|----------------|-------------|
| `interactiveTransactionSupport` | v0.6.0 | v0.15.0 | v0.16.x | v0.17.0 | `tenancyTransaction()` |

The event payload optional `request` field was deprecated in v0.11.0 and
removed in v0.16.0 after v0.15.x as its last supported line. Use
`requestSummary`.

## [0.15.0] - 2026-08-24

### Added

- Added a live PostgreSQL `doctor` command that audits RLS enablement, forced RLS, policies, roles, tenant indexes, and optional active isolation probes.
- Added Prisma 6 and Prisma 7 PgBouncer transaction-mode E2E coverage, including commit, rollback, timeout, pool contention, and native/driver-adapter paths.
- Added configurable non-HTTP missing-context diagnostics (`ignore`, `warn`, or `throw`) with telemetry support for propagators and tenant-scoped resources.
- Added tenant-scoped resource-key and search helpers for cache, Redis, queue, gRPC, Kafka, and search integration paths.
- Added a strict tarball-installed Nestarc ecosystem compatibility fixture and CI/release gate covering API Keys, RBAC, RLS, Outbox, Jobs, and Webhook flows.

### Changed

- Added `maxWait` forwarding to `tenancyTransaction()` and expanded its transaction failure and isolation-level contracts.
- Deprecated transparent `interactiveTransactionSupport`, introduced in v0.6.0, in favor of the explicit `tenancyTransaction()` API. At publication, removal eligibility began in v0.17.0 or an earlier v1.0.0 and the exact release was pending; TEN-M18 later selected v0.17.0.
- Updated the ecosystem compatibility baseline to the published `@nestarc/api-keys@0.3.1` and `@nestarc/jobs@0.3.1` packages.

## [0.14.0] - 2026-08-02

### Added

- First-class Prisma 7 support with Prisma Config, the `prisma-client` generator, and PostgreSQL driver-adapter E2E coverage.
- A Prisma 6 compatibility CI lane alongside the Prisma 7 primary test matrix.

### Changed (Breaking)

- Raised the minimum Node.js version from 18 to 20.19, matching Prisma 7's runtime requirement.
- Made Prisma 7 the development and E2E baseline. Prisma 6 remains supported; Prisma 5 is no longer supported.
- Updated Prisma setup examples to use a generated client output and `@prisma/adapter-pg`.

### Fixed

- Import `Prisma.defineExtension` from `@prisma/client/extension`, allowing shared extensions to build without a generated `@prisma/client` root export.
- Moved the E2E datasource URL to `prisma.config.ts`, as required by Prisma 7.

## [0.13.0] - 2026-06-06

### Added

- **`TenantCacheInterceptor`** — Nest cache interceptor variant that scopes response cache keys by the current tenant.
- **`@SharedTenantCache()`** — route/class decorator for intentionally shared cache entries.
- **`@nestarc/tenancy/cache` subpath** — dedicated cache runtime API export for `TenantCacheInterceptor`, `SharedTenantCache`, and cache options symbols.
- **Optional cache peer metadata** — `@nestjs/cache-manager` and `cache-manager` are declared as optional peers for applications that enable response caching.

### Changed

- Kept the root `@nestarc/tenancy` entrypoint free of eager cache runtime imports; cache APIs must be imported from `@nestarc/tenancy/cache`.

### Fixed

- Preserved NestJS 10 middleware registration by selecting the legacy `*` wildcard route path on Nest 10 while using the named `{*splat}` path on Nest 11 and newer.

### Security

- Tenant-aware cache keys prevent Redis/in-memory response cache key collisions across tenants, but they do not authorize access. Shared cache opt-in only changes cache key generation.

## [0.12.0] - 2026-05-23

### Changed (Breaking)

- Removed deprecated flat cross-check module options: `crossCheckExtractor` and `onCrossCheckFailed`. Use `crossCheck: { extractor, onFailed, required }`.

### Changed

- Added package `engines.node` metadata matching the documented Node.js >= 18 support.
- Moved `prompts` to regular dependencies so the documented interactive CLI works in normal installs.
- Made CLI shebang injection idempotent.

### Fixed

- Local `npm run test:e2e` now provides default `DATABASE_URL` and `APP_DATABASE_URL` values before Prisma generation while preserving caller-provided environment variables.

### Tests

- Added public API smoke coverage for root and testing entrypoints.
- Added regression coverage for E2E runner defaults and CLI shebang idempotency.

### Documentation

- Added v0.12.0 cross-check migration guidance.
- Clarified JWT claim extraction, `@BypassTenancy()` semantics, `withoutTenant()`, and interactive transaction recommendations.

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
- **Safe event request payloads** — built-in tenancy events now emit `requestSummary` (`{ method, path, ip, userAgent, host }`) instead of the raw request object. Listener code that reads `event.request` must migrate to `event.requestSummary`.

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

Deprecated public APIs are marked with `@deprecated` JSDoc and documented here. Unless a security issue requires faster removal, deprecated APIs are planned for removal two minor versions later or at the next major release, whichever comes first. At the v0.11.0 release, the deprecated APIs were:

| API | Deprecated since | Planned removal |
|-----|------------------|-----------------|
| `crossCheckExtractor` | v0.10.0 | v0.12.0 |
| `onCrossCheckFailed` | v0.10.0 | v0.12.0 |
| Event payload optional `request` type field | v0.11.0 | v0.13.0 |

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
