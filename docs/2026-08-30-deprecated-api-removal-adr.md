# ADR: Deprecated Public API Removal Schedule

- Date: 2026-08-30
- Status: Accepted
- Work item: `TEN-M18`

## Context

`@nestarc/tenancy` plans to remove deprecated public APIs two minor releases
after deprecation or in the next major release, whichever comes first, unless a
security issue requires an earlier change. Two deprecated surfaces remain.

| Public API | Added | Deprecated | Last supported | Removal target | Replacement |
| --- | --- | --- | --- | --- | --- |
| `PrismaTenancyExtensionOptions.interactiveTransactionSupport` | v0.6.0 | v0.15.0 | v0.16.x | v0.17.0 | `tenancyTransaction()` |
| Event payload optional `request` field | v0.4.0 | v0.11.0 | v0.15.x | v0.16.0 | `requestSummary` |

The event field is inherited by the exported `TenantResolvedEvent`,
`TenantNotFoundEvent`, `TenantExtractionFailedEvent`,
`TenantValidationFailedEvent`, and `TenantCrossCheckFailedEvent` types.
`TenantContextBypassedEvent` does not expose the field and is not part of this
removal.

The already-removed `experimentalTransactionSupport` option is a different API:
it was introduced before `interactiveTransactionSupport`, deprecated in v0.6.0,
and removed in v0.10.0. This decision does not reopen that historical
compatibility path.

The raw request contract has separate runtime and source-compatibility dates.
Built-in producers last emitted a raw request in v0.10.1. Since v0.11.0 they
have emitted only `requestSummary`, while the optional deprecated `request`
property has remained in public TypeScript declarations. It became eligible for
removal in v0.13.0 but remained available through v0.15.x. Repository history
does not contain an approved reason for extending the declaration beyond that
eligibility point.

`interactiveTransactionSupport` detects Prisma interactive transactions with
the private `__internalParams.transaction` shape and constructs a transaction
client through the private `_createItxClient` hook. Startup can check that the
hook exists, but cannot validate the complete metadata contract. A Prisma
internal change can therefore make transparent detection silently miss a
transaction.

## Decision

The optional event `request` property will be removed in v0.16.0. The current
v0.15.x line is its last source-compatible release line. v0.16.0 is already a
documented pre-1.0 breaking release, built-in producers have not supplied the
field since v0.11.0, and retaining a framework request reference extends an
unnecessary privacy and retention hazard. Waiting until v1.0.0 would prolong a
deprecated declaration that has already exceeded its stated removal window.

`interactiveTransactionSupport` will be removed in v0.17.0. The v0.16.x line
is its last supported release line. Removing it in v0.16.0 would violate the
two-minor policy attached to its v0.15.0 deprecation; waiting until v1.0.0 would
extend reliance on unversioned Prisma internals without a demonstrated consumer
need.

This ADR selects v0.17.0 rather than v1.0.0 for the transparent mode. A later
decision to skip v0.17.0 and release v1.0.0 directly must explicitly supersede
this schedule rather than silently changing the removal target.

`TEN-M18` changes documentation, deprecation metadata, and compatibility
fixtures only. `TEN-B09` owns both implementation removals and their release
notes; no deprecated runtime or type is removed here.

## Interactive Transaction Migration

Before migration, the extended client transparently reacts to private Prisma
transaction metadata:

```typescript
const prisma = basePrisma.$extends(
  createPrismaTenancyExtension(tenancyService, {
    interactiveTransactionSupport: true,
  }),
);

await tenancyContext.run(tenantId, () =>
  prisma.$transaction(async (tx) => tx.invoice.findMany()),
);
```

Migrate the transaction boundary to `tenancyTransaction()` and pass the raw,
unextended Prisma client:

```typescript
// Keep the extension for non-interactive model operations.
const prisma = basePrisma.$extends(
  createPrismaTenancyExtension(tenancyService),
);

await tenancyContext.run(tenantId, () =>
  tenancyTransaction(
    basePrisma,
    tenancyService,
    async (tx) => {
      const invoices = await tx.invoice.findMany();
      await tx.auditEntry.create({
        data: { tenant_id: tenantId, action: 'invoice.listed' },
      });
      return invoices;
    },
    {
      maxWait: 2_000,
      timeout: 5_000,
      isolationLevel: 'Serializable',
    },
  ),
);
```

The helper uses only Prisma's public interactive transaction API. It resolves
the tenant and database setting key before opening the transaction, executes
transaction-local `set_config()` as the first statement, and then passes the
same transaction client to the callback. The callback must perform all work
through that supplied `tx` client.

This is an explicit boundary rather than transparent extension behavior. The
raw transaction client does not run the extension's `autoInjectTenantId`,
`sharedModels`, or `failClosed` model-query logic. Creates must therefore supply
the configured logical tenant field explicitly, use a reviewed database
default, or be performed outside this helper through an appropriate supported
path. PostgreSQL RLS still evaluates queries using the transaction-local tenant
setting. The helper itself remains fail-closed: it resolves the tenant with
`getCurrentTenantOrThrow()` and rejects before opening `$transaction()` when
tenant context is missing.

Until v0.17.0, the exact Prisma 6.19.3 and 7.10.0 PgBouncer lanes must continue
running the transparent-mode real-database regression in addition to the
canonical helper tests. The strict packed-consumer matrix remains separate: it
checks install, declaration, and minimal runtime compatibility for both Prisma
majors, while the PgBouncer matrix owns the data-path contract.

## Event Payload Migration and Privacy

Listener code must read the allow-listed summary:

```typescript
import type { TenantResolvedEvent } from '@nestarc/tenancy';

function onTenantResolved(event: TenantResolvedEvent): void {
  // Select only fields this audit record actually needs.
  audit({
    tenantId: event.tenantId,
    method: event.requestSummary?.method,
  });
}
```

Code must not fall back to `event.request`. Raw framework request objects can
retain authorization headers, cookies, bodies, uploaded data, sockets, and
framework-specific object graphs. Passing them to an event bus also makes
accidental logging and long-lived listener retention more likely.

`requestSummary` deliberately contains only `method`, `path`, `ip`,
`userAgent`, and `host`, and every field is optional. It is observability
metadata, not an authentication or authorization input. Applications must
still apply appropriate minimization and retention rules to IP addresses and
user-agent values. Paths and hosts can also contain sensitive or
high-cardinality values and require the same review.

If a listener needs application-specific request data, extract an explicit,
reviewed value in the request pipeline and publish a separate application event
instead of retaining the framework request object.

Removing the TypeScript property in v0.16.0 will not strip an extra `request`
property manually attached by JavaScript code or a custom emitter. Applications
must stop publishing and consuming that property; the built-in producers'
summary-only behavior remains unchanged.

## Consumer Evidence and Uncertainty

The repository has no property-level consumer telemetry for either deprecated
surface. In-repository uses of `interactiveTransactionSupport` are compatibility
tests, and no production source in this repository reads the legacy event
`request` property. Those facts do not establish that external or private
consumers are absent. npm download counts and package installation telemetry
cannot reveal TypeScript property usage, so downstream impact remains unknown.

The v0.16.0 and v0.17.0 release notes must therefore repeat the relevant
migration, and release verification must use the public declaration fixtures
and compatibility lanes rather than assuming that a lack of reports means a
lack of consumers.

## Consequences

- v0.16.0 removes only the deprecated raw event request declaration; built-in
  runtime payloads have already used `requestSummary` since v0.11.0.
- v0.16.x continues supporting transparent interactive transactions and keeps
  their Prisma 6/7 exact-version regressions.
- v0.17.0 removes the private-internals transaction path. Consumers must move
  transaction boundaries to `tenancyTransaction()` before upgrading.
- The two removal releases intentionally differ because the APIs were
  deprecated four minor versions apart and have different runtime risk.

## Alternatives Considered

### Remove both APIs in v0.16.0

Rejected because `interactiveTransactionSupport` was deprecated only in
v0.15.0 and must remain available through v0.16.x under the published policy.

### Remove both APIs in v0.17.0

Rejected because the raw request declaration has already remained available
beyond its v0.13.0 eligibility point and continues to expose a privacy-sensitive
shape that built-in producers no longer use.

### Wait until v1.0.0

Rejected because the current policy provides minor-release removal windows,
the raw field is already overdue, and the transparent mode depends on private
Prisma contracts. There is no consumer evidence that justifies extending
either surface to v1.0.0.
