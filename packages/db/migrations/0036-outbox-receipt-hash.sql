-- pgcrypto installs digest in public; security-definer functions use an empty search path.
CREATE OR REPLACE FUNCTION app.record_outbox_receipt(selected_tenant uuid,selected_event uuid,selected_consumer text,worker text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE inserted integer;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM app.integration_outbox_deliveries d WHERE d.tenant_id=selected_tenant AND d.event_id=selected_event
    AND d.consumer_name=selected_consumer AND d.status='processing' AND d.lease_owner=worker AND d.leased_until>clock_timestamp()) THEN
    RAISE EXCEPTION 'OUTBOX_LEASE_LOST';
  END IF;
  INSERT INTO app.integration_consumer_receipts(tenant_id,event_id,consumer_name,event_type,payload_hash)
  SELECT e.tenant_id,e.id,selected_consumer,e.event_type,encode(public.digest(e.payload::text,'sha256'),'hex')
  FROM app.integration_outbox_events e WHERE e.tenant_id=selected_tenant AND e.id=selected_event
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted=ROW_COUNT;
  RETURN inserted=0;
END $$;
