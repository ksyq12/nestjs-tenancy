# ADR: Doctor Manifest and Batch Contract

- Date: 2026-08-30
- Status: Accepted
- Work items: `TEN-M23A`, `TEN-M23B`, `TEN-M23C`

## Context

The doctor command currently audits one fully-qualified tenant table per
invocation. Its programmatic and CLI contracts return one versioned
`DoctorResult`, preserve a deterministic check order, never include the database
URL in output, and use exit codes `0` for healthy, `1` for findings or
inconclusive probes, and `2` for usage, connection, or query errors.

Operators commonly deploy the same application role and tenant setting across
many tables. Repeating one process per table is slow, makes partial failures
difficult to inventory, and encourages ad-hoc shell aggregation that loses the
doctor's structured error and redaction guarantees.

## Decision

### Invocation and compatibility

`doctor --table=<schema.table> --role=<role>` remains unchanged. Batch mode is
selected with `doctor --manifest=<path>`; `--table` and `--manifest` are
mutually exclusive. A database URL is still supplied only by `--url` or
`DATABASE_URL`. A manifest cannot contain a URL, password, or other connection
secret.

Batch JSON is a new `DoctorBatchResult` envelope. Existing single-table JSON,
text, field order, and exit behavior are not changed. Batch output contains one
ordered `DoctorResult` per table, so existing result consumers can reuse their
single-table interpretation.

### Manifest schema

The initial JSON schema is:

```json
{
  "schemaVersion": 1,
  "defaults": {
    "role": "app_user",
    "dbSettingKey": "app.current_tenant",
    "tenantColumn": "tenant_id",
    "tenantA": "11111111-1111-1111-1111-111111111111",
    "tenantB": "22222222-2222-2222-2222-222222222222"
  },
  "tables": [
    { "table": "public.users" },
    { "table": "billing.invoices", "tenantColumn": "account_id" }
  ]
}
```

`schemaVersion` must equal `1`. Unknown properties are rejected at every level
so misspelled safety settings cannot be silently ignored. `tables` must be a
non-empty array with no duplicate fully-qualified table identity. Each table
inherits `role`, `dbSettingKey`, `tenantColumn`, `tenantA`, and `tenantB` from
`defaults` and may override any of them. `role` must exist after inheritance.
The existing doctor option validator remains authoritative for PostgreSQL
identifiers, setting keys, tenant values, and active-probe combinations.

The manifest does not control active mode, concurrency, or timeouts. These are
execution authorities and resource limits chosen at invocation time, not
persistent data that a reviewed inventory file may silently escalate.

### Ordering, concurrency, and partial failure

Tables are admitted and emitted in manifest declaration order. Results remain
in that order regardless of completion order. Each table uses an independent
database client so a failed query or aborted transaction cannot poison another
table's session.

Batch concurrency defaults to `4`, must be between `1` and `16`, and is bounded
by both that value and the table count. A timeout is a batch admission deadline:
after it expires, no new table starts, while in-flight tables are allowed to
finish their query/transaction cleanup. An `AbortSignal` has the same
cooperative behavior. This may make wall-clock return later than the requested
deadline, but avoids abandoning an open PostgreSQL transaction merely to return
early. Not-started tables receive an ordered error result. The first
interruption wins: a caller abort is not relabeled as a timeout if the deadline
passes while cleanup is finishing.

A connection or query error for one table is captured in that table's
`DoctorResult`; other tables continue. Manifest parse/validation failure is a
batch-level error and starts no connections.

### Aggregate result and exit code

The batch envelope has this stable top-level order:

1. `schemaVersion`
2. `status`
3. `exitCode`
4. `summary`
5. `results`
6. optional `error`

The summary counts tables by final status and sums all table check summaries.
Exit precedence is deterministic: any operational or admission error produces
exit `2`; otherwise any unhealthy/warning table produces exit `1`; otherwise
the batch exits `0`. The aggregate status follows the same precedence:
`error`, `unhealthy`, `warning`, then `healthy`.

### Active probe safety

Active probes run only when the operator supplies `--active` for that
invocation. Every effective table must then have distinct tenant A/B values;
otherwise manifest validation fails before any connection is created.

The existing read-only transaction, transaction-local tenant setting,
statement timeout, and post-COMMIT/post-ROLLBACK cleanup checks remain the
per-table contract. Batch mode also sets a session-level statement timeout
before catalog work so a blocked catalog query is bounded; active probe
transactions may preserve or lower that bound but never raise it. Cancellation is checked before admitting a table and
between active-probe transactions. If cancellation arrives during a probe,
the current transaction rolls back before the table returns an error. Separate
clients and bounded concurrency isolate cleanup across tables.

### Redaction

Neither the manifest nor any output structure contains the connection URL.
Runtime errors continue through the existing URL/password redactor. Manifest
errors identify property names and table indexes but never echo property
values. Tenant A/B values are inputs to parameterized queries and are not
copied into targets, checks, aggregate output, or error messages.

## Consequences

- A checked-in manifest can inventory many tables without storing credentials.
- Operators receive useful results for healthy and drifted tables even when a
  peer table has a connection or query error.
- Parallel work is bounded and deterministic at the output boundary.
- Cooperative cancellation prioritizes database cleanup over an exact
  wall-clock return deadline.
- Adding a new manifest field or changing result semantics requires a schema
  version decision rather than silent acceptance.

## Alternatives Considered

### Put the database URL in the manifest

Rejected because inventory files are commonly committed, attached to tickets,
or retained as CI artifacts. Keeping connection secrets in process environment
or an explicit CLI argument preserves the existing redaction boundary.

### Let the manifest enable active probes

Rejected because merely selecting an inventory file should not initiate live
data reads. Active mode requires a fresh, visible operator opt-in.

### Share one client across tables

Rejected because `pg.Client` serializes queries and one failed transaction can
contaminate later work. It would also make bounded parallelism and per-table
cleanup harder to reason about.

### Return immediately on timeout

Rejected because abandoning in-flight read-only transactions and clients would
weaken the cleanup contract. The selected deadline stops new admissions and
waits for already-started work to close.
