-- OPS-AG-01b: explicit internal reservations and shortage-safe lifecycle.
-- No marketplace event can call these commands until connector policy is approved.
ALTER TABLE app.inventory_movements
  DROP CONSTRAINT inventory_movements_movement_type_check,
  ADD CONSTRAINT inventory_movements_movement_type_check
    CHECK(movement_type IN ('opening','receipt','adjustment_in','adjustment_out','sale_commit'));
ALTER TABLE app.inventory_movements
  DROP CONSTRAINT inventory_movements_source_check,
  ADD CONSTRAINT inventory_movements_source_check CHECK(source IN ('manual','reservation'));
ALTER TABLE app.inventory_movements
  DROP CONSTRAINT inventory_movement_direction,
  ADD CONSTRAINT inventory_movement_direction CHECK(
    (movement_type IN ('opening','receipt','adjustment_in') AND quantity_delta > 0)
    OR (movement_type IN ('adjustment_out','sale_commit') AND quantity_delta < 0)
  );

CREATE TABLE app.inventory_reservations (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  shop_id uuid NOT NULL,
  location_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'manual' CHECK(source='manual'),
  source_reference text NOT NULL CHECK(length(source_reference) BETWEEN 1 AND 160),
  requested_quantity integer NOT NULL CHECK(requested_quantity BETWEEN 1 AND 1000000),
  reserved_quantity integer NOT NULL DEFAULT 0 CHECK(reserved_quantity BETWEEN 0 AND requested_quantity),
  status text NOT NULL CHECK(status IN ('reserved','shortage','committed','released','expired')),
  expires_at timestamptz NOT NULL,
  reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  confirmed_by uuid NOT NULL REFERENCES private.users(id),
  resolved_at timestamptz,
  resolved_by uuid REFERENCES private.users(id),
  resolution_reason text CHECK(resolution_reason IS NULL OR length(resolution_reason) BETWEEN 3 AND 500),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,shop_id) REFERENCES app.shops(tenant_id,id),
  FOREIGN KEY(tenant_id,location_id) REFERENCES app.inventory_locations(tenant_id,id),
  FOREIGN KEY(tenant_id,variant_id) REFERENCES app.variants(tenant_id,id),
  UNIQUE(tenant_id,shop_id,variant_id,source,source_reference),
  CONSTRAINT inventory_reservation_state CHECK(
    (status='reserved' AND reserved_quantity=requested_quantity AND resolved_at IS NULL AND resolved_by IS NULL AND resolution_reason IS NULL)
    OR (status='shortage' AND reserved_quantity=0 AND resolved_at IS NULL AND resolved_by IS NULL AND resolution_reason IS NULL)
    OR (status IN ('committed','released','expired') AND reserved_quantity=0 AND resolved_at IS NOT NULL AND resolved_by IS NOT NULL AND resolution_reason IS NOT NULL)
  )
);
CREATE INDEX inventory_reservations_product_time_idx
  ON app.inventory_reservations(tenant_id,variant_id,created_at DESC,id);
CREATE INDEX inventory_reservations_active_expiry_idx
  ON app.inventory_reservations(tenant_id,expires_at) WHERE status='reserved';

ALTER TABLE app.inventory_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.inventory_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_reservations_read ON app.inventory_reservations FOR SELECT USING(
  tenant_id=app.tenant_id()
  AND app.member_role(tenant_id) IN ('owner','finance','operator','auditor')
  AND app.shop_allowed(tenant_id,shop_id)
  AND app.variant_allowed(tenant_id,variant_id)
);

CREATE FUNCTION app.create_inventory_reservation(
  selected_shop uuid,
  selected_product uuid,
  selected_variant uuid,
  reservation_id uuid,
  quantity integer,
  reference text,
  expires timestamptz,
  reservation_reason text
) RETURNS TABLE(id uuid,duplicate boolean,status text,reserved integer,available integer,version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  t uuid:=app.tenant_id(); actor uuid:=app.actor_id(); location uuid;
  current_balance app.inventory_balances%ROWTYPE;
  prior app.inventory_reservations%ROWTYPE;
  initial_status text;
BEGIN
  IF t IS NULL OR actor IS NULL OR app.member_role(t) NOT IN ('owner','finance','operator') THEN
    RAISE EXCEPTION 'INVENTORY_FORBIDDEN';
  END IF;
  IF quantity NOT BETWEEN 1 AND 1000000
     OR length(btrim(reference)) NOT BETWEEN 1 AND 160
     OR length(btrim(reservation_reason)) NOT BETWEEN 3 AND 500
     OR expires <= clock_timestamp()+interval '1 minute'
     OR expires > clock_timestamp()+interval '30 days' THEN
    RAISE EXCEPTION 'INVALID_RESERVATION';
  END IF;
  IF NOT app.shop_allowed(t,selected_shop) OR NOT EXISTS(
    SELECT 1 FROM app.variants v
    JOIN app.shop_products sp ON sp.tenant_id=v.tenant_id AND sp.product_id=v.product_id
    WHERE v.tenant_id=t AND v.id=selected_variant AND v.product_id=selected_product
      AND sp.shop_id=selected_shop
  ) THEN
    RAISE EXCEPTION 'INVENTORY_PRODUCT_FORBIDDEN';
  END IF;

  location:=app.ensure_default_inventory_location();
  INSERT INTO app.inventory_balances(tenant_id,location_id,variant_id)
    VALUES(t,location,selected_variant) ON CONFLICT DO NOTHING;
  SELECT * INTO current_balance FROM app.inventory_balances b
    WHERE b.tenant_id=t AND b.location_id=location AND b.variant_id=selected_variant
    FOR UPDATE;

  SELECT * INTO prior FROM app.inventory_reservations r
    WHERE r.tenant_id=t AND r.shop_id=selected_shop AND r.variant_id=selected_variant
      AND r.source='manual' AND r.source_reference=btrim(reference);
  IF FOUND THEN
    IF prior.requested_quantity=quantity AND prior.expires_at=expires
       AND prior.reason=btrim(reservation_reason) THEN
      RETURN QUERY SELECT prior.id,true,prior.status,current_balance.reserved,
        current_balance.on_hand-current_balance.reserved,prior.version;
      RETURN;
    END IF;
    RAISE EXCEPTION 'RESERVATION_REFERENCE_CONFLICT';
  END IF;

  initial_status:=CASE WHEN current_balance.on_hand-current_balance.reserved>=quantity THEN 'reserved' ELSE 'shortage' END;
  IF initial_status='reserved' THEN
    UPDATE app.inventory_balances b SET reserved=b.reserved+quantity,version=b.version+1,updated_at=clock_timestamp()
      WHERE b.tenant_id=t AND b.location_id=location AND b.variant_id=selected_variant
      RETURNING b.* INTO current_balance;
  END IF;
  INSERT INTO app.inventory_reservations(
    tenant_id,id,shop_id,location_id,variant_id,source,source_reference,
    requested_quantity,reserved_quantity,status,expires_at,reason,confirmed_by
  ) VALUES(
    t,reservation_id,selected_shop,location,selected_variant,'manual',btrim(reference),
    quantity,CASE WHEN initial_status='reserved' THEN quantity ELSE 0 END,initial_status,expires,btrim(reservation_reason),actor
  );
  RETURN QUERY SELECT reservation_id,false,initial_status,current_balance.reserved,
    current_balance.on_hand-current_balance.reserved,1;
END $$;

CREATE FUNCTION app.transition_inventory_reservation(
  selected_shop uuid,
  selected_product uuid,
  reservation_id uuid,
  expected_version integer,
  requested_action text,
  action_reason text,
  retry_expires timestamptz DEFAULT NULL
) RETURNS TABLE(id uuid,status text,on_hand integer,reserved integer,available integer,version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  t uuid:=app.tenant_id(); actor uuid:=app.actor_id();
  reservation app.inventory_reservations%ROWTYPE;
  current_balance app.inventory_balances%ROWTYPE;
  next_status text; next_reserved integer;
BEGIN
  IF t IS NULL OR actor IS NULL OR app.member_role(t) NOT IN ('owner','finance','operator') THEN
    RAISE EXCEPTION 'INVENTORY_FORBIDDEN';
  END IF;
  IF requested_action NOT IN ('commit','release','expire','retry')
     OR length(btrim(action_reason)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'INVALID_RESERVATION_ACTION';
  END IF;
  SELECT r.* INTO reservation FROM app.inventory_reservations r
    JOIN app.variants v ON v.tenant_id=r.tenant_id AND v.id=r.variant_id
    JOIN app.shop_products sp ON sp.tenant_id=v.tenant_id AND sp.product_id=v.product_id AND sp.shop_id=r.shop_id
    WHERE r.tenant_id=t AND r.id=reservation_id AND r.shop_id=selected_shop
      AND v.product_id=selected_product AND app.shop_allowed(t,r.shop_id)
    FOR UPDATE OF r;
  IF NOT FOUND THEN RAISE EXCEPTION 'RESERVATION_NOT_FOUND'; END IF;
  IF reservation.version<>expected_version THEN RAISE EXCEPTION 'STALE_RESERVATION'; END IF;

  SELECT * INTO current_balance FROM app.inventory_balances b
    WHERE b.tenant_id=t AND b.location_id=reservation.location_id AND b.variant_id=reservation.variant_id
    FOR UPDATE;
  IF requested_action='commit' THEN
    IF reservation.status<>'reserved' THEN RAISE EXCEPTION 'RESERVATION_NOT_ACTIVE'; END IF;
    IF reservation.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'RESERVATION_DUE'; END IF;
    IF current_balance.reserved<reservation.requested_quantity OR current_balance.on_hand<reservation.requested_quantity THEN
      RAISE EXCEPTION 'INVENTORY_INVARIANT';
    END IF;
    UPDATE app.inventory_balances b SET
      on_hand=b.on_hand-reservation.requested_quantity,reserved=b.reserved-reservation.requested_quantity,
      version=b.version+1,updated_at=clock_timestamp()
      WHERE b.tenant_id=t AND b.location_id=reservation.location_id AND b.variant_id=reservation.variant_id
      RETURNING b.* INTO current_balance;
    INSERT INTO app.inventory_movements(
      tenant_id,id,location_id,variant_id,movement_type,quantity_delta,balance_after,
      source,source_reference,reason,confirmed_by
    ) VALUES(
      t,gen_random_uuid(),reservation.location_id,reservation.variant_id,'sale_commit',-reservation.requested_quantity,
      current_balance.on_hand,'reservation',reservation.id::text,btrim(action_reason),actor
    );
    next_status:='committed';next_reserved:=0;
  ELSIF requested_action='release' THEN
    IF reservation.status<>'reserved' THEN RAISE EXCEPTION 'RESERVATION_NOT_ACTIVE'; END IF;
    UPDATE app.inventory_balances b SET reserved=b.reserved-reservation.requested_quantity,
      version=b.version+1,updated_at=clock_timestamp()
      WHERE b.tenant_id=t AND b.location_id=reservation.location_id AND b.variant_id=reservation.variant_id
      RETURNING b.* INTO current_balance;
    next_status:='released';next_reserved:=0;
  ELSIF requested_action='expire' THEN
    IF reservation.status<>'reserved' THEN RAISE EXCEPTION 'RESERVATION_NOT_ACTIVE'; END IF;
    IF reservation.expires_at>clock_timestamp() THEN RAISE EXCEPTION 'RESERVATION_NOT_DUE'; END IF;
    UPDATE app.inventory_balances b SET reserved=b.reserved-reservation.requested_quantity,
      version=b.version+1,updated_at=clock_timestamp()
      WHERE b.tenant_id=t AND b.location_id=reservation.location_id AND b.variant_id=reservation.variant_id
      RETURNING b.* INTO current_balance;
    next_status:='expired';next_reserved:=0;
  ELSE
    IF reservation.status NOT IN ('shortage','expired') THEN RAISE EXCEPTION 'RESERVATION_NOT_RETRYABLE'; END IF;
    IF retry_expires IS NULL OR retry_expires<=clock_timestamp()+interval '1 minute'
       OR retry_expires>clock_timestamp()+interval '30 days' THEN RAISE EXCEPTION 'INVALID_RESERVATION'; END IF;
    IF current_balance.on_hand-current_balance.reserved>=reservation.requested_quantity THEN
      UPDATE app.inventory_balances b SET reserved=b.reserved+reservation.requested_quantity,
        version=b.version+1,updated_at=clock_timestamp()
        WHERE b.tenant_id=t AND b.location_id=reservation.location_id AND b.variant_id=reservation.variant_id
        RETURNING b.* INTO current_balance;
      next_status:='reserved';next_reserved:=reservation.requested_quantity;
    ELSE
      next_status:='shortage';next_reserved:=0;
    END IF;
  END IF;

  UPDATE app.inventory_reservations r SET
    status=next_status,reserved_quantity=next_reserved,
    expires_at=CASE WHEN requested_action='retry' THEN retry_expires ELSE r.expires_at END,
    resolved_at=CASE WHEN next_status IN ('committed','released','expired') THEN clock_timestamp() ELSE NULL END,
    resolved_by=CASE WHEN next_status IN ('committed','released','expired') THEN actor ELSE NULL END,
    resolution_reason=CASE WHEN next_status IN ('committed','released','expired') THEN btrim(action_reason) ELSE NULL END,
    version=r.version+1,updated_at=clock_timestamp()
    WHERE r.tenant_id=t AND r.id=reservation.id
    RETURNING r.version INTO expected_version;
  RETURN QUERY SELECT reservation.id,next_status,current_balance.on_hand,current_balance.reserved,
    current_balance.on_hand-current_balance.reserved,expected_version;
END $$;

REVOKE ALL ON FUNCTION app.create_inventory_reservation(uuid,uuid,uuid,uuid,integer,text,timestamptz,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.transition_inventory_reservation(uuid,uuid,uuid,integer,text,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.create_inventory_reservation(uuid,uuid,uuid,uuid,integer,text,timestamptz,text) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.transition_inventory_reservation(uuid,uuid,uuid,integer,text,text,timestamptz) TO commerce_app;
GRANT SELECT ON app.inventory_reservations TO commerce_app;
