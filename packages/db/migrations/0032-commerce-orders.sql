-- OPS-AG-01c: internal manual/shadow orders resolve listing identities to canonical SKUs.
-- Provider webhooks and marketplace writes remain outside this boundary.
ALTER TABLE app.inventory_reservations
  DROP CONSTRAINT inventory_reservations_source_check,
  ADD CONSTRAINT inventory_reservations_source_check CHECK(source IN ('manual','order'));

CREATE TABLE app.commerce_orders (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  shop_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'manual_shadow' CHECK(source='manual_shadow'),
  external_order_id text NOT NULL CHECK(length(external_order_id) BETWEEN 1 AND 70),
  order_state text NOT NULL CHECK(order_state IN ('open','completed','cancelled')),
  payment_state text NOT NULL CHECK(payment_state IN ('pending','paid')),
  fulfillment_state text NOT NULL CHECK(fulfillment_state IN ('unfulfilled','shipped','cancelled')),
  ordered_at timestamptz NOT NULL,
  reservation_expires_at timestamptz,
  reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),
  request_payload jsonb NOT NULL,
  confirmed_by uuid NOT NULL REFERENCES private.users(id),
  cancelled_at timestamptz,
  cancelled_by uuid REFERENCES private.users(id),
  cancellation_reason text,
  shipped_at timestamptz,
  shipped_by uuid REFERENCES private.users(id),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,shop_id) REFERENCES app.shops(tenant_id,id),
  UNIQUE(tenant_id,shop_id,source,external_order_id),
  CONSTRAINT commerce_order_state_consistency CHECK(
    (order_state='open' AND fulfillment_state='unfulfilled' AND cancelled_at IS NULL AND cancelled_by IS NULL AND cancellation_reason IS NULL AND shipped_at IS NULL AND shipped_by IS NULL)
    OR (order_state='completed' AND payment_state='paid' AND fulfillment_state='shipped' AND shipped_at IS NOT NULL AND shipped_by IS NOT NULL AND cancelled_at IS NULL)
    OR (order_state='cancelled' AND fulfillment_state='cancelled' AND cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL AND cancellation_reason IS NOT NULL AND shipped_at IS NULL)
  )
);

CREATE TABLE app.commerce_order_lines (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  order_id uuid NOT NULL,
  external_line_id text NOT NULL CHECK(length(external_line_id) BETWEEN 1 AND 70),
  listing_mapping_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  external_product_id text NOT NULL,
  external_variant_id text NOT NULL,
  sku_snapshot text NOT NULL,
  quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 1000000),
  unit_price_minor integer CHECK(unit_price_minor BETWEEN 0 AND 1000000000),
  allocation_status text NOT NULL CHECK(allocation_status IN ('awaiting_payment','reserved','shortage','committed','cancelled')),
  reservation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,order_id) REFERENCES app.commerce_orders(tenant_id,id),
  FOREIGN KEY(tenant_id,listing_mapping_id) REFERENCES app.channel_listing_mappings(tenant_id,id),
  FOREIGN KEY(tenant_id,variant_id) REFERENCES app.variants(tenant_id,id),
  FOREIGN KEY(tenant_id,reservation_id) REFERENCES app.inventory_reservations(tenant_id,id),
  UNIQUE(tenant_id,order_id,external_line_id),
  UNIQUE(tenant_id,reservation_id),
  CONSTRAINT commerce_order_line_allocation CHECK(
    (allocation_status='awaiting_payment' AND reservation_id IS NULL)
    OR (allocation_status IN ('reserved','shortage','committed') AND reservation_id IS NOT NULL)
    OR allocation_status='cancelled'
  )
);
CREATE INDEX commerce_orders_shop_time_idx ON app.commerce_orders(tenant_id,shop_id,ordered_at DESC,id);
CREATE INDEX commerce_order_lines_order_idx ON app.commerce_order_lines(tenant_id,order_id,created_at,id);

ALTER TABLE app.commerce_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.commerce_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE app.commerce_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.commerce_order_lines FORCE ROW LEVEL SECURITY;
CREATE POLICY commerce_orders_read ON app.commerce_orders FOR SELECT USING(
  tenant_id=app.tenant_id() AND app.member_role(tenant_id) IN ('owner','finance','operator','auditor') AND app.shop_allowed(tenant_id,shop_id)
);
CREATE POLICY commerce_order_lines_read ON app.commerce_order_lines FOR SELECT USING(
  tenant_id=app.tenant_id() AND EXISTS(
    SELECT 1 FROM app.commerce_orders o WHERE o.tenant_id=commerce_order_lines.tenant_id AND o.id=commerce_order_lines.order_id
      AND app.member_role(o.tenant_id) IN ('owner','finance','operator','auditor') AND app.shop_allowed(o.tenant_id,o.shop_id)
  )
);

CREATE FUNCTION app.allocate_commerce_order_line(selected_order uuid, selected_line uuid, expires timestamptz)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  t uuid:=app.tenant_id(); actor uuid:=app.actor_id(); line app.commerce_order_lines%ROWTYPE;
  ord app.commerce_orders%ROWTYPE; location uuid; balance app.inventory_balances%ROWTYPE; next_status text; reservation uuid:=gen_random_uuid();
BEGIN
  SELECT * INTO ord FROM app.commerce_orders WHERE tenant_id=t AND id=selected_order FOR UPDATE;
  SELECT * INTO line FROM app.commerce_order_lines WHERE tenant_id=t AND id=selected_line AND order_id=selected_order FOR UPDATE;
  IF NOT FOUND OR ord.id IS NULL THEN RAISE EXCEPTION 'ORDER_LINE_NOT_FOUND'; END IF;
  IF line.allocation_status<>'awaiting_payment' THEN RAISE EXCEPTION 'ORDER_LINE_ALREADY_ALLOCATED'; END IF;
  location:=app.ensure_default_inventory_location();
  INSERT INTO app.inventory_balances(tenant_id,location_id,variant_id) VALUES(t,location,line.variant_id) ON CONFLICT DO NOTHING;
  SELECT * INTO balance FROM app.inventory_balances b WHERE b.tenant_id=t AND b.location_id=location AND b.variant_id=line.variant_id FOR UPDATE;
  next_status:=CASE WHEN balance.on_hand-balance.reserved>=line.quantity THEN 'reserved' ELSE 'shortage' END;
  IF next_status='reserved' THEN
    UPDATE app.inventory_balances b SET reserved=b.reserved+line.quantity,version=b.version+1,updated_at=clock_timestamp()
      WHERE b.tenant_id=t AND b.location_id=location AND b.variant_id=line.variant_id RETURNING b.* INTO balance;
  END IF;
  INSERT INTO app.inventory_reservations(
    tenant_id,id,shop_id,location_id,variant_id,source,source_reference,requested_quantity,reserved_quantity,status,expires_at,reason,confirmed_by
  ) VALUES(
    t,reservation,ord.shop_id,location,line.variant_id,'order',ord.external_order_id||':'||line.external_line_id,line.quantity,
    CASE WHEN next_status='reserved' THEN line.quantity ELSE 0 END,next_status,expires,'ออเดอร์ภายใน '||ord.external_order_id,actor
  );
  UPDATE app.commerce_order_lines SET allocation_status=next_status,reservation_id=reservation WHERE tenant_id=t AND id=line.id;
  RETURN next_status;
END $$;

CREATE FUNCTION app.create_commerce_order(
  selected_shop uuid, order_id uuid, external_order text, ordered timestamptz, initial_payment text,
  expires timestamptz, order_reason text, payload jsonb
) RETURNS TABLE(id uuid,duplicate boolean,payment_state text,reserved_lines integer,shortage_lines integer,version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  t uuid:=app.tenant_id(); actor uuid:=app.actor_id(); prior app.commerce_orders%ROWTYPE; item jsonb; mapping record;
  line_id uuid; allocation text; reserved_count integer:=0; shortage_count integer:=0;
BEGIN
  IF t IS NULL OR actor IS NULL OR app.member_role(t) NOT IN ('owner','finance','operator') THEN RAISE EXCEPTION 'ORDER_FORBIDDEN'; END IF;
  IF NOT app.shop_allowed(t,selected_shop) OR initial_payment NOT IN ('pending','paid')
     OR length(btrim(external_order)) NOT BETWEEN 1 AND 70 OR length(btrim(order_reason)) NOT BETWEEN 3 AND 500
     OR jsonb_typeof(payload->'lines')<>'array' OR jsonb_array_length(payload->'lines') NOT BETWEEN 1 AND 50
     OR (initial_payment='paid' AND (expires IS NULL OR expires<=clock_timestamp()+interval '1 minute' OR expires>clock_timestamp()+interval '30 days')) THEN
    RAISE EXCEPTION 'INVALID_ORDER';
  END IF;
  SELECT * INTO prior FROM app.commerce_orders o WHERE o.tenant_id=t AND o.shop_id=selected_shop AND o.source='manual_shadow' AND o.external_order_id=btrim(external_order);
  IF FOUND THEN
    IF prior.request_payload=payload THEN
      RETURN QUERY SELECT prior.id,true,prior.payment_state,
        (SELECT count(*)::int FROM app.commerce_order_lines l WHERE l.tenant_id=t AND l.order_id=prior.id AND l.allocation_status='reserved'),
        (SELECT count(*)::int FROM app.commerce_order_lines l WHERE l.tenant_id=t AND l.order_id=prior.id AND l.allocation_status='shortage'),prior.version;
      RETURN;
    END IF;
    RAISE EXCEPTION 'ORDER_REFERENCE_CONFLICT';
  END IF;
  INSERT INTO app.commerce_orders(tenant_id,id,shop_id,external_order_id,order_state,payment_state,fulfillment_state,ordered_at,reservation_expires_at,reason,request_payload,confirmed_by)
    VALUES(t,order_id,selected_shop,btrim(external_order),'open',initial_payment,'unfulfilled',ordered,expires,btrim(order_reason),payload,actor);
  FOR item IN SELECT value FROM jsonb_array_elements(payload->'lines') LOOP
    IF length(btrim(item->>'externalLineId')) NOT BETWEEN 1 AND 70 OR (item->>'quantity')::integer NOT BETWEEN 1 AND 1000000 THEN RAISE EXCEPTION 'INVALID_ORDER_LINE'; END IF;
    SELECT m.id,m.variant_id,m.external_product_id,m.external_variant_id,v.sku INTO mapping
      FROM app.channel_listing_mappings m JOIN app.variants v ON v.tenant_id=m.tenant_id AND v.id=m.variant_id
      JOIN app.products p ON p.tenant_id=v.tenant_id AND p.id=v.product_id
      WHERE m.tenant_id=t AND m.id=(item->>'listingMappingId')::uuid AND m.shop_id=selected_shop
        AND m.archived_at IS NULL AND v.archived_at IS NULL AND p.archived_at IS NULL FOR SHARE OF m,v,p;
    IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_LISTING_NOT_ACTIVE'; END IF;
    line_id:=gen_random_uuid();
    INSERT INTO app.commerce_order_lines(tenant_id,id,order_id,external_line_id,listing_mapping_id,variant_id,external_product_id,external_variant_id,sku_snapshot,quantity,unit_price_minor,allocation_status)
      VALUES(t,line_id,order_id,btrim(item->>'externalLineId'),mapping.id,mapping.variant_id,mapping.external_product_id,mapping.external_variant_id,mapping.sku,
        (item->>'quantity')::integer,CASE WHEN item->'unitPriceMinor'='null'::jsonb THEN NULL ELSE (item->>'unitPriceMinor')::integer END,'awaiting_payment');
    IF initial_payment='paid' THEN
      allocation:=app.allocate_commerce_order_line(order_id,line_id,expires);
      IF allocation='reserved' THEN reserved_count:=reserved_count+1; ELSE shortage_count:=shortage_count+1; END IF;
    END IF;
  END LOOP;
  RETURN QUERY SELECT order_id,false,initial_payment,reserved_count,shortage_count,1;
END $$;

CREATE FUNCTION app.transition_commerce_order(
  selected_shop uuid, selected_order uuid, expected_version integer, requested_action text, action_reason text, expires timestamptz DEFAULT NULL
) RETURNS TABLE(id uuid,order_state text,payment_state text,fulfillment_state text,reserved_lines integer,shortage_lines integer,version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  t uuid:=app.tenant_id(); actor uuid:=app.actor_id(); ord app.commerce_orders%ROWTYPE; line record; reservation app.inventory_reservations%ROWTYPE;
  balance app.inventory_balances%ROWTYPE; allocation text; next_version integer;
BEGIN
  IF t IS NULL OR actor IS NULL OR app.member_role(t) NOT IN ('owner','finance','operator') THEN RAISE EXCEPTION 'ORDER_FORBIDDEN'; END IF;
  IF requested_action NOT IN ('confirm_payment','ship','cancel') OR length(btrim(action_reason)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'INVALID_ORDER_ACTION'; END IF;
  SELECT * INTO ord FROM app.commerce_orders o WHERE o.tenant_id=t AND o.id=selected_order AND o.shop_id=selected_shop AND app.shop_allowed(t,o.shop_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
  IF ord.version<>expected_version THEN RAISE EXCEPTION 'STALE_ORDER'; END IF;
  IF ord.order_state<>'open' THEN RAISE EXCEPTION 'ORDER_NOT_OPEN'; END IF;
  IF requested_action='confirm_payment' THEN
    IF ord.payment_state<>'pending' OR expires IS NULL OR expires<=clock_timestamp()+interval '1 minute' OR expires>clock_timestamp()+interval '30 days' THEN RAISE EXCEPTION 'INVALID_PAYMENT_CONFIRMATION'; END IF;
    FOR line IN SELECT id FROM app.commerce_order_lines WHERE tenant_id=t AND order_id=ord.id ORDER BY created_at,id LOOP
      allocation:=app.allocate_commerce_order_line(ord.id,line.id,expires);
    END LOOP;
    UPDATE app.commerce_orders SET payment_state='paid',reservation_expires_at=expires,version=version+1,updated_at=clock_timestamp() WHERE tenant_id=t AND id=ord.id RETURNING version INTO next_version;
  ELSIF requested_action='ship' THEN
    IF ord.payment_state<>'paid' OR EXISTS(SELECT 1 FROM app.commerce_order_lines WHERE tenant_id=t AND order_id=ord.id AND allocation_status<>'reserved') THEN RAISE EXCEPTION 'ORDER_NOT_READY_TO_SHIP'; END IF;
    FOR line IN SELECT l.id,l.reservation_id,r.location_id,r.variant_id,r.requested_quantity,r.expires_at,r.version AS reservation_version
      FROM app.commerce_order_lines l JOIN app.inventory_reservations r ON r.tenant_id=l.tenant_id AND r.id=l.reservation_id
      WHERE l.tenant_id=t AND l.order_id=ord.id ORDER BY l.created_at,l.id FOR UPDATE OF l,r LOOP
      IF line.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'ORDER_RESERVATION_DUE'; END IF;
      SELECT * INTO balance FROM app.inventory_balances b WHERE b.tenant_id=t AND b.location_id=line.location_id AND b.variant_id=line.variant_id FOR UPDATE;
      IF balance.reserved<line.requested_quantity OR balance.on_hand<line.requested_quantity THEN RAISE EXCEPTION 'INVENTORY_INVARIANT'; END IF;
      UPDATE app.inventory_balances b SET on_hand=b.on_hand-line.requested_quantity,reserved=b.reserved-line.requested_quantity,version=b.version+1,updated_at=clock_timestamp()
        WHERE b.tenant_id=t AND b.location_id=line.location_id AND b.variant_id=line.variant_id RETURNING b.* INTO balance;
      INSERT INTO app.inventory_movements(tenant_id,id,location_id,variant_id,movement_type,quantity_delta,balance_after,source,source_reference,reason,confirmed_by)
        VALUES(t,gen_random_uuid(),line.location_id,line.variant_id,'sale_commit',-line.requested_quantity,balance.on_hand,'reservation',line.reservation_id::text,btrim(action_reason),actor);
      UPDATE app.inventory_reservations SET status='committed',reserved_quantity=0,resolved_at=clock_timestamp(),resolved_by=actor,resolution_reason=btrim(action_reason),version=version+1,updated_at=clock_timestamp()
        WHERE tenant_id=t AND id=line.reservation_id;
      UPDATE app.commerce_order_lines SET allocation_status='committed' WHERE tenant_id=t AND id=line.id;
    END LOOP;
    UPDATE app.commerce_orders SET order_state='completed',fulfillment_state='shipped',shipped_at=clock_timestamp(),shipped_by=actor,version=version+1,updated_at=clock_timestamp()
      WHERE tenant_id=t AND id=ord.id RETURNING version INTO next_version;
  ELSE
    FOR line IN SELECT l.id,l.allocation_status,l.reservation_id,r.location_id,r.variant_id,r.requested_quantity
      FROM app.commerce_order_lines l LEFT JOIN app.inventory_reservations r ON r.tenant_id=l.tenant_id AND r.id=l.reservation_id
      WHERE l.tenant_id=t AND l.order_id=ord.id ORDER BY l.created_at,l.id FOR UPDATE OF l,r LOOP
      IF line.allocation_status='reserved' THEN
        SELECT * INTO balance FROM app.inventory_balances b WHERE b.tenant_id=t AND b.location_id=line.location_id AND b.variant_id=line.variant_id FOR UPDATE;
        UPDATE app.inventory_balances b SET reserved=b.reserved-line.requested_quantity,version=b.version+1,updated_at=clock_timestamp()
          WHERE b.tenant_id=t AND b.location_id=line.location_id AND b.variant_id=line.variant_id;
        UPDATE app.inventory_reservations SET status='released',reserved_quantity=0,resolved_at=clock_timestamp(),resolved_by=actor,resolution_reason=btrim(action_reason),version=version+1,updated_at=clock_timestamp()
          WHERE tenant_id=t AND id=line.reservation_id;
      END IF;
      UPDATE app.commerce_order_lines SET allocation_status='cancelled' WHERE tenant_id=t AND id=line.id;
    END LOOP;
    UPDATE app.commerce_orders SET order_state='cancelled',fulfillment_state='cancelled',cancelled_at=clock_timestamp(),cancelled_by=actor,cancellation_reason=btrim(action_reason),version=version+1,updated_at=clock_timestamp()
      WHERE tenant_id=t AND id=ord.id RETURNING version INTO next_version;
  END IF;
  RETURN QUERY SELECT ord.id,
    (SELECT o.order_state FROM app.commerce_orders o WHERE o.tenant_id=t AND o.id=ord.id),
    (SELECT o.payment_state FROM app.commerce_orders o WHERE o.tenant_id=t AND o.id=ord.id),
    (SELECT o.fulfillment_state FROM app.commerce_orders o WHERE o.tenant_id=t AND o.id=ord.id),
    (SELECT count(*)::int FROM app.commerce_order_lines l WHERE l.tenant_id=t AND l.order_id=ord.id AND l.allocation_status='reserved'),
    (SELECT count(*)::int FROM app.commerce_order_lines l WHERE l.tenant_id=t AND l.order_id=ord.id AND l.allocation_status='shortage'),next_version;
END $$;

REVOKE ALL ON FUNCTION app.allocate_commerce_order_line(uuid,uuid,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.create_commerce_order(uuid,uuid,text,timestamptz,text,timestamptz,text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.transition_commerce_order(uuid,uuid,integer,text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.create_commerce_order(uuid,uuid,text,timestamptz,text,timestamptz,text,jsonb) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.transition_commerce_order(uuid,uuid,integer,text,text,timestamptz) TO commerce_app;
GRANT SELECT ON app.commerce_orders,app.commerce_order_lines TO commerce_app;
