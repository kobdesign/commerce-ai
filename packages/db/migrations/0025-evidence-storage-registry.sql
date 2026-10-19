CREATE TABLE app.evidence_objects (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  shop_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES private.users(id),
  content_type text NOT NULL CHECK(content_type IN ('text/csv','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
  byte_size integer NOT NULL CHECK(byte_size BETWEEN 1 AND 5242880),
  source_hash text NOT NULL CHECK(source_hash ~ '^[0-9a-f]{64}$'),
  storage_backend text NOT NULL CHECK(storage_backend='postgres-inline-v1'),
  object_key text NOT NULL CHECK(length(object_key) BETWEEN 1 AND 500),
  retention_class text NOT NULL CHECK(retention_class='financial-evidence'),
  retain_until timestamptz,
  lifecycle_status text NOT NULL CHECK(lifecycle_status='active'),
  content bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,shop_id,id),
  UNIQUE(tenant_id,shop_id,source_hash),
  UNIQUE(tenant_id,object_key),
  FOREIGN KEY(tenant_id,shop_id) REFERENCES app.shops(tenant_id,id),
  CHECK(octet_length(content)=byte_size)
);
CREATE INDEX evidence_objects_shop_time_idx ON app.evidence_objects(tenant_id,shop_id,created_at DESC);

ALTER TABLE app.evidence_objects ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.evidence_objects FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_objects_read ON app.evidence_objects FOR SELECT USING(
  tenant_id=app.tenant_id() AND app.shop_allowed(tenant_id,shop_id)
  AND app.member_role(tenant_id) IN ('owner','finance','auditor')
);
CREATE POLICY evidence_objects_insert ON app.evidence_objects FOR INSERT WITH CHECK(
  tenant_id=app.tenant_id() AND actor_id=app.actor_id() AND app.shop_allowed(tenant_id,shop_id)
  AND app.member_role(tenant_id) IN ('owner','finance')
);
GRANT SELECT,INSERT ON app.evidence_objects TO commerce_app;
REVOKE UPDATE,DELETE ON app.evidence_objects FROM commerce_app;

INSERT INTO app.evidence_objects(tenant_id,id,shop_id,actor_id,content_type,byte_size,source_hash,storage_backend,object_key,retention_class,lifecycle_status,content,created_at)
SELECT DISTINCT ON (source.tenant_id,source.shop_id,source.source_hash)
  source.tenant_id,gen_random_uuid(),source.shop_id,source.actor_id,source.content_type,source.byte_size,source.source_hash,
  'postgres-inline-v1','evidence/'||source.tenant_id||'/'||source.shop_id||'/'||source.source_hash,'financial-evidence','active',source.content,source.created_at
FROM (
  SELECT tenant_id,shop_id,actor_id,content_type,byte_size,source_hash,content,created_at FROM app.import_sources
  UNION ALL
  SELECT tenant_id,shop_id,actor_id,content_type,byte_size,source_hash,content,committed_at FROM app.settlement_import_batches
) source
ORDER BY source.tenant_id,source.shop_id,source.source_hash,source.created_at;

ALTER TABLE app.import_sources ADD COLUMN evidence_object_id uuid;
UPDATE app.import_sources source SET evidence_object_id=evidence.id
FROM app.evidence_objects evidence
WHERE evidence.tenant_id=source.tenant_id AND evidence.shop_id=source.shop_id AND evidence.source_hash=source.source_hash;
ALTER TABLE app.import_sources ADD CONSTRAINT import_sources_evidence_object_fk
  FOREIGN KEY(tenant_id,shop_id,evidence_object_id) REFERENCES app.evidence_objects(tenant_id,shop_id,id);
CREATE INDEX import_sources_evidence_object_idx ON app.import_sources(tenant_id,evidence_object_id) WHERE evidence_object_id IS NOT NULL;

ALTER TABLE app.settlement_import_batches ADD COLUMN evidence_object_id uuid;
UPDATE app.settlement_import_batches batch SET evidence_object_id=evidence.id
FROM app.evidence_objects evidence
WHERE evidence.tenant_id=batch.tenant_id AND evidence.shop_id=batch.shop_id AND evidence.source_hash=batch.source_hash;
ALTER TABLE app.settlement_import_batches ADD CONSTRAINT settlement_import_batches_evidence_object_fk
  FOREIGN KEY(tenant_id,shop_id,evidence_object_id) REFERENCES app.evidence_objects(tenant_id,shop_id,id);
CREATE INDEX settlement_import_batches_evidence_object_idx ON app.settlement_import_batches(tenant_id,evidence_object_id) WHERE evidence_object_id IS NOT NULL;

COMMENT ON TABLE app.evidence_objects IS 'Immutable evidence storage registry. postgres-inline-v1 is an expand-stage backend before private object storage migration.';
COMMENT ON COLUMN app.evidence_objects.retain_until IS 'Null until an approved retention policy sets a disposal date; null does not authorize deletion.';
COMMENT ON COLUMN app.import_sources.evidence_object_id IS 'New storage registry reference. Nullable during expand/rollback compatibility.';
COMMENT ON COLUMN app.settlement_import_batches.evidence_object_id IS 'New storage registry reference. Nullable during expand/rollback compatibility.';
