-- Create a non-superuser application role for testing RLS. Existing roles are
-- reused without changing their password or security-sensitive attributes.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'app_user';
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO app_user', current_database());
END
$$;

-- Create test tables (idempotent — safe to run multiple times)
DROP TABLE IF EXISTS users CASCADE;
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL
);

-- Grant permissions to app_user
GRANT USAGE ON SCHEMA public TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON users TO app_user;
GRANT USAGE, SELECT ON SEQUENCE users_id_seq TO app_user;

-- Keep the primary fixture aligned with generated setup SQL and doctor checks.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE users FORCE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS tenancy_users_tenant_id_idx ON users (tenant_id);

-- Create isolation policies (DROP IF EXISTS for idempotency)
DROP POLICY IF EXISTS tenant_isolation_users ON users;
CREATE POLICY tenant_isolation_users ON users
  USING (tenant_id = current_setting('app.current_tenant', true)::text);

DROP POLICY IF EXISTS tenant_insert_users ON users;
CREATE POLICY tenant_insert_users ON users
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::text);

DROP POLICY IF EXISTS tenant_context_guard_users ON users;
CREATE POLICY tenant_context_guard_users ON users
  AS RESTRICTIVE
  USING (NULLIF(current_setting('app.current_tenant', true), '') IS NOT NULL)
  WITH CHECK (NULLIF(current_setting('app.current_tenant', true), '') IS NOT NULL);

-- Seed test data
INSERT INTO users (tenant_id, name, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Alice', 'alice@tenant1.com'),
  ('11111111-1111-1111-1111-111111111111', 'Bob', 'bob@tenant1.com'),
  ('22222222-2222-2222-2222-222222222222', 'Charlie', 'charlie@tenant2.com'),
  ('22222222-2222-2222-2222-222222222222', 'Diana', 'diana@tenant2.com'),
  ('33333333-3333-3333-3333-333333333333', 'Eve', 'eve@tenant3.com');

-- Dedicated raw fixture for the table-owner path. app_user owns this table, so
-- the active tests only observe tenant filtering when FORCE is truly effective.
DROP TABLE IF EXISTS force_owner_users CASCADE;
CREATE TABLE force_owner_users (
  id INTEGER PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL
);

ALTER TABLE force_owner_users OWNER TO app_user;
ALTER TABLE force_owner_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE force_owner_users FORCE ROW LEVEL SECURITY;
CREATE INDEX tenancy_force_owner_users_tenant_id_idx
  ON force_owner_users (tenant_id);

CREATE POLICY tenant_isolation_force_owner_users ON force_owner_users
  USING (tenant_id = current_setting('app.current_tenant', true)::text);
CREATE POLICY tenant_insert_force_owner_users ON force_owner_users
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::text);
CREATE POLICY tenant_context_guard_force_owner_users ON force_owner_users
  AS RESTRICTIVE
  USING (NULLIF(current_setting('app.current_tenant', true), '') IS NOT NULL)
  WITH CHECK (NULLIF(current_setting('app.current_tenant', true), '') IS NOT NULL);

INSERT INTO force_owner_users (id, tenant_id, name) VALUES
  (1, '11111111-1111-1111-1111-111111111111', 'Owner Alice'),
  (2, '11111111-1111-1111-1111-111111111111', 'Owner Bob'),
  (3, '22222222-2222-2222-2222-222222222222', 'Owner Charlie'),
  (4, '22222222-2222-2222-2222-222222222222', 'Owner Diana');

-- Shared table for sharedModels testing (no RLS)
DROP TABLE IF EXISTS countries CASCADE;
CREATE TABLE countries (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT NOT NULL
);

GRANT SELECT, INSERT, UPDATE, DELETE ON countries TO app_user;
GRANT USAGE, SELECT ON SEQUENCE countries_id_seq TO app_user;

INSERT INTO countries (name, code) VALUES
  ('United States', 'US'),
  ('South Korea', 'KR');
