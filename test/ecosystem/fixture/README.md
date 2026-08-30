# Nestarc ecosystem compatibility fixture

This private NestJS 10 + Prisma 6 application is copied to a temporary
directory by the repository ecosystem runner. It never imports workspace source
files or searches for sibling repositories.

## Explicit artifact modes

The default command and the hosted CI/release job use the fully published,
known-good tuple:

```bash
npm run test:e2e:ecosystem
# Equivalent explicit command:
npm run test:e2e:ecosystem:published-only
```

`published-only` installs all six exact `@nestarc/*` versions from the public
npm registry using the committed `package-lock.json`. It does not pack the
current tenancy checkout. This baseline proves the published tuple; it is not a
substitute for testing an unpublished tenancy candidate.

To test an unpublished candidate, create its exact tarball from a fresh clean
checkout or worktree so ignored `dist/` cannot contain stale output. Review the
identity returned by `npm pack --json`, then pass that regular `.tgz` file:

```bash
npm ci
npm run build
mkdir -p /private/tmp/nestarc-tenancy-candidate
npm pack --json --pack-destination /private/tmp/nestarc-tenancy-candidate \
  --cache /private/tmp/nestarc-tenancy-pack-cache
npm run test:e2e:ecosystem:local-artifact -- \
  --tenancy-tarball /absolute/path/to/nestarc-tenancy-<version>.tgz
```

`local-artifact` replaces only `@nestarc/tenancy`. API Keys, RBAC, Jobs,
Outbox, and Webhook remain the exact published packages in the committed lock.
The option rejects directories, missing tarballs, and implicit source roots;
there is no `NESTARC_ECOSYSTEM_SOURCE_ROOT` fallback.

## Determinism and provenance

- Both modes use strict `npm ci` without `--force` or
  `--legacy-peer-deps`.
- The published graph is frozen by this fixture's committed lockfile.
- Local mode refreshes only the tenancy entry in a temporary lockfile. It
  fails if any non-tenancy package identity, resolution, or integrity changes.
- The candidate tarball's SHA-512 is computed independently and must match the
  temporary lock entry.
- Before the semantic typecheck and E2E, the verifier asserts each installed
  package's name, version, registry-or-file source, SHA-512 lock integrity,
  non-symlink status, and location inside the isolated fixture. It prints one
  structured provenance record per package.

The hosted lane runs on Node 22. The fixture dependency graph remains fixed to
NestJS 10.4.20 and Prisma 6.19.3, the current intersection of tenancy, API Keys,
RBAC, Outbox, Jobs, and Webhook; supported local Node 24 runs are also valid.
The flow covers API key → tenancy → RBAC → Prisma/RLS + Outbox → Jobs → Webhook
HTTP. The audit-log/soft-delete mega fixture remains owned by the audit-log
repository and is intentionally not duplicated here.
