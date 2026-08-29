# Security Policy

## Supported Versions

`@nestarc/tenancy` is pre-1.0. Security fixes are provided for the latest
published minor release line only; publishing a new minor normally ends
security support for the previous minor. Always use the newest patch in the
supported line.

| Package release line  | Security fixes     |
|-----------------------|--------------------|
| 0.15.x                | ✅                 |
| 0.14.x and earlier    | ❌ Upgrade to 0.15.x |

Package security support and upstream runtime maintenance are separate.
Already-published 0.15.x artifacts declare Node.js >= 20.19.0, but Node.js 20
is upstream EOL and security fixes for the package do not restore upstream
runtime support. The Unreleased source planned for 0.16.0 declares
`^22.13.0 || ^24.0.0`; CI and release source gates cover exact Node.js 22.13.0,
the current Node.js 22 release, and the current Node.js 24 release. Publishing
0.16.0 remains on hold until the tracked sibling-package compatibility evidence
is complete. Node.js 26 support is not declared. See the README's
[support and compatibility](./README.md#support-and-compatibility) section for
the declared NestJS and Prisma ranges, the exact strict-consumer combinations,
and the separate database behavior lanes exercised by CI.

## Reporting a Vulnerability

If you discover a security vulnerability in `@nestarc/tenancy`, please report it responsibly:

1. **Do not** open a public GitHub issue, discussion, or pull request.
2. Email [security@nestarc.dev](mailto:security@nestarc.dev), the currently
   supported private intake channel.
3. Include a description, minimal reproduction steps, affected versions, and
   potential impact. Do not include production credentials or customer data.

We aim to acknowledge receipt within 48 hours and to release a fix within 7
days for critical issues. Remediation and coordinated disclosure timing can
vary with impact, complexity, and downstream coordination; if the target cannot
be met, we will provide a status update and the next expected milestone.

## Security Design

This library handles tenant isolation at the database level via PostgreSQL Row Level Security (RLS). Key security properties:

- **SQL injection prevention**: `set_config()` is called via `$executeRaw` tagged template with bind parameters — no string interpolation
- **Transaction-scoped isolation**: `set_config(key, value, TRUE)` is equivalent to `SET LOCAL`, scoped to the batch transaction
- **Tenant ID validation**: UUID format validation by default, customizable via `validateTenantId`
- **JWT extractor**: Does **not** verify JWT signatures — requires prior authentication middleware (documented in JSDoc)

## Current Guarantee Boundaries

- Automatic fail-closed enforcement applies to Prisma model operations. Raw
  Prisma operations such as `$queryRaw` and `$executeRaw` bypass the extension
  and require `tenancyTransaction()` or an equivalent explicit transaction
  that performs parameterized `set_config()` and the raw operation through the
  same transaction client and connection.
- Inbound tenant restoration is covered for HTTP, Kafka, Bull, and gRPC.
  WebSocket tenant enforcement/restoration is not currently provided.
- The verified pooler contract is the repository's pinned PgBouncer transaction
  mode configuration. Prisma Data Proxy, managed poolers, and production-specific
  pooler settings remain outside the repository support guarantee. Deployment
  owners must validate the exact production configuration with equivalent
  isolation, rollback, reuse, and concurrency scenarios.
