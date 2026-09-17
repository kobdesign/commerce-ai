CREATE TABLE app.import_commit_jobs (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  shop_id uuid NOT NULL,
  draft_id uuid NOT NULL,
  requested_by uuid NOT NULL REFERENCES private.users(id),
  status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 3),
  worker_name text CHECK(worker_name IS NULL OR length(worker_name) BETWEEN 1 AND 120),
  result jsonb,
  error_code text CHECK(error_code IS NULL OR length(error_code) BETWEEN 1 AND 80),
  error_message text CHECK(error_message IS NULL OR length(error_message) BETWEEN 1 AND 500),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  started_at timestamptz,
  completed_at timestamptz,
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,draft_id),
  FOREIGN KEY(tenant_id,shop_id) REFERENCES app.shops(tenant_id,id),
  FOREIGN KEY(tenant_id,draft_id) REFERENCES app.import_drafts(tenant_id,id),
  CHECK(status<>'succeeded' OR result IS NOT NULL),
  CHECK(status NOT IN ('succeeded','failed') OR completed_at IS NOT NULL)
);
CREATE INDEX import_commit_jobs_claim_idx ON app.import_commit_jobs(status,next_attempt_at,requested_at)
  WHERE status IN ('queued','running');
CREATE INDEX import_commit_jobs_shop_time_idx ON app.import_commit_jobs(tenant_id,shop_id,requested_at DESC);

ALTER TABLE app.import_commit_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.import_commit_jobs FORCE ROW LEVEL SECURITY;

CREATE POLICY import_commit_jobs_read ON app.import_commit_jobs FOR SELECT TO commerce_app USING(
  tenant_id=app.tenant_id() AND app.shop_allowed(tenant_id,shop_id)
  AND app.member_role(tenant_id) IN ('owner','finance','auditor')
);
CREATE POLICY import_commit_jobs_insert ON app.import_commit_jobs FOR INSERT TO commerce_app WITH CHECK(
  tenant_id=app.tenant_id() AND requested_by=app.actor_id() AND app.shop_allowed(tenant_id,shop_id)
  AND app.member_role(tenant_id) IN ('owner','finance')
);
CREATE POLICY import_commit_jobs_retry ON app.import_commit_jobs FOR UPDATE TO commerce_app USING(
  tenant_id=app.tenant_id() AND status='failed' AND app.shop_allowed(tenant_id,shop_id)
  AND app.member_role(tenant_id) IN ('owner','finance')
) WITH CHECK(
  tenant_id=app.tenant_id() AND status='queued' AND attempt_count=0 AND worker_name IS NULL
  AND result IS NULL AND error_code IS NULL AND error_message IS NULL AND started_at IS NULL AND completed_at IS NULL
  AND app.shop_allowed(tenant_id,shop_id) AND app.member_role(tenant_id) IN ('owner','finance')
);
CREATE POLICY import_commit_jobs_queue_read ON app.import_commit_jobs FOR SELECT TO commerce_queue USING(true);
CREATE POLICY import_commit_jobs_queue_update ON app.import_commit_jobs FOR UPDATE TO commerce_queue USING(true) WITH CHECK(true);

GRANT SELECT,INSERT ON app.import_commit_jobs TO commerce_app;
GRANT UPDATE(status,attempt_count,worker_name,result,error_code,error_message,next_attempt_at,started_at,completed_at)
  ON app.import_commit_jobs TO commerce_app;
GRANT USAGE ON SCHEMA app TO commerce_queue;
GRANT SELECT ON app.import_commit_jobs TO commerce_queue;
GRANT UPDATE(status,attempt_count,worker_name,result,error_code,error_message,next_attempt_at,started_at,completed_at)
  ON app.import_commit_jobs TO commerce_queue;

COMMENT ON TABLE app.import_commit_jobs IS 'Durable tenant-scoped requests consumed by the isolated background worker.';
