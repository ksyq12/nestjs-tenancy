-- Create a non-superuser role for testing RLS
-- (RLS is bypassed for superusers even with FORCE ROW LEVEL SECURITY)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user LOGIN PASSWORD 'app_user';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE tenancy_test TO app_user;

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

-- Enable RLS (applies to non-superuser roles)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS tenancy_users_tenant_id_idx ON users (tenant_id);

-- Create isolation policies (DROP IF EXISTS for idempotency)
DROP POLICY IF EXISTS tenant_isolation ON users;
CREATE POLICY tenant_isolation ON users
  USING (tenant_id = current_setting('app.current_tenant', true)::text);

DROP POLICY IF EXISTS tenant_insert ON users;
CREATE POLICY tenant_insert ON users
  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::text);

-- Seed test data
INSERT INTO users (tenant_id, name, email) VALUES
  ('11111111-1111-1111-1111-111111111111', 'Alice', 'alice@tenant1.com'),
  ('11111111-1111-1111-1111-111111111111', 'Bob', 'bob@tenant1.com'),
  ('22222222-2222-2222-2222-222222222222', 'Charlie', 'charlie@tenant2.com'),
  ('22222222-2222-2222-2222-222222222222', 'Diana', 'diana@tenant2.com'),
  ('33333333-3333-3333-3333-333333333333', 'Eve', 'eve@tenant3.com');

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
