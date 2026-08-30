DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'ecosystem_app') THEN
    CREATE ROLE ecosystem_app LOGIN PASSWORD 'ecosystem_app';
  ELSE
    ALTER ROLE ecosystem_app WITH LOGIN PASSWORD 'ecosystem_app' NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO ecosystem_app', current_database());
END
$$;

DROP TABLE IF EXISTS webhook_delivery_attempts CASCADE;
DROP TABLE IF EXISTS webhook_deliveries CASCADE;
DROP TABLE IF EXISTS webhook_events CASCADE;
DROP TABLE IF EXISTS webhook_endpoints CASCADE;
DROP TABLE IF EXISTS outbox_events CASCADE;
DROP TABLE IF EXISTS ecosystem_projects CASCADE;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE ecosystem_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE ecosystem_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecosystem_projects FORCE ROW LEVEL SECURITY;
CREATE INDEX ecosystem_projects_tenant_idx ON ecosystem_projects (tenant_id);
CREATE POLICY ecosystem_projects_select ON ecosystem_projects
  USING (tenant_id = current_setting('app.current_tenant', true)::text);
CREATE POLICY ecosystem_projects_insert ON ecosystem_projects
  FOR INSERT WITH CHECK (
    tenant_id = current_setting('app.current_tenant', true)::text
  );

CREATE TABLE outbox_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(255) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  retry_count INT NOT NULL DEFAULT 0,
  max_retries INT NOT NULL DEFAULT 5,
  last_error TEXT,
  tenant_id VARCHAR(255),
  aggregate_type VARCHAR(255),
  aggregate_id VARCHAR(255),
  partition_key VARCHAR(255),
  idempotency_key VARCHAR(255),
  correlation_id VARCHAR(255),
  causation_id VARCHAR(255),
  headers JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ecosystem_outbox_status
    CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED'))
);
CREATE INDEX ecosystem_outbox_pending_idx
  ON outbox_events (created_at) WHERE status = 'PENDING';

CREATE TABLE webhook_endpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  url VARCHAR(2048) NOT NULL,
  secret VARCHAR(255) NOT NULL,
  previous_secret TEXT,
  previous_secret_expires_at TIMESTAMPTZ,
  events VARCHAR(255)[] NOT NULL DEFAULT '{}',
  active BOOLEAN NOT NULL DEFAULT TRUE,
  description VARCHAR(500),
  metadata JSONB,
  tenant_id VARCHAR(255),
  consecutive_failures INT NOT NULL DEFAULT 0,
  disabled_at TIMESTAMPTZ,
  disabled_reason VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(255) NOT NULL,
  payload JSONB NOT NULL,
  tenant_id VARCHAR(255),
  idempotency_key VARCHAR(255),
  correlation_id VARCHAR(255),
  payload_purged_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX webhook_events_idempotency_key_idx
  ON webhook_events (COALESCE(tenant_id, ''), event_type, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE webhook_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES webhook_events(id),
  endpoint_id UUID NOT NULL REFERENCES webhook_endpoints(id),
  endpoint_url_snapshot TEXT,
  signing_secret_snapshot TEXT,
  secondary_signing_secret_snapshot TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED')),
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  next_attempt_at TIMESTAMPTZ,
  claimed_at TIMESTAMPTZ,
  last_attempt_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  response_status INT,
  response_body TEXT,
  latency_ms INT,
  last_error TEXT
);
CREATE INDEX ecosystem_webhook_pending_idx
  ON webhook_deliveries (next_attempt_at, id) WHERE status = 'PENDING';
CREATE INDEX ecosystem_webhook_sending_idx
  ON webhook_deliveries (claimed_at, id) WHERE status = 'SENDING';

CREATE TABLE webhook_delivery_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES webhook_deliveries(id) ON DELETE CASCADE,
  attempt_number INT NOT NULL,
  status VARCHAR(20) NOT NULL
    CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED')),
  response_status INT,
  response_body TEXT,
  response_body_truncated BOOLEAN NOT NULL DEFAULT FALSE,
  latency_ms INT,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (delivery_id, attempt_number)
);

GRANT USAGE ON SCHEMA public TO ecosystem_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ecosystem_app;
