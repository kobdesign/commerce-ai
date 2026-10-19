-- INT-AG-01b: immutable incoming event evidence, deduplication and ordering disposition.
CREATE TABLE app.integration_inbox_streams (
  tenant_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  provider_namespace text NOT NULL CHECK(provider_namespace~'^[a-z0-9][a-z0-9._-]{2,79}$'),
  stream_type text NOT NULL CHECK(stream_type~'^[a-z][a-z0-9._-]{2,59}$'),
  stream_id text NOT NULL CHECK(length(stream_id) BETWEEN 1 AND 160),
  last_sequence bigint NOT NULL CHECK(last_sequence>=0),
  last_event_id uuid NOT NULL,
  last_occurred_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,shop_id,provider_namespace,stream_type,stream_id),
  FOREIGN KEY(tenant_id,shop_id) REFERENCES app.shops(tenant_id,id)
);

CREATE TABLE app.integration_inbox_events (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  position bigint GENERATED ALWAYS AS IDENTITY,
  shop_id uuid NOT NULL,
  provider_namespace text NOT NULL CHECK(provider_namespace~'^[a-z0-9][a-z0-9._-]{2,79}$'),
  provider_event_id text NOT NULL CHECK(length(provider_event_id) BETWEEN 1 AND 160),
  event_type text NOT NULL CHECK(event_type~'^[a-z][a-z0-9._-]{2,119}$'),
  stream_type text NOT NULL CHECK(stream_type~'^[a-z][a-z0-9._-]{2,59}$'),
  stream_id text NOT NULL CHECK(length(stream_id) BETWEEN 1 AND 160),
  sequence_number bigint CHECK(sequence_number>=0),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  raw_body_hash text NOT NULL CHECK(raw_body_hash~'^[0-9a-f]{64}$'),
  metadata_hash text NOT NULL CHECK(metadata_hash~'^[0-9a-f]{64}$'),
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND pg_column_size(payload)<=65536),
  metadata jsonb NOT NULL CHECK(jsonb_typeof(metadata)='object' AND pg_column_size(metadata)<=16384),
  signature_status text NOT NULL CHECK(signature_status IN ('verified','invalid')),
  verification_method text NOT NULL CHECK(length(verification_method) BETWEEN 3 AND 80),
  verification_key_reference text CHECK(verification_key_reference IS NULL OR length(verification_key_reference) BETWEEN 1 AND 120),
  reconciliation_status text NOT NULL CHECK(reconciliation_status IN ('ready','needs_review','rejected')),
  disposition text NOT NULL CHECK(disposition IN ('accepted','recovered_gap','gap','stale','unordered','invalid_signature')),
  review_reason text CHECK(review_reason IS NULL OR length(review_reason) BETWEEN 3 AND 500),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id),
  UNIQUE(position),
  UNIQUE(tenant_id,shop_id,provider_namespace,provider_event_id),
  FOREIGN KEY(tenant_id,shop_id) REFERENCES app.shops(tenant_id,id),
  CONSTRAINT integration_inbox_state CHECK(
    (reconciliation_status='ready' AND signature_status='verified' AND disposition IN ('accepted','recovered_gap') AND review_reason IS NULL)
    OR (reconciliation_status='needs_review' AND signature_status='verified' AND disposition IN ('gap','stale','unordered') AND review_reason IS NOT NULL)
    OR (reconciliation_status='rejected' AND signature_status='invalid' AND disposition='invalid_signature' AND review_reason IS NOT NULL)
  )
);
CREATE INDEX integration_inbox_stream_time_idx ON app.integration_inbox_events(tenant_id,shop_id,provider_namespace,stream_type,stream_id,sequence_number,position);
CREATE INDEX integration_inbox_review_idx ON app.integration_inbox_events(tenant_id,shop_id,reconciliation_status,received_at,position)
  WHERE reconciliation_status IN ('needs_review','rejected');

ALTER TABLE app.integration_inbox_streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.integration_inbox_streams FORCE ROW LEVEL SECURITY;
ALTER TABLE app.integration_inbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.integration_inbox_events FORCE ROW LEVEL SECURITY;
CREATE POLICY integration_inbox_streams_read ON app.integration_inbox_streams FOR SELECT TO commerce_app USING(
  tenant_id=app.tenant_id() AND app.member_role(tenant_id) IN ('owner','operator','auditor') AND app.shop_allowed(tenant_id,shop_id)
);
CREATE POLICY integration_inbox_events_read ON app.integration_inbox_events FOR SELECT TO commerce_app USING(
  tenant_id=app.tenant_id() AND app.member_role(tenant_id) IN ('owner','operator','auditor') AND app.shop_allowed(tenant_id,shop_id)
);

CREATE FUNCTION app.capture_inbox_outbox_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE event_name text;
BEGIN
  IF NEW.reconciliation_status='ready' THEN event_name:='integration.inbox_ready.v1';
  ELSIF NEW.reconciliation_status='needs_review' THEN event_name:='integration.inbox_needs_review.v1';
  ELSE event_name:='integration.inbox_rejected.v1';
  END IF;
  PERFORM app.emit_integration_event(NEW.tenant_id,NEW.shop_id,event_name,'integration_inbox_event',NEW.id,NEW.version,
    jsonb_build_object('schemaVersion',1,'inboxEventId',NEW.id,'shopId',NEW.shop_id,'providerNamespace',NEW.provider_namespace,
      'providerEventId',NEW.provider_event_id,'eventType',NEW.event_type,'streamType',NEW.stream_type,'streamId',NEW.stream_id,
      'sequenceNumber',NEW.sequence_number,'reconciliationStatus',NEW.reconciliation_status,'disposition',NEW.disposition,'version',NEW.version));
  RETURN NEW;
END $$;
CREATE TRIGGER integration_inbox_outbox_insert AFTER INSERT ON app.integration_inbox_events
  FOR EACH ROW EXECUTE FUNCTION app.capture_inbox_outbox_event();
CREATE TRIGGER integration_inbox_outbox_update AFTER UPDATE OF reconciliation_status ON app.integration_inbox_events
  FOR EACH ROW WHEN(NEW.reconciliation_status IS DISTINCT FROM OLD.reconciliation_status) EXECUTE FUNCTION app.capture_inbox_outbox_event();

CREATE FUNCTION app.ingest_integration_inbox_event(
  selected_tenant uuid,selected_shop uuid,inbox_id uuid,selected_provider text,external_event_id text,selected_event_type text,
  selected_stream_type text,selected_stream_id text,selected_sequence bigint,event_occurred_at timestamptz,body_hash text,
  normalized_payload jsonb,safe_metadata jsonb,signature_result text,verification_method text,key_reference text DEFAULT NULL
) RETURNS TABLE(id uuid,duplicate boolean,reconciliation_status text,disposition text,version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  prior app.integration_inbox_events%ROWTYPE; cursor app.integration_inbox_streams%ROWTYPE; promoted app.integration_inbox_events%ROWTYPE;
  metadata_digest text:=encode(public.digest(safe_metadata::text,'sha256'),'hex'); next_status text; next_disposition text; reason text;
BEGIN
  IF inbox_id IS NULL OR event_occurred_at IS NULL OR selected_sequence<0
    OR normalized_payload IS NULL OR safe_metadata IS NULL
    OR NOT EXISTS(SELECT 1 FROM app.shops s WHERE s.tenant_id=selected_tenant AND s.id=selected_shop)
    OR selected_provider!~'^[a-z0-9][a-z0-9._-]{2,79}$' OR selected_event_type!~'^[a-z][a-z0-9._-]{2,119}$'
    OR selected_stream_type!~'^[a-z][a-z0-9._-]{2,59}$' OR length(btrim(external_event_id)) NOT BETWEEN 1 AND 160
    OR length(btrim(selected_stream_id)) NOT BETWEEN 1 AND 160 OR body_hash!~'^[0-9a-f]{64}$'
    OR jsonb_typeof(normalized_payload)<>'object' OR pg_column_size(normalized_payload)>65536
    OR jsonb_typeof(safe_metadata)<>'object' OR pg_column_size(safe_metadata)>16384
    OR signature_result NOT IN ('verified','invalid') OR length(verification_method) NOT BETWEEN 3 AND 80
    OR (key_reference IS NOT NULL AND length(key_reference) NOT BETWEEN 1 AND 120) THEN RAISE EXCEPTION 'INVALID_INBOX_EVENT';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(selected_tenant::text||':'||selected_shop::text||':'||selected_provider||':'||btrim(external_event_id),0));
  SELECT e.* INTO prior FROM app.integration_inbox_events e WHERE e.tenant_id=selected_tenant AND e.shop_id=selected_shop
    AND e.provider_namespace=selected_provider AND e.provider_event_id=btrim(external_event_id);
  IF FOUND THEN
    IF prior.event_type=selected_event_type AND prior.stream_type=selected_stream_type AND prior.stream_id=btrim(selected_stream_id)
      AND prior.sequence_number IS NOT DISTINCT FROM selected_sequence AND prior.occurred_at=event_occurred_at
      AND prior.raw_body_hash=body_hash AND prior.metadata_hash=metadata_digest AND prior.payload=normalized_payload
      AND prior.signature_status=signature_result AND prior.verification_method=verification_method
      AND prior.verification_key_reference IS NOT DISTINCT FROM key_reference THEN
      RETURN QUERY SELECT prior.id,true,prior.reconciliation_status,prior.disposition,prior.version;RETURN;
    END IF;
    RAISE EXCEPTION 'INBOX_EVENT_CONFLICT';
  END IF;
  IF signature_result='invalid' THEN next_status:='rejected';next_disposition:='invalid_signature';reason:='Signature verification failed';
  ELSIF selected_sequence IS NULL THEN next_status:='needs_review';next_disposition:='unordered';reason:='Provider sequence is unavailable';
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended(selected_tenant::text||':'||selected_shop::text||':'||selected_provider||':'||selected_stream_type||':'||btrim(selected_stream_id),0));
    SELECT s.* INTO cursor FROM app.integration_inbox_streams s WHERE s.tenant_id=selected_tenant AND s.shop_id=selected_shop
      AND s.provider_namespace=selected_provider AND s.stream_type=selected_stream_type AND s.stream_id=btrim(selected_stream_id) FOR UPDATE;
    IF NOT FOUND OR selected_sequence=cursor.last_sequence+1 THEN next_status:='ready';next_disposition:='accepted';reason:=NULL;
    ELSIF selected_sequence<=cursor.last_sequence THEN next_status:='needs_review';next_disposition:='stale';reason:='Sequence is not newer than the accepted cursor';
    ELSE next_status:='needs_review';next_disposition:='gap';reason:='One or more earlier sequence values are missing';
    END IF;
  END IF;
  INSERT INTO app.integration_inbox_events(tenant_id,id,shop_id,provider_namespace,provider_event_id,event_type,stream_type,stream_id,sequence_number,
    occurred_at,raw_body_hash,metadata_hash,payload,metadata,signature_status,verification_method,verification_key_reference,reconciliation_status,disposition,review_reason)
  VALUES(selected_tenant,inbox_id,selected_shop,selected_provider,btrim(external_event_id),selected_event_type,selected_stream_type,btrim(selected_stream_id),selected_sequence,
    event_occurred_at,body_hash,metadata_digest,normalized_payload,safe_metadata,signature_result,verification_method,key_reference,next_status,next_disposition,reason);
  IF next_status='ready' AND selected_sequence IS NOT NULL THEN
    INSERT INTO app.integration_inbox_streams(tenant_id,shop_id,provider_namespace,stream_type,stream_id,last_sequence,last_event_id,last_occurred_at)
    VALUES(selected_tenant,selected_shop,selected_provider,selected_stream_type,btrim(selected_stream_id),selected_sequence,inbox_id,event_occurred_at)
    ON CONFLICT(tenant_id,shop_id,provider_namespace,stream_type,stream_id) DO UPDATE SET last_sequence=excluded.last_sequence,
      last_event_id=excluded.last_event_id,last_occurred_at=excluded.last_occurred_at,version=app.integration_inbox_streams.version+1,updated_at=clock_timestamp();
    LOOP
      SELECT e.* INTO promoted FROM app.integration_inbox_events e WHERE e.tenant_id=selected_tenant AND e.shop_id=selected_shop
        AND e.provider_namespace=selected_provider AND e.stream_type=selected_stream_type AND e.stream_id=btrim(selected_stream_id)
        AND e.reconciliation_status='needs_review' AND e.disposition='gap' AND e.sequence_number=(
          SELECT s.last_sequence+1 FROM app.integration_inbox_streams s WHERE s.tenant_id=selected_tenant AND s.shop_id=selected_shop
            AND s.provider_namespace=selected_provider AND s.stream_type=selected_stream_type AND s.stream_id=btrim(selected_stream_id))
        ORDER BY e.received_at,e.id LIMIT 1 FOR UPDATE;
      EXIT WHEN NOT FOUND;
      UPDATE app.integration_inbox_events e SET reconciliation_status='ready',disposition='recovered_gap',review_reason=NULL,version=e.version+1,updated_at=clock_timestamp()
        WHERE e.tenant_id=selected_tenant AND e.id=promoted.id;
      UPDATE app.integration_inbox_streams s SET last_sequence=promoted.sequence_number,last_event_id=promoted.id,last_occurred_at=promoted.occurred_at,
        version=s.version+1,updated_at=clock_timestamp() WHERE s.tenant_id=selected_tenant AND s.shop_id=selected_shop
        AND s.provider_namespace=selected_provider AND s.stream_type=selected_stream_type AND s.stream_id=btrim(selected_stream_id);
    END LOOP;
  END IF;
  RETURN QUERY SELECT inbox_id,false,next_status,next_disposition,1;
END $$;

REVOKE ALL ON app.integration_inbox_streams,app.integration_inbox_events FROM PUBLIC;
REVOKE ALL ON FUNCTION app.ingest_integration_inbox_event(uuid,uuid,uuid,text,text,text,text,text,bigint,timestamptz,text,jsonb,jsonb,text,text,text) FROM PUBLIC;
GRANT SELECT ON app.integration_inbox_streams,app.integration_inbox_events TO commerce_app;
GRANT EXECUTE ON FUNCTION app.ingest_integration_inbox_event(uuid,uuid,uuid,text,text,text,text,text,bigint,timestamptz,text,jsonb,jsonb,text,text,text) TO commerce_queue;
