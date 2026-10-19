-- INT-AG-01a: transactional order/inventory outbox with per-consumer leased delivery.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE app.integration_outbox_consumers (
  consumer_name text PRIMARY KEY CHECK(length(consumer_name) BETWEEN 3 AND 100),
  event_types text[] NOT NULL DEFAULT ARRAY['*']::text[] CHECK(cardinality(event_types) BETWEEN 1 AND 100),
  enabled boolean NOT NULL DEFAULT true,
  max_attempts integer NOT NULL DEFAULT 5 CHECK(max_attempts BETWEEN 1 AND 20),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE app.integration_outbox_events (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  position bigint GENERATED ALWAYS AS IDENTITY,
  shop_id uuid NOT NULL,
  event_type text NOT NULL CHECK(length(event_type) BETWEEN 3 AND 120),
  aggregate_type text NOT NULL CHECK(length(aggregate_type) BETWEEN 3 AND 60),
  aggregate_id uuid NOT NULL,
  aggregate_version integer NOT NULL CHECK(aggregate_version>0),
  payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND pg_column_size(payload)<=16384),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id),
  UNIQUE(position),
  UNIQUE(tenant_id,event_type,aggregate_type,aggregate_id,aggregate_version),
  FOREIGN KEY(tenant_id,shop_id) REFERENCES app.shops(tenant_id,id)
);
CREATE INDEX integration_outbox_events_aggregate_idx ON app.integration_outbox_events(tenant_id,aggregate_type,aggregate_id,position);
CREATE INDEX integration_outbox_events_shop_time_idx ON app.integration_outbox_events(tenant_id,shop_id,occurred_at DESC,position DESC);

CREATE TABLE app.integration_outbox_deliveries (
  tenant_id uuid NOT NULL,
  event_id uuid NOT NULL,
  consumer_name text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','succeeded','dead_letter')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_owner text CHECK(lease_owner IS NULL OR length(lease_owner) BETWEEN 1 AND 120),
  leased_until timestamptz,
  last_error_code text CHECK(last_error_code IS NULL OR length(last_error_code) BETWEEN 1 AND 80),
  first_attempted_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,event_id,consumer_name),
  FOREIGN KEY(tenant_id,event_id) REFERENCES app.integration_outbox_events(tenant_id,id),
  FOREIGN KEY(consumer_name) REFERENCES app.integration_outbox_consumers(consumer_name),
  CONSTRAINT integration_delivery_state CHECK(
    (status='pending' AND lease_owner IS NULL AND leased_until IS NULL AND completed_at IS NULL)
    OR (status='processing' AND lease_owner IS NOT NULL AND leased_until IS NOT NULL AND completed_at IS NULL)
    OR (status IN ('succeeded','dead_letter') AND lease_owner IS NULL AND leased_until IS NULL AND completed_at IS NOT NULL)
  )
);
CREATE INDEX integration_outbox_delivery_claim_idx ON app.integration_outbox_deliveries(consumer_name,status,next_attempt_at,created_at)
  WHERE status IN ('pending','processing');

CREATE TABLE app.integration_consumer_receipts (
  tenant_id uuid NOT NULL,
  event_id uuid NOT NULL,
  consumer_name text NOT NULL,
  event_type text NOT NULL,
  payload_hash text NOT NULL CHECK(payload_hash~'^[0-9a-f]{64}$'),
  processed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,event_id,consumer_name),
  FOREIGN KEY(tenant_id,event_id,consumer_name) REFERENCES app.integration_outbox_deliveries(tenant_id,event_id,consumer_name)
);

ALTER TABLE app.integration_outbox_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.integration_outbox_events FORCE ROW LEVEL SECURITY;
ALTER TABLE app.integration_outbox_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.integration_outbox_deliveries FORCE ROW LEVEL SECURITY;
ALTER TABLE app.integration_consumer_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.integration_consumer_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY integration_outbox_events_read ON app.integration_outbox_events FOR SELECT TO commerce_app USING(
  tenant_id=app.tenant_id() AND app.member_role(tenant_id) IN ('owner','auditor') AND app.shop_allowed(tenant_id,shop_id)
);
CREATE POLICY integration_outbox_deliveries_read ON app.integration_outbox_deliveries FOR SELECT TO commerce_app USING(
  tenant_id=app.tenant_id() AND app.member_role(tenant_id) IN ('owner','auditor') AND EXISTS(
    SELECT 1 FROM app.integration_outbox_events e WHERE e.tenant_id=integration_outbox_deliveries.tenant_id
      AND e.id=integration_outbox_deliveries.event_id AND app.shop_allowed(e.tenant_id,e.shop_id)
  )
);
CREATE POLICY integration_consumer_receipts_read ON app.integration_consumer_receipts FOR SELECT TO commerce_app USING(
  tenant_id=app.tenant_id() AND app.member_role(tenant_id) IN ('owner','auditor')
);

INSERT INTO app.integration_outbox_consumers(consumer_name,event_types)
VALUES('internal.operations.v1',ARRAY['*']);

CREATE FUNCTION app.materialize_outbox_deliveries() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO app.integration_outbox_deliveries(tenant_id,event_id,consumer_name)
  SELECT NEW.tenant_id,NEW.id,c.consumer_name FROM app.integration_outbox_consumers c
  WHERE c.enabled AND ('*'=ANY(c.event_types) OR NEW.event_type=ANY(c.event_types));
  RETURN NEW;
END $$;
CREATE TRIGGER integration_outbox_materialize AFTER INSERT ON app.integration_outbox_events
  FOR EACH ROW EXECUTE FUNCTION app.materialize_outbox_deliveries();

CREATE FUNCTION app.emit_integration_event(
  event_tenant uuid,event_shop uuid,event_name text,event_aggregate_type text,event_aggregate_id uuid,event_version integer,event_payload jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE event_id uuid:=gen_random_uuid();
BEGIN
  INSERT INTO app.integration_outbox_events(tenant_id,id,shop_id,event_type,aggregate_type,aggregate_id,aggregate_version,payload)
  VALUES(event_tenant,event_id,event_shop,event_name,event_aggregate_type,event_aggregate_id,event_version,event_payload)
  ON CONFLICT(tenant_id,event_type,aggregate_type,aggregate_id,aggregate_version) DO NOTHING
  RETURNING id INTO event_id;
  RETURN event_id;
END $$;

CREATE FUNCTION app.capture_commerce_order_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE event_name text;
BEGIN
  IF TG_OP='INSERT' THEN event_name:='commerce.order_created.v1';
  ELSIF NEW.order_state='completed' AND OLD.order_state='open' THEN event_name:='commerce.order_shipped.v1';
  ELSIF NEW.order_state='cancelled' AND OLD.order_state='open' THEN event_name:='commerce.order_cancelled.v1';
  ELSIF NEW.payment_state='paid' AND OLD.payment_state='pending' THEN event_name:='commerce.order_payment_confirmed.v1';
  ELSE RETURN NEW;
  END IF;
  PERFORM app.emit_integration_event(NEW.tenant_id,NEW.shop_id,event_name,'commerce_order',NEW.id,NEW.version,
    jsonb_build_object('schemaVersion',1,'orderId',NEW.id,'shopId',NEW.shop_id,'externalOrderId',NEW.external_order_id,
      'orderState',NEW.order_state,'paymentState',NEW.payment_state,'fulfillmentState',NEW.fulfillment_state,'version',NEW.version));
  RETURN NEW;
END $$;
CREATE TRIGGER commerce_order_outbox_insert AFTER INSERT ON app.commerce_orders
  FOR EACH ROW EXECUTE FUNCTION app.capture_commerce_order_event();
CREATE TRIGGER commerce_order_outbox_update AFTER UPDATE OF order_state,payment_state,fulfillment_state ON app.commerce_orders
  FOR EACH ROW WHEN(NEW.version<>OLD.version) EXECUTE FUNCTION app.capture_commerce_order_event();

CREATE FUNCTION app.capture_inventory_reservation_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE event_name text;
BEGIN
  IF TG_OP='INSERT' THEN event_name:='inventory.reservation_'||NEW.status||'.v1';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN event_name:='inventory.reservation_'||NEW.status||'.v1';
  ELSE RETURN NEW;
  END IF;
  PERFORM app.emit_integration_event(NEW.tenant_id,NEW.shop_id,event_name,'inventory_reservation',NEW.id,NEW.version,
    jsonb_build_object('schemaVersion',1,'reservationId',NEW.id,'shopId',NEW.shop_id,'variantId',NEW.variant_id,
      'source',NEW.source,'sourceReference',NEW.source_reference,'status',NEW.status,'requestedQuantity',NEW.requested_quantity,
      'reservedQuantity',NEW.reserved_quantity,'version',NEW.version));
  RETURN NEW;
END $$;
CREATE TRIGGER inventory_reservation_outbox_insert AFTER INSERT ON app.inventory_reservations
  FOR EACH ROW EXECUTE FUNCTION app.capture_inventory_reservation_event();
CREATE TRIGGER inventory_reservation_outbox_update AFTER UPDATE OF status ON app.inventory_reservations
  FOR EACH ROW WHEN(NEW.version<>OLD.version) EXECUTE FUNCTION app.capture_inventory_reservation_event();

CREATE FUNCTION app.capture_inventory_movement_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE selected_shop uuid;
BEGIN
  SELECT sp.shop_id INTO selected_shop FROM app.variants v JOIN app.shop_products sp ON sp.tenant_id=v.tenant_id AND sp.product_id=v.product_id
  WHERE v.tenant_id=NEW.tenant_id AND v.id=NEW.variant_id ORDER BY sp.shop_id LIMIT 1;
  IF selected_shop IS NULL THEN RETURN NEW; END IF;
  PERFORM app.emit_integration_event(NEW.tenant_id,selected_shop,'inventory.movement_recorded.v1','inventory_movement',NEW.id,1,
    jsonb_build_object('schemaVersion',1,'movementId',NEW.id,'shopId',selected_shop,'locationId',NEW.location_id,'variantId',NEW.variant_id,
      'movementType',NEW.movement_type,'quantityDelta',NEW.quantity_delta,'balanceAfter',NEW.balance_after,'source',NEW.source,'sourceReference',NEW.source_reference));
  RETURN NEW;
END $$;
CREATE TRIGGER inventory_movement_outbox_insert AFTER INSERT ON app.inventory_movements
  FOR EACH ROW EXECUTE FUNCTION app.capture_inventory_movement_event();

CREATE FUNCTION app.active_outbox_consumers() RETURNS TABLE(consumer_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT c.consumer_name FROM app.integration_outbox_consumers c WHERE c.enabled ORDER BY c.consumer_name
$$;

CREATE FUNCTION app.claim_outbox_deliveries(selected_consumer text,worker text,batch_size integer DEFAULT 20,lease_seconds integer DEFAULT 60)
RETURNS TABLE(tenant_id uuid,event_id uuid,event_type text,aggregate_type text,aggregate_id uuid,aggregate_version integer,payload jsonb,occurred_at timestamptz,attempt_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF length(worker) NOT BETWEEN 1 AND 120 OR batch_size NOT BETWEEN 1 AND 100 OR lease_seconds NOT BETWEEN 5 AND 300
     OR NOT EXISTS(SELECT 1 FROM app.integration_outbox_consumers c WHERE c.consumer_name=selected_consumer AND c.enabled) THEN
    RAISE EXCEPTION 'INVALID_OUTBOX_CLAIM';
  END IF;
  UPDATE app.integration_outbox_deliveries d SET
    status=CASE WHEN d.attempt_count>=c.max_attempts THEN 'dead_letter' ELSE 'pending' END,
    next_attempt_at=CASE WHEN d.attempt_count>=c.max_attempts THEN d.next_attempt_at ELSE clock_timestamp() END,
    lease_owner=NULL,leased_until=NULL,completed_at=CASE WHEN d.attempt_count>=c.max_attempts THEN clock_timestamp() ELSE NULL END,
    last_error_code=CASE WHEN d.attempt_count>=c.max_attempts THEN 'LEASE_EXHAUSTED' ELSE 'LEASE_EXPIRED' END,updated_at=clock_timestamp()
  FROM app.integration_outbox_consumers c
  WHERE d.consumer_name=selected_consumer AND c.consumer_name=d.consumer_name AND d.status='processing' AND d.leased_until<=clock_timestamp();
  RETURN QUERY WITH candidates AS(
    SELECT d.tenant_id,d.event_id,d.consumer_name FROM app.integration_outbox_deliveries d
    WHERE d.consumer_name=selected_consumer AND d.status='pending' AND d.next_attempt_at<=clock_timestamp()
    ORDER BY d.next_attempt_at,d.created_at,d.event_id FOR UPDATE SKIP LOCKED LIMIT batch_size
  ),claimed AS(
    UPDATE app.integration_outbox_deliveries d SET status='processing',attempt_count=d.attempt_count+1,lease_owner=worker,
      leased_until=clock_timestamp()+make_interval(secs=>lease_seconds),first_attempted_at=COALESCE(d.first_attempted_at,clock_timestamp()),
      last_error_code=NULL,updated_at=clock_timestamp()
    FROM candidates c WHERE d.tenant_id=c.tenant_id AND d.event_id=c.event_id AND d.consumer_name=c.consumer_name RETURNING d.*
  ) SELECT e.tenant_id,e.id,e.event_type,e.aggregate_type,e.aggregate_id,e.aggregate_version,e.payload,e.occurred_at,c.attempt_count
    FROM claimed c JOIN app.integration_outbox_events e ON e.tenant_id=c.tenant_id AND e.id=c.event_id ORDER BY e.position;
END $$;

CREATE FUNCTION app.record_outbox_receipt(selected_tenant uuid,selected_event uuid,selected_consumer text,worker text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE inserted integer;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM app.integration_outbox_deliveries d WHERE d.tenant_id=selected_tenant AND d.event_id=selected_event
    AND d.consumer_name=selected_consumer AND d.status='processing' AND d.lease_owner=worker AND d.leased_until>clock_timestamp()) THEN
    RAISE EXCEPTION 'OUTBOX_LEASE_LOST';
  END IF;
  INSERT INTO app.integration_consumer_receipts(tenant_id,event_id,consumer_name,event_type,payload_hash)
  SELECT e.tenant_id,e.id,selected_consumer,e.event_type,encode(digest(e.payload::text,'sha256'),'hex')
  FROM app.integration_outbox_events e WHERE e.tenant_id=selected_tenant AND e.id=selected_event
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted=ROW_COUNT;
  RETURN inserted=0;
END $$;

CREATE FUNCTION app.complete_outbox_delivery(selected_tenant uuid,selected_event uuid,selected_consumer text,worker text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE changed integer;
BEGIN
  UPDATE app.integration_outbox_deliveries d SET status='succeeded',lease_owner=NULL,leased_until=NULL,completed_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE d.tenant_id=selected_tenant AND d.event_id=selected_event AND d.consumer_name=selected_consumer
    AND d.status='processing' AND d.lease_owner=worker AND d.leased_until>clock_timestamp();
  GET DIAGNOSTICS changed=ROW_COUNT;RETURN changed=1;
END $$;

CREATE FUNCTION app.fail_outbox_delivery(selected_tenant uuid,selected_event uuid,selected_consumer text,worker text,error_code text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE next_status text;
BEGIN
  IF length(error_code) NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'INVALID_OUTBOX_ERROR'; END IF;
  UPDATE app.integration_outbox_deliveries d SET
    status=CASE WHEN d.attempt_count>=c.max_attempts THEN 'dead_letter' ELSE 'pending' END,
    next_attempt_at=CASE WHEN d.attempt_count>=c.max_attempts THEN d.next_attempt_at ELSE clock_timestamp()+make_interval(secs=>least(300,(power(2,d.attempt_count)::int)*5)) END,
    lease_owner=NULL,leased_until=NULL,last_error_code=error_code,completed_at=CASE WHEN d.attempt_count>=c.max_attempts THEN clock_timestamp() ELSE NULL END,updated_at=clock_timestamp()
  FROM app.integration_outbox_consumers c
  WHERE d.tenant_id=selected_tenant AND d.event_id=selected_event AND d.consumer_name=selected_consumer AND c.consumer_name=d.consumer_name
    AND d.status='processing' AND d.lease_owner=worker AND d.leased_until>clock_timestamp()
  RETURNING d.status INTO next_status;
  IF next_status IS NULL THEN RAISE EXCEPTION 'OUTBOX_LEASE_LOST'; END IF;
  RETURN next_status;
END $$;

CREATE FUNCTION app.outbox_queue_ready() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT NOT EXISTS(SELECT 1 FROM app.integration_outbox_deliveries d WHERE
    (d.status='pending' AND d.next_attempt_at<=statement_timestamp() AND d.created_at<statement_timestamp()-interval '10 minutes')
    OR (d.status='processing' AND d.leased_until<statement_timestamp()-interval '1 minute'))
$$;

REVOKE ALL ON app.integration_outbox_consumers,app.integration_outbox_events,app.integration_outbox_deliveries,app.integration_consumer_receipts FROM PUBLIC;
REVOKE ALL ON FUNCTION app.emit_integration_event(uuid,uuid,text,text,uuid,integer,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.active_outbox_consumers() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.claim_outbox_deliveries(text,text,integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.record_outbox_receipt(uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.complete_outbox_delivery(uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.fail_outbox_delivery(uuid,uuid,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.outbox_queue_ready() FROM PUBLIC;
GRANT SELECT ON app.integration_outbox_events,app.integration_outbox_deliveries,app.integration_consumer_receipts TO commerce_app;
GRANT EXECUTE ON FUNCTION app.active_outbox_consumers() TO commerce_queue;
GRANT EXECUTE ON FUNCTION app.claim_outbox_deliveries(text,text,integer,integer) TO commerce_queue;
GRANT EXECUTE ON FUNCTION app.record_outbox_receipt(uuid,uuid,text,text) TO commerce_queue;
GRANT EXECUTE ON FUNCTION app.complete_outbox_delivery(uuid,uuid,text,text) TO commerce_queue;
GRANT EXECUTE ON FUNCTION app.fail_outbox_delivery(uuid,uuid,text,text,text) TO commerce_queue;
GRANT EXECUTE ON FUNCTION app.outbox_queue_ready() TO commerce_app;
