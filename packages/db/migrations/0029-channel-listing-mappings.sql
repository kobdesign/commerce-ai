CREATE TABLE app.channel_listing_mappings (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  shop_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  external_product_id text NOT NULL CHECK(length(external_product_id) BETWEEN 1 AND 160),
  external_variant_id text NOT NULL DEFAULT '' CHECK(length(external_variant_id) <= 160),
  external_sku text CHECK(external_sku IS NULL OR length(external_sku) BETWEEN 1 AND 160),
  listing_name text CHECK(listing_name IS NULL OR length(listing_name) BETWEEN 1 AND 200),
  source text NOT NULL CHECK(source IN ('manual','file','api')),
  source_reference text CHECK(source_reference IS NULL OR length(source_reference) <= 300),
  verified_at timestamptz NOT NULL,
  verified_by uuid NOT NULL REFERENCES private.users(id),
  archived_at timestamptz,
  archived_by uuid REFERENCES private.users(id),
  archive_reason text CHECK(archive_reason IS NULL OR length(archive_reason) BETWEEN 3 AND 500),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL DEFAULT app.actor_id() REFERENCES private.users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,shop_id) REFERENCES app.shops(tenant_id,id),
  FOREIGN KEY(tenant_id,variant_id) REFERENCES app.variants(tenant_id,id),
  CONSTRAINT listing_mapping_archive_fields CHECK(
    (archived_at IS NULL AND archived_by IS NULL AND archive_reason IS NULL)
    OR (archived_at IS NOT NULL AND archived_by IS NOT NULL AND archive_reason IS NOT NULL)
  )
);

-- One active marketplace identity can resolve to only one canonical SKU. Archived
-- mistakes stay in the audit trail without blocking a corrected active mapping.
CREATE UNIQUE INDEX channel_listing_identity_active_unique
  ON app.channel_listing_mappings(tenant_id,shop_id,external_product_id,external_variant_id)
  WHERE archived_at IS NULL;
CREATE INDEX channel_listing_variant_idx
  ON app.channel_listing_mappings(tenant_id,variant_id,archived_at,created_at DESC);
CREATE INDEX channel_listing_shop_idx
  ON app.channel_listing_mappings(tenant_id,shop_id,archived_at,created_at DESC);

ALTER TABLE app.channel_listing_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.channel_listing_mappings FORCE ROW LEVEL SECURITY;

CREATE POLICY channel_listing_mappings_read ON app.channel_listing_mappings FOR SELECT USING(
  tenant_id=app.tenant_id()
  AND app.shop_allowed(tenant_id,shop_id)
  AND app.variant_allowed(tenant_id,variant_id)
);

CREATE POLICY channel_listing_mappings_insert ON app.channel_listing_mappings FOR INSERT WITH CHECK(
  tenant_id=app.tenant_id()
  AND created_by=app.actor_id()
  AND verified_by=app.actor_id()
  AND source='manual'
  AND archived_at IS NULL AND archived_by IS NULL AND archive_reason IS NULL
  AND app.shop_allowed(tenant_id,shop_id)
  AND EXISTS(
    SELECT 1 FROM app.variants v
    JOIN app.shop_products sp ON sp.tenant_id=v.tenant_id AND sp.product_id=v.product_id
    WHERE v.tenant_id=channel_listing_mappings.tenant_id
      AND v.id=channel_listing_mappings.variant_id
      AND sp.shop_id=channel_listing_mappings.shop_id
      AND app.product_edit_allowed(v.tenant_id,v.product_id)
  )
);

CREATE POLICY channel_listing_mappings_update ON app.channel_listing_mappings FOR UPDATE
USING(
  tenant_id=app.tenant_id()
  AND app.shop_allowed(tenant_id,shop_id)
  AND EXISTS(
    SELECT 1 FROM app.variants v
    JOIN app.shop_products sp ON sp.tenant_id=v.tenant_id AND sp.product_id=v.product_id
    WHERE v.tenant_id=channel_listing_mappings.tenant_id
      AND v.id=channel_listing_mappings.variant_id
      AND sp.shop_id=channel_listing_mappings.shop_id
      AND app.product_edit_allowed(v.tenant_id,v.product_id)
  )
)
WITH CHECK(
  tenant_id=app.tenant_id()
  AND app.shop_allowed(tenant_id,shop_id)
  AND EXISTS(
    SELECT 1 FROM app.variants v
    JOIN app.shop_products sp ON sp.tenant_id=v.tenant_id AND sp.product_id=v.product_id
    WHERE v.tenant_id=channel_listing_mappings.tenant_id
      AND v.id=channel_listing_mappings.variant_id
      AND sp.shop_id=channel_listing_mappings.shop_id
      AND app.product_edit_allowed(v.tenant_id,v.product_id)
  )
);

GRANT SELECT,INSERT ON app.channel_listing_mappings TO commerce_app;
GRANT UPDATE(archived_at,archived_by,archive_reason,version,updated_at)
  ON app.channel_listing_mappings TO commerce_app;
