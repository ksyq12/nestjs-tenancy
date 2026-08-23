# Nestarc ecosystem compatibility fixture

This private application is copied to a temporary directory by
`npm run test:e2e:ecosystem`. It never imports workspace source files. The
runner installs the current `@nestarc/tenancy` tarball, local sibling package
tarballs when available, and otherwise the exact published ecosystem versions
from `package.json`.

The graph is intentionally fixed to Node 22, NestJS 10, and Prisma 6.19.3,
which is the runtime intersection of tenancy, RBAC, outbox, jobs, and webhook.
`@nestarc/api-keys@0.3.0` still declares its optional Prisma peer as Prisma 5
only, so the runner currently uses `npm install --legacy-peer-deps`. The fixture
does not use the API keys Prisma adapter and verifies the full runtime path, but
a clean strict install remains a known ecosystem metadata gap.
