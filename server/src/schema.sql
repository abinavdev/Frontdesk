CREATE TABLE IF NOT EXISTS agents (
  id BIGSERIAL PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tickets (
  id BIGSERIAL PRIMARY KEY,
  subject TEXT NOT NULL CHECK (length(subject) BETWEEN 3 AND 180),
  description TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_token_hash TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('high','medium','low')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','waiting_customer','resolved','closed')),
  assignee_id BIGINT REFERENCES agents(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_response_at TIMESTAMPTZ,
  response_due_at TIMESTAMPTZ NOT NULL,
  resolution_due_at TIMESTAMPTZ NOT NULL,
  waiting_started_at TIMESTAMPTZ,
  auto_close_at TIMESTAMPTZ,
  resolved_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets (status);
CREATE INDEX IF NOT EXISTS idx_tickets_assignee ON tickets (assignee_id);
CREATE INDEX IF NOT EXISTS idx_tickets_res_due ON tickets (resolution_due_at);

CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id),
  author_agent_id BIGINT REFERENCES agents(id),
  author_customer TEXT,
  visibility TEXT NOT NULL CHECK (visibility IN ('public','internal')),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 5000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((author_agent_id IS NULL) <> (author_customer IS NULL)),
  CHECK (visibility = 'public' OR author_agent_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_messages_ticket ON messages (ticket_id, created_at);

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGSERIAL PRIMARY KEY,
  ticket_id BIGINT NOT NULL REFERENCES tickets(id),
  actor_agent_id BIGINT REFERENCES agents(id),
  actor_customer TEXT,
  action TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  happened_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS idx_audit_ticket ON audit_events (ticket_id, happened_at, id);

CREATE OR REPLACE FUNCTION prohibit_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Audit events are append-only';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_append_only ON audit_events;
CREATE TRIGGER audit_append_only BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION prohibit_audit_mutation();