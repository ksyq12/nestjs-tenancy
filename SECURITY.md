# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.8.x   | ✅        |
| 0.7.x   | ✅        |
| 0.6.x   | ✅        |
| < 0.6   | ❌        |

## Reporting a Vulnerability

If you discover a security vulnerability in `@nestarc/tenancy`, please report it responsibly:

1. **Do not** open a public GitHub issue
2. Email: **security@nestarc.dev** (or open a [GitHub Security Advisory](https://github.com/ksyq12/nestjs-tenancy/security/advisories/new))
3. Include: description, reproduction steps, affected versions, and potential impact

We will acknowledge receipt within 48 hours and aim to release a fix within 7 days for critical issues.

## Security Design

This library handles tenant isolation at the database level via PostgreSQL Row Level Security (RLS). Key security properties:

- **SQL injection prevention**: `set_config()` is called via `$executeRaw` tagged template with bind parameters — no string interpolation
- **Transaction-scoped isolation**: `set_config(key, value, TRUE)` is equivalent to `SET LOCAL`, scoped to the batch transaction
- **Tenant ID validation**: UUID format validation by default, customizable via `validateTenantId`
- **JWT extractor**: Does **not** verify JWT signatures — requires prior authentication middleware (documented in JSDoc)
