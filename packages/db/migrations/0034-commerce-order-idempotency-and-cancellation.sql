-- Serialize a source order key before idempotency lookup and close shortage records on cancellation.
CREATE OR REPLACE FUNCTION app.create_commerce_order(
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
  PERFORM pg_advisory_xact_lock(hashtextextended(t::text||':'||selected_shop::text||':manual_shadow:'||btrim(external_order),0));
  SELECT o.* INTO prior FROM app.commerce_orders o WHERE o.tenant_id=t AND o.shop_id=selected_shop AND o.source='manual_shadow' AND o.external_order_id=btrim(external_order);
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

CREATE FUNCTION app.close_cancelled_order_shortages() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.order_state='cancelled' AND OLD.order_state='open' THEN
    UPDATE app.inventory_reservations r SET status='released',resolved_at=NEW.cancelled_at,resolved_by=NEW.cancelled_by,
      resolution_reason=NEW.cancellation_reason,version=r.version+1,updated_at=clock_timestamp()
      FROM app.commerce_order_lines l
      WHERE l.tenant_id=NEW.tenant_id AND l.order_id=NEW.id AND l.reservation_id=r.id
        AND r.tenant_id=NEW.tenant_id AND r.status='shortage';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER commerce_order_cancel_shortages AFTER UPDATE OF order_state ON app.commerce_orders
  FOR EACH ROW EXECUTE FUNCTION app.close_cancelled_order_shortages();
REVOKE ALL ON FUNCTION app.close_cancelled_order_shortages() FROM PUBLIC;
