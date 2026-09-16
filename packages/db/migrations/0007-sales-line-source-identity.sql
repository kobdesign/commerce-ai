ALTER TABLE app.sales_lines
  ADD COLUMN source_line_id text,
  ADD CONSTRAINT sales_lines_source_line_id_format CHECK(
    source_line_id IS NULL
    OR (source_line_id=btrim(source_line_id) AND length(source_line_id) BETWEEN 1 AND 150)
  );

CREATE UNIQUE INDEX sales_lines_source_identity_idx
  ON app.sales_lines(tenant_id,shop_id,source_line_id)
  WHERE source_line_id IS NOT NULL;

COMMENT ON COLUMN app.sales_lines.source_line_id IS
  'Stable marketplace line identifier when supplied by the source report; scoped to one tenant and shop.';
