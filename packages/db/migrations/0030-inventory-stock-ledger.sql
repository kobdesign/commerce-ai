-- OPS-AG-01a: one company-wide stock authority with an append-only ledger.
-- Marketplace reservations and writes intentionally remain outside this boundary.
CREATE TABLE app.inventory_locations (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  id uuid NOT NULL,
  code text NOT NULL CHECK(length(code) BETWEEN 1 AND 40),
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
  is_default boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES private.users(id),
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,code)
);
CREATE UNIQUE INDEX inventory_locations_one_default
  ON app.inventory_locations(tenant_id) WHERE is_default;

CREATE TABLE app.inventory_balances (
  tenant_id uuid NOT NULL,
  location_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  on_hand integer NOT NULL DEFAULT 0 CHECK(on_hand BETWEEN 0 AND 1000000000),
  reserved integer NOT NULL DEFAULT 0 CHECK(reserved BETWEEN 0 AND 1000000000),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,location_id,variant_id),
  FOREIGN KEY(tenant_id,location_id) REFERENCES app.inventory_locations(tenant_id,id),
  FOREIGN KEY(tenant_id,variant_id) REFERENCES app.variants(tenant_id,id),
  CONSTRAINT inventory_balance_available CHECK(reserved <= on_hand)
);
CREATE INDEX inventory_balances_variant_idx
  ON app.inventory_balances(tenant_id,variant_id);

CREATE TABLE app.inventory_movements (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  location_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  movement_type text NOT NULL CHECK(movement_type IN ('opening','receipt','adjustment_in','adjustment_out')),
  quantity_delta integer NOT NULL CHECK(quantity_delta <> 0 AND abs(quantity_delta) <= 1000000),
  balance_after integer NOT NULL CHECK(balance_after BETWEEN 0 AND 1000000000),
  source text NOT NULL DEFAULT 'manual' CHECK(source='manual'),
  source_reference text NOT NULL CHECK(length(source_reference) BETWEEN 1 AND 160),
  reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  confirmed_by uuid NOT NULL REFERENCES private.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,location_id) REFERENCES app.inventory_locations(tenant_id,id),
  FOREIGN KEY(tenant_id,variant_id) REFERENCES app.variants(tenant_id,id),
  CONSTRAINT inventory_movement_direction CHECK(
    (movement_type IN ('opening','receipt','adjustment_in') AND quantity_delta > 0)
    OR (movement_type='adjustment_out' AND quantity_delta < 0)
  ),
  UNIQUE(tenant_id,location_id,variant_id,source,source_reference)
);
CREATE INDEX inventory_movements_variant_time_idx
  ON app.inventory_movements(tenant_id,variant_id,created_at DESC,id);

ALTER TABLE app.inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.inventory_locations FORCE ROW LEVEL SECURITY;
ALTER TABLE app.inventory_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.inventory_balances FORCE ROW LEVEL SECURITY;
ALTER TABLE app.inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.inventory_movements FORCE ROW LEVEL SECURITY;

CREATE POLICY inventory_locations_read ON app.inventory_locations FOR SELECT USING(
  tenant_id=app.tenant_id()
  AND app.member_role(tenant_id) IN ('owner','finance','operator','auditor')
);
CREATE POLICY inventory_balances_read ON app.inventory_balances FOR SELECT USING(
  tenant_id=app.tenant_id()
  AND app.member_role(tenant_id) IN ('owner','finance','operator','auditor')
  AND app.variant_allowed(tenant_id,variant_id)
);
CREATE POLICY inventory_movements_read ON app.inventory_movements FOR SELECT USING(
  tenant_id=app.tenant_id()
  AND app.member_role(tenant_id) IN ('owner','finance','operator','auditor')
  AND app.variant_allowed(tenant_id,variant_id)
);

-- The application cannot write balances or ledger rows directly. This function
-- owns the row lock, non-negative invariant and retry-safe reference boundary.
CREATE FUNCTION app.ensure_default_inventory_location() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  t uuid:=app.tenant_id(); actor uuid:=app.actor_id(); location uuid;
BEGIN
  IF t IS NULL OR actor IS NULL OR app.member_role(t) NOT IN ('owner','finance','operator') THEN
    RAISE EXCEPTION 'INVENTORY_FORBIDDEN';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('inventory-location:'||t::text));
  SELECT l.id INTO location FROM app.inventory_locations l
    WHERE l.tenant_id=t AND l.is_default AND l.active LIMIT 1;
  IF location IS NULL THEN
    location:=gen_random_uuid();
    INSERT INTO app.inventory_locations(tenant_id,id,code,name,is_default,created_by)
      VALUES(t,location,'MAIN','คลังหลัก',true,actor);
  END IF;
  RETURN location;
END $$;

CREATE FUNCTION app.record_inventory_movement(
  selected_shop uuid,
  selected_product uuid,
  selected_variant uuid,
  movement_id uuid,
  requested_type text,
  requested_quantity integer,
  requested_reference text,
  requested_reason text
) RETURNS TABLE(id uuid,duplicate boolean,on_hand integer,reserved integer,version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  t uuid:=app.tenant_id(); actor uuid:=app.actor_id(); location uuid;
  delta integer; current_balance app.inventory_balances%ROWTYPE;
  prior app.inventory_movements%ROWTYPE;
BEGIN
  IF t IS NULL OR actor IS NULL OR app.member_role(t) NOT IN ('owner','finance','operator') THEN
    RAISE EXCEPTION 'INVENTORY_FORBIDDEN';
  END IF;
  IF requested_type NOT IN ('opening','receipt','adjustment_in','adjustment_out')
     OR requested_quantity NOT BETWEEN 1 AND 1000000
     OR length(btrim(requested_reference)) NOT BETWEEN 1 AND 160
     OR length(btrim(requested_reason)) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'INVALID_INVENTORY_MOVEMENT';
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

  delta:=CASE WHEN requested_type='adjustment_out' THEN -requested_quantity ELSE requested_quantity END;
  SELECT * INTO prior FROM app.inventory_movements m
    WHERE m.tenant_id=t AND m.location_id=location AND m.variant_id=selected_variant
      AND m.source='manual' AND m.source_reference=btrim(requested_reference);
  IF FOUND THEN
    IF prior.movement_type=requested_type AND prior.quantity_delta=delta
       AND prior.reason=btrim(requested_reason) THEN
      RETURN QUERY SELECT prior.id,true,current_balance.on_hand,current_balance.reserved,current_balance.version;
      RETURN;
    END IF;
    RAISE EXCEPTION 'INVENTORY_REFERENCE_CONFLICT';
  END IF;

  IF requested_type='opening' AND EXISTS(
    SELECT 1 FROM app.inventory_movements m
    WHERE m.tenant_id=t AND m.location_id=location AND m.variant_id=selected_variant
  ) THEN
    RAISE EXCEPTION 'INVENTORY_OPENING_EXISTS';
  END IF;
  IF current_balance.on_hand+delta < current_balance.reserved THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK';
  END IF;

  UPDATE app.inventory_balances b SET
    on_hand=b.on_hand+delta,version=b.version+1,updated_at=clock_timestamp()
    WHERE b.tenant_id=t AND b.location_id=location AND b.variant_id=selected_variant
    RETURNING b.* INTO current_balance;
  INSERT INTO app.inventory_movements(
    tenant_id,id,location_id,variant_id,movement_type,quantity_delta,balance_after,
    source,source_reference,reason,confirmed_by
  ) VALUES(
    t,movement_id,location,selected_variant,requested_type,delta,current_balance.on_hand,
    'manual',btrim(requested_reference),btrim(requested_reason),actor
  );
  RETURN QUERY SELECT movement_id,false,current_balance.on_hand,current_balance.reserved,current_balance.version;
END $$;

REVOKE ALL ON FUNCTION app.ensure_default_inventory_location() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.record_inventory_movement(uuid,uuid,uuid,uuid,text,integer,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ensure_default_inventory_location() TO commerce_app;
GRANT EXECUTE ON FUNCTION app.record_inventory_movement(uuid,uuid,uuid,uuid,text,integer,text,text) TO commerce_app;
GRANT SELECT ON app.inventory_locations,app.inventory_balances,app.inventory_movements TO commerce_app;
