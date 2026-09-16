CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX products_name_trgm_idx
  ON app.products USING gin(name gin_trgm_ops);
CREATE INDEX variants_sku_trgm_idx
  ON app.variants USING gin(sku gin_trgm_ops);

