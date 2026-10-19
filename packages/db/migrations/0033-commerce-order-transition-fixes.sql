-- Fix transition locks and qualify identifiers that overlap TABLE return columns.
CREATE OR REPLACE FUNCTION app.transition_commerce_order(
  selected_shop uuid, selected_order uuid, expected_version integer, requested_action text, action_reason text, expires timestamptz DEFAULT NULL
) RETURNS TABLE(id uuid,order_state text,payment_state text,fulfillment_state text,reserved_lines integer,shortage_lines integer,version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  t uuid:=app.tenant_id(); actor uuid:=app.actor_id(); ord app.commerce_orders%ROWTYPE; line record; reservation app.inventory_reservations%ROWTYPE;
  balance app.inventory_balances%ROWTYPE; allocation text; next_version integer;
BEGIN
  IF t IS NULL OR actor IS NULL OR app.member_role(t) NOT IN ('owner','finance','operator') THEN RAISE EXCEPTION 'ORDER_FORBIDDEN'; END IF;
  IF requested_action NOT IN ('confirm_payment','ship','cancel') OR length(btrim(action_reason)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'INVALID_ORDER_ACTION'; END IF;
  SELECT o.* INTO ord FROM app.commerce_orders o WHERE o.tenant_id=t AND o.id=selected_order AND o.shop_id=selected_shop AND app.shop_allowed(t,o.shop_id) FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ORDER_NOT_FOUND'; END IF;
  IF ord.version<>expected_version THEN RAISE EXCEPTION 'STALE_ORDER'; END IF;
  IF ord.order_state<>'open' THEN RAISE EXCEPTION 'ORDER_NOT_OPEN'; END IF;
  IF requested_action='confirm_payment' THEN
    IF ord.payment_state<>'pending' OR expires IS NULL OR expires<=clock_timestamp()+interval '1 minute' OR expires>clock_timestamp()+interval '30 days' THEN RAISE EXCEPTION 'INVALID_PAYMENT_CONFIRMATION'; END IF;
    FOR line IN SELECT l.id AS line_id FROM app.commerce_order_lines l WHERE l.tenant_id=t AND l.order_id=ord.id ORDER BY l.created_at,l.id LOOP
      allocation:=app.allocate_commerce_order_line(ord.id,line.line_id,expires);
    END LOOP;
    UPDATE app.commerce_orders o SET payment_state='paid',reservation_expires_at=expires,version=o.version+1,updated_at=clock_timestamp()
      WHERE o.tenant_id=t AND o.id=ord.id RETURNING o.version INTO next_version;
  ELSIF requested_action='ship' THEN
    IF ord.payment_state<>'paid' OR EXISTS(SELECT 1 FROM app.commerce_order_lines l WHERE l.tenant_id=t AND l.order_id=ord.id AND l.allocation_status<>'reserved') THEN RAISE EXCEPTION 'ORDER_NOT_READY_TO_SHIP'; END IF;
    FOR line IN SELECT l.id AS line_id,l.reservation_id AS linked_reservation_id,r.location_id AS linked_location_id,r.variant_id AS linked_variant_id,
        r.requested_quantity AS linked_quantity,r.expires_at AS linked_expires_at
      FROM app.commerce_order_lines l JOIN app.inventory_reservations r ON r.tenant_id=l.tenant_id AND r.id=l.reservation_id
      WHERE l.tenant_id=t AND l.order_id=ord.id ORDER BY l.created_at,l.id FOR UPDATE OF l,r LOOP
      IF line.linked_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'ORDER_RESERVATION_DUE'; END IF;
      SELECT b.* INTO balance FROM app.inventory_balances b WHERE b.tenant_id=t AND b.location_id=line.linked_location_id AND b.variant_id=line.linked_variant_id FOR UPDATE;
      IF balance.reserved<line.linked_quantity OR balance.on_hand<line.linked_quantity THEN RAISE EXCEPTION 'INVENTORY_INVARIANT'; END IF;
      UPDATE app.inventory_balances b SET on_hand=b.on_hand-line.linked_quantity,reserved=b.reserved-line.linked_quantity,version=b.version+1,updated_at=clock_timestamp()
        WHERE b.tenant_id=t AND b.location_id=line.linked_location_id AND b.variant_id=line.linked_variant_id RETURNING b.* INTO balance;
      INSERT INTO app.inventory_movements(tenant_id,id,location_id,variant_id,movement_type,quantity_delta,balance_after,source,source_reference,reason,confirmed_by)
        VALUES(t,gen_random_uuid(),line.linked_location_id,line.linked_variant_id,'sale_commit',-line.linked_quantity,balance.on_hand,'reservation',line.linked_reservation_id::text,btrim(action_reason),actor);
      UPDATE app.inventory_reservations r SET status='committed',reserved_quantity=0,resolved_at=clock_timestamp(),resolved_by=actor,resolution_reason=btrim(action_reason),version=r.version+1,updated_at=clock_timestamp()
        WHERE r.tenant_id=t AND r.id=line.linked_reservation_id;
      UPDATE app.commerce_order_lines l SET allocation_status='committed' WHERE l.tenant_id=t AND l.id=line.line_id;
    END LOOP;
    UPDATE app.commerce_orders o SET order_state='completed',fulfillment_state='shipped',shipped_at=clock_timestamp(),shipped_by=actor,version=o.version+1,updated_at=clock_timestamp()
      WHERE o.tenant_id=t AND o.id=ord.id RETURNING o.version INTO next_version;
  ELSE
    FOR line IN SELECT l.id AS line_id,l.allocation_status AS line_allocation_status,l.reservation_id AS linked_reservation_id
      FROM app.commerce_order_lines l WHERE l.tenant_id=t AND l.order_id=ord.id ORDER BY l.created_at,l.id FOR UPDATE OF l LOOP
      IF line.line_allocation_status='reserved' THEN
        SELECT r.* INTO reservation FROM app.inventory_reservations r WHERE r.tenant_id=t AND r.id=line.linked_reservation_id FOR UPDATE;
        SELECT b.* INTO balance FROM app.inventory_balances b WHERE b.tenant_id=t AND b.location_id=reservation.location_id AND b.variant_id=reservation.variant_id FOR UPDATE;
        UPDATE app.inventory_balances b SET reserved=b.reserved-reservation.requested_quantity,version=b.version+1,updated_at=clock_timestamp()
          WHERE b.tenant_id=t AND b.location_id=reservation.location_id AND b.variant_id=reservation.variant_id;
        UPDATE app.inventory_reservations r SET status='released',reserved_quantity=0,resolved_at=clock_timestamp(),resolved_by=actor,resolution_reason=btrim(action_reason),version=r.version+1,updated_at=clock_timestamp()
          WHERE r.tenant_id=t AND r.id=line.linked_reservation_id;
      END IF;
      UPDATE app.commerce_order_lines l SET allocation_status='cancelled' WHERE l.tenant_id=t AND l.id=line.line_id;
    END LOOP;
    UPDATE app.commerce_orders o SET order_state='cancelled',fulfillment_state='cancelled',cancelled_at=clock_timestamp(),cancelled_by=actor,cancellation_reason=btrim(action_reason),version=o.version+1,updated_at=clock_timestamp()
      WHERE o.tenant_id=t AND o.id=ord.id RETURNING o.version INTO next_version;
  END IF;
  RETURN QUERY SELECT ord.id,
    (SELECT o.order_state FROM app.commerce_orders o WHERE o.tenant_id=t AND o.id=ord.id),
    (SELECT o.payment_state FROM app.commerce_orders o WHERE o.tenant_id=t AND o.id=ord.id),
    (SELECT o.fulfillment_state FROM app.commerce_orders o WHERE o.tenant_id=t AND o.id=ord.id),
    (SELECT count(*)::int FROM app.commerce_order_lines l WHERE l.tenant_id=t AND l.order_id=ord.id AND l.allocation_status='reserved'),
    (SELECT count(*)::int FROM app.commerce_order_lines l WHERE l.tenant_id=t AND l.order_id=ord.id AND l.allocation_status='shortage'),next_version;
END $$;
