-- Qualify the authorized principal variable separately from delegation columns.
CREATE OR REPLACE FUNCTION app.authorize_service_principal(credential_hash text,selected_tenant uuid,selected_shop uuid,required_scope text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE authorized_principal_id uuid;credential_tenant uuid;
BEGIN
  IF credential_hash!~'^[0-9a-f]{64}$' OR required_scope NOT IN ('integration:ingest','integration:read','outbox:publish')
  THEN RAISE EXCEPTION 'SERVICE_CREDENTIAL_INVALID'; END IF;
  SELECT p.id,p.tenant_id INTO authorized_principal_id,credential_tenant
  FROM private.service_principal_credentials c JOIN app.service_principals p ON p.tenant_id=c.tenant_id AND p.id=c.principal_id
  WHERE c.secret_hash=credential_hash AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp()
    AND p.status='active' AND p.revoked_at IS NULL AND p.expires_at>clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'SERVICE_CREDENTIAL_INVALID'; END IF;
  IF credential_tenant<>selected_tenant OR NOT EXISTS(
    SELECT 1 FROM app.service_principal_delegations d WHERE d.tenant_id=selected_tenant AND d.principal_id=authorized_principal_id
      AND d.shop_id=selected_shop AND d.revoked_at IS NULL AND d.expires_at>clock_timestamp() AND required_scope=ANY(d.scopes)
  ) THEN RAISE EXCEPTION 'SERVICE_SCOPE_FORBIDDEN'; END IF;
  UPDATE private.service_principal_credentials c SET last_used_at=clock_timestamp()
  WHERE c.secret_hash=credential_hash AND (c.last_used_at IS NULL OR c.last_used_at<clock_timestamp()-interval '5 minutes');
  RETURN authorized_principal_id;
END $$;

REVOKE ALL ON FUNCTION app.authorize_service_principal(text,uuid,uuid,text) FROM PUBLIC;
