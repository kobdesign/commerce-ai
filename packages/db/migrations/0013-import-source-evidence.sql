CREATE TABLE app.import_sources (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  shop_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES private.users(id),
  filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 150),
  content_type text NOT NULL DEFAULT 'text/csv' CHECK(content_type='text/csv'),
  byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 1048576),
  source_hash text NOT NULL CHECK(source_hash ~ '^[0-9a-f]{64}$'),
  delimiter text NOT NULL CHECK(delimiter IN (',',';',E'\t')),
  adapter_key text NOT NULL DEFAULT 'generic-order-lines' CHECK(length(adapter_key) BETWEEN 1 AND 80),
  schema_version text NOT NULL DEFAULT 'generic-order-lines-v1' CHECK(length(schema_version) BETWEEN 1 AND 80),
  storage_version text NOT NULL DEFAULT 'postgres-bytea-v1' CHECK(storage_version='postgres-bytea-v1'),
  content bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,shop_id,source_hash),
  FOREIGN KEY(tenant_id,shop_id) REFERENCES app.shops(tenant_id,id),
  CHECK(octet_length(content)=byte_size)
);
CREATE INDEX import_sources_shop_time_idx ON app.import_sources(tenant_id,shop_id,created_at DESC);

ALTER TABLE app.import_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.import_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY import_sources_read ON app.import_sources FOR SELECT USING(
  tenant_id=app.tenant_id() AND app.shop_allowed(tenant_id,shop_id)
  AND app.member_role(tenant_id) IN ('owner','finance','auditor')
);
CREATE POLICY import_sources_insert ON app.import_sources FOR INSERT WITH CHECK(
  tenant_id=app.tenant_id() AND actor_id=app.actor_id() AND app.shop_allowed(tenant_id,shop_id)
  AND app.member_role(tenant_id) IN ('owner','finance')
);
GRANT SELECT,INSERT ON app.import_sources TO commerce_app;
REVOKE UPDATE,DELETE ON app.import_sources FROM commerce_app;

ALTER TABLE app.import_drafts ADD COLUMN source_id uuid;
ALTER TABLE app.import_drafts ADD CONSTRAINT import_drafts_source_fk
  FOREIGN KEY(tenant_id,source_id) REFERENCES app.import_sources(tenant_id,id);
CREATE INDEX import_drafts_source_idx ON app.import_drafts(tenant_id,source_id) WHERE source_id IS NOT NULL;

COMMENT ON TABLE app.import_sources IS 'Immutable raw import evidence. Existing drafts created before migration may have no source_id.';
