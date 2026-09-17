CREATE TABLE app.settlement_import_batches (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  shop_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES private.users(id),
  filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 150),
  content_type text NOT NULL DEFAULT 'text/csv' CHECK(content_type='text/csv'),
  byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 1048576),
  source_hash text NOT NULL CHECK(source_hash ~ '^[0-9a-f]{64}$'),
  fingerprint text NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
  delimiter text NOT NULL CHECK(delimiter IN (',',';',E'\t')),
  adapter_key text NOT NULL DEFAULT 'generic-settlement-lines' CHECK(length(adapter_key) BETWEEN 1 AND 80),
  schema_version text NOT NULL DEFAULT 'generic-settlement-lines-v1' CHECK(length(schema_version) BETWEEN 1 AND 80),
  parser_version text NOT NULL CHECK(length(parser_version) BETWEEN 1 AND 80),
  mapping jsonb NOT NULL CHECK(jsonb_typeof(mapping)='object'),
  preview jsonb NOT NULL CHECK(jsonb_typeof(preview)='object'),
  content bytea NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,shop_id,id),
  UNIQUE(tenant_id,shop_id,fingerprint),
  FOREIGN KEY(tenant_id,shop_id) REFERENCES app.shops(tenant_id,id),
  CHECK(octet_length(content)=byte_size)
);

CREATE INDEX settlement_import_batches_shop_time_idx
  ON app.settlement_import_batches(tenant_id,shop_id,committed_at DESC);
CREATE INDEX settlement_import_batches_actor_idx ON app.settlement_import_batches(actor_id);

ALTER TABLE app.settlement_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.settlement_import_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY settlement_import_batches_read ON app.settlement_import_batches FOR SELECT USING(
  tenant_id=app.tenant_id()
  AND app.shop_allowed(tenant_id,shop_id)
  AND app.member_role(tenant_id) IN ('owner','finance','auditor')
);
CREATE POLICY settlement_import_batches_insert ON app.settlement_import_batches FOR INSERT WITH CHECK(
  tenant_id=app.tenant_id()
  AND actor_id=app.actor_id()
  AND app.shop_allowed(tenant_id,shop_id)
  AND app.member_role(tenant_id) IN ('owner','finance')
);
GRANT SELECT,INSERT ON app.settlement_import_batches TO commerce_app;

ALTER TABLE app.settlement_lines
  ADD COLUMN import_batch_id uuid,
  ADD COLUMN source_record integer;
ALTER TABLE app.settlement_lines ADD CONSTRAINT settlement_lines_import_pair_check CHECK(
  (import_batch_id IS NULL AND source_record IS NULL)
  OR (import_batch_id IS NOT NULL AND source_record>0)
);
ALTER TABLE app.settlement_lines ADD CONSTRAINT settlement_lines_import_batch_fk
  FOREIGN KEY(tenant_id,shop_id,import_batch_id)
  REFERENCES app.settlement_import_batches(tenant_id,shop_id,id);
CREATE UNIQUE INDEX settlement_lines_import_record_idx
  ON app.settlement_lines(tenant_id,import_batch_id,source_record)
  WHERE import_batch_id IS NOT NULL;

COMMENT ON TABLE app.settlement_import_batches IS 'Immutable settlement CSV evidence and canonical preview committed atomically with settlement lines.';
