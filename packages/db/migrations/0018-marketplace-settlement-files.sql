ALTER TABLE app.settlement_import_batches
  DROP CONSTRAINT settlement_import_batches_content_type_check,
  DROP CONSTRAINT settlement_import_batches_byte_size_check,
  DROP CONSTRAINT settlement_import_batches_delimiter_check;

ALTER TABLE app.settlement_import_batches
  ALTER COLUMN delimiter DROP NOT NULL,
  ADD CONSTRAINT settlement_import_batches_content_type_check CHECK(
    content_type IN ('text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  ),
  ADD CONSTRAINT settlement_import_batches_byte_size_check CHECK(byte_size BETWEEN 1 AND 5242880),
  ADD CONSTRAINT settlement_import_batches_delimiter_check CHECK(delimiter IS NULL OR delimiter IN (',',';',E'\t')),
  ADD CONSTRAINT settlement_import_batches_file_shape_check CHECK(
    (content_type='text/csv' AND delimiter IS NOT NULL)
    OR (content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' AND delimiter IS NULL)
  );

COMMENT ON COLUMN app.settlement_import_batches.adapter_key IS
  'Versioned parser identity. Marketplace readers are never inferred again after commit.';
COMMENT ON COLUMN app.settlement_import_batches.schema_version IS
  'Versioned source contract used to interpret the immutable raw statement.';
