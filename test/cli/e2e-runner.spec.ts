const {
  DEFAULT_APP_DATABASE_URL,
  DEFAULT_DATABASE_URL,
  applyDefaultEnv,
} = require('../../scripts/test-e2e');
const {
  DEFAULT_APP_DATABASE_URL: DEFAULT_PGBOUNCER_APP_DATABASE_URL,
  DEFAULT_DATABASE_URL: DEFAULT_PGBOUNCER_DATABASE_URL,
  DEFAULT_PARALLEL_APP_DATABASE_URL,
  DEFAULT_PARALLEL_PGBOUNCER_ADMIN_URL,
  DEFAULT_PGBOUNCER_ADMIN_URL,
  DEFAULT_PGBOUNCER_SESSION_ADMIN_URL,
  DEFAULT_PGBOUNCER_SESSION_DATABASE_URL,
  applyDefaultEnv: applyPgBouncerDefaultEnv,
  validatePrismaRuntimeVersions,
} = require('../../scripts/test-pgbouncer-e2e');

describe('e2e runner env defaults', () => {
  it('exports deterministic default database URLs', () => {
    expect(DEFAULT_DATABASE_URL).toBe(
      'postgresql://tenancy:tenancy@localhost:5433/tenancy_test',
    );
    expect(DEFAULT_APP_DATABASE_URL).toBe(
      'postgresql://app_user:app_user@localhost:5433/tenancy_test',
    );
  });

  it('sets database defaults when values are missing', () => {
    const env: Record<string, string | undefined> = {};

    const result = applyDefaultEnv(env);

    expect(result).toBe(env);
    expect(env.DATABASE_URL).toBe(DEFAULT_DATABASE_URL);
    expect(env.APP_DATABASE_URL).toBe(DEFAULT_APP_DATABASE_URL);
  });

  it('preserves caller-provided database values', () => {
    const env: Record<string, string | undefined> = {
      DATABASE_URL: 'postgresql://custom-owner/database',
      APP_DATABASE_URL: 'postgresql://custom-app/database',
    };

    applyDefaultEnv(env);

    expect(env.DATABASE_URL).toBe('postgresql://custom-owner/database');
    expect(env.APP_DATABASE_URL).toBe('postgresql://custom-app/database');
  });
});

describe('pgbouncer e2e runner env defaults', () => {
  it('exports direct setup and dedicated PgBouncer lane URLs', () => {
    expect(DEFAULT_PGBOUNCER_DATABASE_URL).toBe(
      'postgresql://tenancy:tenancy@localhost:5433/tenancy_test',
    );
    expect(DEFAULT_PGBOUNCER_APP_DATABASE_URL).toBe(
      'postgresql://app_user:app_user@localhost:6432/tenancy_test',
    );
    expect(DEFAULT_PGBOUNCER_ADMIN_URL).toBe(
      'postgresql://tenancy:tenancy@localhost:6432/pgbouncer',
    );
    expect(DEFAULT_PGBOUNCER_SESSION_DATABASE_URL).toBe(
      'postgresql://app_user:app_user@localhost:6433/tenancy_test',
    );
    expect(DEFAULT_PGBOUNCER_SESSION_ADMIN_URL).toBe(
      'postgresql://tenancy:tenancy@localhost:6433/pgbouncer',
    );
    expect(DEFAULT_PARALLEL_APP_DATABASE_URL).toBe(
      'postgresql://app_user:app_user@localhost:6434/tenancy_test',
    );
    expect(DEFAULT_PARALLEL_PGBOUNCER_ADMIN_URL).toBe(
      'postgresql://tenancy:tenancy@localhost:6434/pgbouncer',
    );
  });

  it('sets all PgBouncer defaults when values are missing', () => {
    const env: Record<string, string | undefined> = {};

    const result = applyPgBouncerDefaultEnv(env);

    expect(result).toBe(env);
    expect(env.DATABASE_URL).toBe(DEFAULT_PGBOUNCER_DATABASE_URL);
    expect(env.APP_DATABASE_URL).toBe(DEFAULT_PGBOUNCER_APP_DATABASE_URL);
    expect(env.PGBOUNCER_ADMIN_URL).toBe(DEFAULT_PGBOUNCER_ADMIN_URL);
    expect(env.PGBOUNCER_SESSION_DATABASE_URL).toBe(
      DEFAULT_PGBOUNCER_SESSION_DATABASE_URL,
    );
    expect(env.PGBOUNCER_SESSION_ADMIN_URL).toBe(
      DEFAULT_PGBOUNCER_SESSION_ADMIN_URL,
    );
    expect(env.PARALLEL_APP_DATABASE_URL).toBe(
      DEFAULT_PARALLEL_APP_DATABASE_URL,
    );
    expect(env.PARALLEL_PGBOUNCER_ADMIN_URL).toBe(
      DEFAULT_PARALLEL_PGBOUNCER_ADMIN_URL,
    );
  });

  it('preserves caller-provided PgBouncer values', () => {
    const env: Record<string, string | undefined> = {
      DATABASE_URL: 'postgresql://custom-owner/database',
      APP_DATABASE_URL: 'postgresql://custom-transaction/database',
      PGBOUNCER_ADMIN_URL: 'postgresql://custom-admin/pgbouncer',
      PGBOUNCER_SESSION_DATABASE_URL:
        'postgresql://custom-session/database',
      PGBOUNCER_SESSION_ADMIN_URL:
        'postgresql://custom-session-admin/pgbouncer',
      PARALLEL_APP_DATABASE_URL: 'postgresql://custom-parallel/database',
      PARALLEL_PGBOUNCER_ADMIN_URL:
        'postgresql://custom-parallel-admin/pgbouncer',
    };

    applyPgBouncerDefaultEnv(env);

    expect(env).toEqual({
      DATABASE_URL: 'postgresql://custom-owner/database',
      APP_DATABASE_URL: 'postgresql://custom-transaction/database',
      PGBOUNCER_ADMIN_URL: 'postgresql://custom-admin/pgbouncer',
      PGBOUNCER_SESSION_DATABASE_URL:
        'postgresql://custom-session/database',
      PGBOUNCER_SESSION_ADMIN_URL:
        'postgresql://custom-session-admin/pgbouncer',
      PARALLEL_APP_DATABASE_URL: 'postgresql://custom-parallel/database',
      PARALLEL_PGBOUNCER_ADMIN_URL:
        'postgresql://custom-parallel-admin/pgbouncer',
    });
  });

  it('accepts aligned supported Prisma runtime majors', () => {
    expect(
      validatePrismaRuntimeVersions({
        prisma: '6.19.3',
        client: '6.19.3',
        adapterPg: '6.19.3',
      }),
    ).toBe(6);
    expect(
      validatePrismaRuntimeVersions({
        prisma: '7.10.0',
        client: '7.10.0',
        adapterPg: '7.10.0',
      }),
    ).toBe(7);
  });

  it('rejects mixed or unsupported Prisma runtime majors', () => {
    expect(() =>
      validatePrismaRuntimeVersions({
        prisma: '7.10.0',
        client: '6.19.3',
        adapterPg: '7.10.0',
      }),
    ).toThrow(/identical Prisma 6 or 7 runtime versions/);
    expect(() =>
      validatePrismaRuntimeVersions({
        prisma: '8.0.0',
        client: '8.0.0',
        adapterPg: '8.0.0',
      }),
    ).toThrow(/identical Prisma 6 or 7 runtime versions/);
  });

  it('rejects Prisma runtimes from different patch versions', () => {
    expect(() =>
      validatePrismaRuntimeVersions({
        prisma: '7.10.0',
        client: '7.9.1',
        adapterPg: '7.10.0',
      }),
    ).toThrow(/identical Prisma 6 or 7 runtime versions/);
  });
});
