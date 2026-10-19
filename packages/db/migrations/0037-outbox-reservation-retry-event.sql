-- A retry can remain shortage; its version still represents a new observable decision.
CREATE OR REPLACE FUNCTION app.capture_inventory_reservation_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE event_name text;
BEGIN
  IF TG_OP='INSERT' THEN event_name:='inventory.reservation_'||NEW.status||'.v1';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN event_name:='inventory.reservation_'||NEW.status||'.v1';
  ELSIF NEW.version<>OLD.version AND NEW.status='shortage' THEN event_name:='inventory.reservation_retried_shortage.v1';
  ELSE RETURN NEW;
  END IF;
  PERFORM app.emit_integration_event(NEW.tenant_id,NEW.shop_id,event_name,'inventory_reservation',NEW.id,NEW.version,
    jsonb_build_object('schemaVersion',1,'reservationId',NEW.id,'shopId',NEW.shop_id,'variantId',NEW.variant_id,
      'source',NEW.source,'sourceReference',NEW.source_reference,'status',NEW.status,'requestedQuantity',NEW.requested_quantity,
      'reservedQuantity',NEW.reserved_quantity,'version',NEW.version));
  RETURN NEW;
END $$;
