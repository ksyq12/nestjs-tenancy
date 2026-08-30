# Nestarc modern ecosystem compatibility fixture

This private application is the fully published NestJS 11.2.1 and Prisma
7.10.0 ecosystem lane. The repository runner copies it to a fresh temporary
directory, installs only the committed public-registry lock with strict peer
resolution, generates the Prisma 7 client, and runs the complete API key →
tenancy → RBAC → PostgreSQL RLS/outbox → jobs → webhook flow.

The fixture is intentionally separate from the legacy NestJS 10.4.20 / Prisma
6.19.3 baseline. It accepts no candidate tarball or sibling source override.
Every direct dependency is exact. Before code generation or semantic tests,
the verifier checks the installed name/version, public npm resolution,
lockfile SHA-512 integrity, non-link/non-symlink status, and isolated realpath.

`@opentelemetry/api@1.9.1` is an exact supporting dependency because tenancy
0.15.0's exported telemetry declaration references its public types when this
consumer compiles with `skipLibCheck=false`.

The E2E command enables Node's VM modules for Prisma 7's generated query
compiler, whose CommonJS client loads the PostgreSQL runtime through dynamic
imports while running inside Jest.

Local runs start PostgreSQL under a unique Compose project with a
Docker-assigned host port. Cleanup targets only that project, so a concurrent
legacy ecosystem run cannot lose its database when the modern lane finishes.

Run it from the repository root:

```bash
npm run test:e2e:ecosystem:modern:published-only
```
