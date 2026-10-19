ALTER TABLE app.products
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archived_by uuid REFERENCES private.users(id),
  ADD COLUMN archive_reason text CHECK(archive_reason IS NULL OR length(archive_reason) BETWEEN 3 AND 500),
  ADD CONSTRAINT products_archive_fields CHECK(
    (archived_at IS NULL AND archived_by IS NULL AND archive_reason IS NULL)
    OR (archived_at IS NOT NULL AND archived_by IS NOT NULL AND archive_reason IS NOT NULL)
  );

ALTER TABLE app.variants
  ADD COLUMN archived_at timestamptz,
  ADD COLUMN archived_by uuid REFERENCES private.users(id),
  ADD COLUMN archive_reason text CHECK(archive_reason IS NULL OR length(archive_reason) BETWEEN 3 AND 500),
  ADD CONSTRAINT variants_archive_fields CHECK(
    (archived_at IS NULL AND archived_by IS NULL AND archive_reason IS NULL)
    OR (archived_at IS NOT NULL AND archived_by IS NOT NULL AND archive_reason IS NOT NULL)
  );

CREATE INDEX products_lifecycle_idx ON app.products(tenant_id,archived_at,created_at DESC);
CREATE INDEX variants_lifecycle_idx ON app.variants(tenant_id,product_id,archived_at);

GRANT UPDATE(archived_at,archived_by,archive_reason) ON app.products TO commerce_app;
GRANT UPDATE(archived_at,archived_by,archive_reason) ON app.variants TO commerce_app;
