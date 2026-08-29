# ADR: Inbound RPC Tenant ID Validation Compatibility

- Date: 2026-08-29
- Status: Accepted
- Work item: `TEN-M09`

## Context

`TenantMiddleware` validates HTTP tenant identifiers with
`TenancyModuleOptions.validateTenantId`. When that option is omitted, HTTP uses
the built-in dashed UUID-like validator.

`TenantContextInterceptor` historically restored any non-empty string decoded
from Kafka headers, Bull job data, or gRPC metadata. Existing applications and
published examples may therefore use identifiers such as `tenant-abc` or
`org_acme`. Applying the HTTP default to RPC during 0.x would reject messages
that previously reached their handlers.

Tenant identifier format validation is also distinct from trust. A
syntactically valid identifier does not prove who produced a message or whether
that producer may act for the claimed tenant.

## Decision

HTTP module configuration and the RPC interceptor share one exported contract:

```typescript
export type TenantIdValidator = (
  tenantId: string,
) => boolean | Promise<boolean>;
```

HTTP behavior does not change: omitting `validateTenantId` continues to use the
built-in dashed UUID-like validator.

For all 0.x releases, RPC validation is opt-in. Omitting
`TenantContextInterceptorOptions.validateTenantId` preserves the existing
non-empty-string restoration behavior. No per-message or constructor migration
warning is emitted.

When an explicit RPC validator returns or resolves to `false`, the interceptor:

1. does not establish tenant context;
2. does not invoke the handler;
3. reports `tenant.context_invalid` through a supplied module-backed
   `TenantContextDiagnostics`;
4. rejects with `BadRequestException('Invalid tenant ID format')`.

The invalid-context diagnostic contains only `transport`, `operation`, and an
optional caller-supplied stable `resource`. The interceptor never copies the
rejected tenant identifier, raw carrier data, identifier length, or validator
error text into it. Callers must keep `resource` low-cardinality and
non-sensitive rather than placing tenant/user IDs or secrets in it.
OpenTelemetry uses the same fields for the `tenant.context_invalid` span event
and `nestarc.tenancy.invalid_context` counter.

A validator that throws or returns a rejected promise propagates its original
error, matching the existing HTTP contract. Applications should not include
tenant identifiers in validator error messages.

Invalid input is separate from missing context. `missingContext.policy`
continues to control only absent tenant context; an explicit validator returning
`false` always rejects.

At `v1.0.0`, omitting the RPC validator will use the same built-in UUID-like
default as HTTP. Applications using non-UUID identifiers must continue passing
an explicit custom validator.

## Trust Boundary

`TenantContextInterceptor` decodes, optionally validates, and restores a tenant
claim. It does not:

- authenticate Kafka, Bull, or gRPC producers;
- configure broker ACLs, TLS, SASL, or mTLS;
- verify message signatures;
- bind an authenticated principal to the claimed tenant;
- apply HTTP `crossCheck` or `onTenantResolved` behavior to RPC messages.

Deployments must authenticate the producer or channel and authorize the
authenticated principal for the claimed tenant before tenant-scoped work is
performed. Format validation is defense in depth, not authorization.

## Consequences

- Existing non-UUID RPC consumers remain compatible throughout 0.x.
- HTTP and RPC temporarily have different omitted-validator defaults.
- Applications can reuse one synchronous or asynchronous validator across HTTP
  and RPC.
- Manually constructed interceptors must receive the validator explicitly and
  should receive the module-resolved diagnostics instance for event and
  telemetry reporting.
- Invalid-context observability stays low-cardinality and does not expose the
  rejected value.

## Alternatives Considered

### Apply UUID-like validation immediately

Rejected because it would break documented and deployed non-UUID RPC messages
during 0.x.

### Continue accepting every non-empty identifier

Rejected because applications need a supported way to reject malformed or
unexpected tenant claims before context and handler execution.

### Treat invalid identifiers as missing context

Rejected because `ignore` or `warn` missing-context policies could then execute
the handler. Invalid input requires a distinct fail-closed path.

### Implicitly inherit module options

Rejected because `TenantContextInterceptor` is commonly constructed manually
and may be used without `TenancyModule`; implicit inheritance would be
unreliable and obscure the trust boundary.
