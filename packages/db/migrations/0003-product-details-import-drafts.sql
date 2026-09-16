ALTER TABLE app.products ADD COLUMN attributes jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(attributes)='object');

CREATE TABLE app.import_drafts (
  tenant_id uuid NOT NULL, id uuid NOT NULL, shop_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES private.users(id),
  filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 150),
  source_hash text NOT NULL, fingerprint text NOT NULL,
  mapping jsonb NOT NULL, preview jsonb NOT NULL,
  parser_version text NOT NULL DEFAULT 'orders-preview-v1',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,shop_id,fingerprint),
  FOREIGN KEY(tenant_id,shop_id) REFERENCES app.shops(tenant_id,id)
);
CREATE INDEX import_drafts_shop_time ON app.import_drafts(tenant_id,shop_id,created_at DESC);
ALTER TABLE app.import_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.import_drafts FORCE ROW LEVEL SECURITY;
CREATE POLICY draft_read ON app.import_drafts FOR SELECT USING(
 tenant_id=app.tenant_id() AND app.shop_allowed(tenant_id,shop_id) AND app.member_role(tenant_id) IN ('owner','finance','auditor')
);
CREATE POLICY draft_insert ON app.import_drafts FOR INSERT WITH CHECK(
 tenant_id=app.tenant_id() AND actor_id=app.actor_id() AND app.shop_allowed(tenant_id,shop_id) AND app.member_role(tenant_id) IN ('owner','finance')
);
GRANT SELECT,INSERT ON app.import_drafts TO commerce_app;
