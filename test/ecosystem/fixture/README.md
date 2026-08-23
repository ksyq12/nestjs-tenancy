# Nestarc ecosystem compatibility fixture

This private application is copied to a temporary directory by
`npm run test:e2e:ecosystem`. It never imports workspace source files. The
runner installs the current `@nestarc/tenancy` tarball, local sibling package
tarballs when available, and otherwise the exact published ecosystem versions
from `package.json`.

The graph is intentionally fixed to Node 22, NestJS 10, and Prisma 6.19.3,
which is the runtime intersection of tenancy, RBAC, outbox, jobs, and webhook.
The runner uses strict `npm install` without `--legacy-peer-deps` or `--force`.
The API Keys tarball used by the local sibling-package path declares and tests
its optional Prisma peer against Prisma 5 and 6. Published-only CI/release runs
must use `@nestarc/api-keys@0.3.1` or a later compatible release containing that
widened peer metadata.
