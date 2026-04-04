# v0.8.0 Stabilization Release — Design Spec

Date: 2026-04-04
Status: Draft

## Goal

Resolve all known issues from the v0.7.0 validation report. No new features — this is a stability and documentation release that ensures the codebase is clean, buildable, fully tested, and accurately documented.

## Issues to Resolve

### 1. OTel dynamic import breaks TypeScript build (P1)

**Problem**: `TenancyTelemetryService.onModuleInit()` uses `await import('@opentelemetry/api')` which fails TS compilation when the package is not installed (it's an optional peer dependency).

**Fix**: Add a TypeScript path mapping or `@ts-ignore` / type-only import guard so the dynamic import compiles without the package present. The runtime behavior (graceful degradation) is already correct — only the compile-time check fails.

**Approach**: Use a `try/catch` around `require()` instead of `import()` to avoid TS module resolution, OR add `@opentelemetry/api` to `devDependencies` (already done in latest commit 8b93d0d but appears not to be taking effect — verify `node_modules` state). Alternatively, use `// @ts-ignore` on the dynamic import line as a minimal fix.

**Preferred**: Verify that `@opentelemetry/api` is in devDependencies and installed. If the TS error persists, add a triple-slash `/// <reference types="..." />` directive or use `require()` with a hand-written type declaration.

**Files**: `src/telemetry/tenancy-telemetry.service.ts`, `package.json`

### 2. Telemetry span not closed on `onTenantResolved` throw (P3 → P2)

**Problem**: In `tenant.middleware.ts:82-90`, `startSpan()` is called before `onTenantResolved`, but `endSpan()` is only in the happy path. If the hook throws, the span leaks.

**Fix**: Move `endSpan()` into a `finally` block. The current code already has a try block — just needs a finally.

**Files**: `src/middleware/tenant.middleware.ts`
**Test**: `test/tenant.middleware.spec.ts` — add test case for hook-throw span cleanup.

### 3. CLI `check` — `--db-setting-key` flag not wired (P1)

**Problem**: `src/cli/index.ts:14-17` parses `--db-setting-key=<key>` from args and passes it to `runCheck()`, but the parsing logic may not work correctly. Additionally, the README documents this but it's not validated.

**Fix**: Verify the flag parsing works correctly. Add a unit test for the CLI entrypoint flag parsing. Ensure `runCheck()` uses the custom key for all `current_setting()` comparisons.

**Files**: `src/cli/index.ts`, `src/cli/check.ts`, `test/cli/check.spec.ts`

### 4. CLI `check` — `current_setting()` validation checks only first match (P2)

**Problem**: The regex loop in `check.ts:118-124` uses `matchAll` which should iterate all matches, but the warning may be incomplete. Need to verify the loop actually catches ALL mismatched keys, not just the first.

**Fix**: Verify the `matchAll` loop covers all occurrences. Add a test with a SQL file containing mixed keys (first correct, second incorrect) to ensure the drift is caught.

**Files**: `src/cli/check.ts`, `test/cli/check.spec.ts`

### 5. README documentation gaps (P2)

**Problem**: The README does not document:
- `crossCheckExtractor` / `onCrossCheckFailed` module options
- `telemetry` module option
- `tenant.cross_check_failed` event (5th event, README only lists 4)
- `TenancyTelemetryService` usage

**Fix**: Add sections to README covering cross-check configuration, telemetry configuration, and update the event table to include all 5 events.

**Files**: `README.md`

### 6. `interactiveTransactionSupport` E2E test coverage (P2)

**Problem**: The ITX feature relies on Prisma internal APIs (`_createItxClient`, `__internalParams`) but only has unit tests with mocks. No real-database E2E test exists.

**Fix**: Add an E2E test in `test/e2e/prisma-extension.e2e-spec.ts` that:
1. Creates a Prisma client with `interactiveTransactionSupport: true`
2. Runs an interactive transaction
3. Verifies RLS isolation is maintained within the transaction

**Constraint**: E2E tests require Docker (PostgreSQL). The test should be added to the existing E2E suite and run via `npm run test:e2e`.

**Files**: `test/e2e/prisma-extension.e2e-spec.ts`

### 7. Version bump + CHANGELOG (P3)

**Problem**: `package.json` shows 0.7.0. Need to bump to 0.8.0 and add a CHANGELOG entry.

**Fix**: Update `package.json` version to `0.8.0`. Add a `0.8.0` block to `CHANGELOG.md` listing all stabilization fixes.

**Files**: `package.json`, `CHANGELOG.md`

## Execution Order

The issues have dependencies:

```
1. OTel build fix ──→ (unlocks all tests)
   ├─ 2. Span lifecycle fix + test
   ├─ 3. CLI check flag fix + test
   ├─ 4. CLI check matchAll fix + test
   ├─ 5. README docs
   └─ 6. ITX E2E test (requires Docker, may be added but not runnable in all environments)
7. Version bump + CHANGELOG (last)
```

Issue 1 must be first. Issues 2-6 are independent and can proceed in any order. Issue 7 is last.

## Success Criteria

- `npm run build` passes with clean install
- `npm test` — all suites pass (currently 3 failing → 0 failing)
- `npm run lint` passes
- No P1/P2 findings in a self-review pass
- README documents all public API surface
- CHANGELOG accurately describes all changes

## Out of Scope

- New features (multi-DB strategy, ORM adapters, health check, etc.)
- Breaking API changes
- NestJS/Prisma version support changes
