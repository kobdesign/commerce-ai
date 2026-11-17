-- EVE-POC-08: make read-only Commerce Agent requests safe across workflow retries.
-- The request receipt remains unique while the reduced response is stored once and replayed.

CREATE TABLE app.agent_service_request_results (
  tenant_id uuid NOT NULL,
  request_id uuid NOT NULL,
  principal_id uuid NOT NULL,
  operation text NOT NULL CHECK(operation IN ('products.query','sales.query','inventory.query')),
  body_hash text NOT NULL CHECK(body_hash~'^[0-9a-f]{64}$'),
  response_payload jsonb NOT NULL CHECK(jsonb_typeof(response_payload)='object'),
  completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,request_id),
  FOREIGN KEY(tenant_id,request_id) REFERENCES app.agent_service_request_receipts(tenant_id,request_id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,principal_id) REFERENCES app.service_principals(tenant_id,id)
);
CREATE INDEX agent_service_request_results_principal_idx
  ON app.agent_service_request_results(tenant_id,principal_id,completed_at DESC);

ALTER TABLE app.agent_service_request_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.agent_service_request_results NO FORCE ROW LEVEL SECURITY;

DROP FUNCTION app.authorize_agent_service_request(text,uuid[],text,text,text,uuid,timestamptz,text,text,text,text);
CREATE FUNCTION app.authorize_agent_service_request(
  credential_hash text,selected_shop_ids uuid[],required_scope text,selected_environment text,selected_audience text,
  selected_request_id uuid,selected_request_timestamp timestamptz,selected_method text,selected_path text,
  selected_body_hash text,selected_request_hash text
) RETURNS TABLE(
  tenant_id uuid,principal_id uuid,shop_ids uuid[],scopes text[],environment text,audience text,
  authenticated_at timestamptz,expires_at timestamptz,replayed boolean
) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  selected_credential private.service_principal_credentials%ROWTYPE;
  selected_principal app.service_principals%ROWTYPE;
  existing_receipt app.agent_service_request_receipts%ROWTYPE;
  effective_expires_at timestamptz;
  authentication_time timestamptz:=clock_timestamp();
  inserted_count integer:=0;
  was_replayed boolean:=false;
BEGIN
  IF credential_hash!~'^[0-9a-f]{64}$' OR required_scope NOT IN ('catalog:read','sales:read','inventory:read')
    OR selected_environment NOT IN ('development','staging','production') OR selected_audience<>'commerce-agent-api'
    OR selected_request_id IS NULL OR selected_request_timestamp IS NULL
    OR selected_method<>'POST' OR selected_path!~'^/api/agent/v1/(products|sales|inventory)/query$'
    OR selected_body_hash!~'^[0-9a-f]{64}$' OR selected_request_hash!~'^[0-9a-f]{64}$'
    OR cardinality(selected_shop_ids) NOT BETWEEN 1 AND 20
    OR (SELECT count(DISTINCT shop_id) FROM unnest(selected_shop_ids) AS values_list(shop_id))<>cardinality(selected_shop_ids)
  THEN RAISE EXCEPTION 'AGENT_REQUEST_INVALID'; END IF;
  IF abs(extract(epoch FROM (authentication_time-selected_request_timestamp)))>300
  THEN RAISE EXCEPTION 'AGENT_REQUEST_EXPIRED'; END IF;

  SELECT c.* INTO selected_credential
  FROM private.service_principal_credentials c WHERE c.secret_hash=credential_hash FOR UPDATE;
  IF NOT FOUND OR selected_credential.revoked_at IS NOT NULL
  THEN RAISE EXCEPTION 'SERVICE_CREDENTIAL_INVALID'; END IF;
  SELECT p.* INTO selected_principal
  FROM app.service_principals p
  WHERE p.tenant_id=selected_credential.tenant_id AND p.id=selected_credential.principal_id FOR UPDATE;
  IF NOT FOUND OR selected_principal.status<>'active' OR selected_principal.revoked_at IS NOT NULL
  THEN RAISE EXCEPTION 'SERVICE_CREDENTIAL_INVALID'; END IF;
  IF selected_credential.expires_at<=authentication_time
    OR (selected_credential.retire_at IS NOT NULL AND selected_credential.retire_at<=authentication_time)
    OR selected_principal.expires_at<=authentication_time
  THEN RAISE EXCEPTION 'SERVICE_IDENTITY_EXPIRED'; END IF;
  IF selected_principal.environment<>selected_environment
  THEN RAISE EXCEPTION 'SERVICE_ENVIRONMENT_FORBIDDEN'; END IF;
  IF selected_principal.audience<>selected_audience
  THEN RAISE EXCEPTION 'SERVICE_AUDIENCE_FORBIDDEN'; END IF;

  IF EXISTS(
    SELECT 1 FROM unnest(selected_shop_ids) AS requested(shop_id)
    WHERE NOT EXISTS(
      SELECT 1 FROM app.service_principal_delegations d
      WHERE d.tenant_id=selected_principal.tenant_id AND d.principal_id=selected_principal.id
        AND d.shop_id=requested.shop_id AND d.revoked_at IS NULL AND d.expires_at>authentication_time
    )
  ) THEN RAISE EXCEPTION 'SERVICE_SHOP_FORBIDDEN'; END IF;
  IF EXISTS(
    SELECT 1 FROM unnest(selected_shop_ids) AS requested(shop_id)
    WHERE NOT EXISTS(
      SELECT 1 FROM app.service_principal_delegations d
      WHERE d.tenant_id=selected_principal.tenant_id AND d.principal_id=selected_principal.id
        AND d.shop_id=requested.shop_id AND d.revoked_at IS NULL AND d.expires_at>authentication_time
        AND required_scope=ANY(d.scopes)
    )
  ) THEN RAISE EXCEPTION 'SERVICE_SCOPE_FORBIDDEN'; END IF;

  SELECT min(d.expires_at) INTO effective_expires_at
  FROM app.service_principal_delegations d
  WHERE d.tenant_id=selected_principal.tenant_id AND d.principal_id=selected_principal.id
    AND d.shop_id=ANY(selected_shop_ids) AND d.revoked_at IS NULL AND required_scope=ANY(d.scopes);
  effective_expires_at:=least(selected_credential.expires_at,selected_principal.expires_at,effective_expires_at);

  INSERT INTO app.agent_service_request_receipts(
    tenant_id,request_id,principal_id,credential_id,required_scope,shop_ids,environment,audience,
    method,path,body_hash,request_hash,request_timestamp,authenticated_at
  ) VALUES(
    selected_principal.tenant_id,selected_request_id,selected_principal.id,selected_credential.id,required_scope,
    selected_shop_ids,selected_environment,selected_audience,selected_method,selected_path,
    selected_body_hash,selected_request_hash,selected_request_timestamp,authentication_time
  ) ON CONFLICT ON CONSTRAINT agent_service_request_receipts_pkey DO NOTHING;
  GET DIAGNOSTICS inserted_count=ROW_COUNT;

  IF inserted_count=0 THEN
    SELECT r.* INTO existing_receipt FROM app.agent_service_request_receipts r
      WHERE r.tenant_id=selected_principal.tenant_id AND r.request_id=selected_request_id;
    IF NOT FOUND OR existing_receipt.principal_id<>selected_principal.id
      OR existing_receipt.required_scope<>required_scope OR existing_receipt.shop_ids<>selected_shop_ids
      OR existing_receipt.environment<>selected_environment OR existing_receipt.audience<>selected_audience
      OR existing_receipt.method<>selected_method OR existing_receipt.path<>selected_path
      OR existing_receipt.body_hash<>selected_body_hash
    THEN RAISE EXCEPTION 'AGENT_REQUEST_REPLAYED'; END IF;
    was_replayed:=true;
  END IF;

  UPDATE private.service_principal_credentials c
    SET last_used_at=authentication_time,authorized_request_count=c.authorized_request_count+1
    WHERE c.tenant_id=selected_credential.tenant_id AND c.id=selected_credential.id;

  RETURN QUERY SELECT selected_principal.tenant_id,selected_principal.id,selected_shop_ids,ARRAY[required_scope]::text[],
    selected_principal.environment,selected_principal.audience,authentication_time,effective_expires_at,was_replayed;
END $$;

CREATE FUNCTION app.read_agent_service_request_result(
  selected_tenant_id uuid,selected_request_id uuid,selected_principal_id uuid,selected_operation text,selected_body_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE stored_payload jsonb;
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM app.agent_service_request_receipts r
    WHERE r.tenant_id=selected_tenant_id AND r.request_id=selected_request_id
      AND r.principal_id=selected_principal_id AND r.body_hash=selected_body_hash
      AND r.path=CASE selected_operation
        WHEN 'products.query' THEN '/api/agent/v1/products/query'
        WHEN 'sales.query' THEN '/api/agent/v1/sales/query'
        WHEN 'inventory.query' THEN '/api/agent/v1/inventory/query'
        ELSE '' END
  ) THEN RAISE EXCEPTION 'AGENT_RESULT_REQUEST_MISMATCH'; END IF;
  SELECT result.response_payload INTO stored_payload
  FROM app.agent_service_request_results result
  WHERE result.tenant_id=selected_tenant_id AND result.request_id=selected_request_id
    AND result.principal_id=selected_principal_id AND result.operation=selected_operation AND result.body_hash=selected_body_hash;
  RETURN stored_payload;
END $$;

CREATE FUNCTION app.store_agent_service_request_result(
  selected_tenant_id uuid,selected_request_id uuid,selected_principal_id uuid,selected_operation text,
  selected_body_hash text,selected_response_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE stored_payload jsonb;
BEGIN
  IF selected_response_payload IS NULL OR jsonb_typeof(selected_response_payload)<>'object'
  THEN RAISE EXCEPTION 'AGENT_RESULT_INVALID'; END IF;
  PERFORM app.read_agent_service_request_result(
    selected_tenant_id,selected_request_id,selected_principal_id,selected_operation,selected_body_hash
  );
  INSERT INTO app.agent_service_request_results(tenant_id,request_id,principal_id,operation,body_hash,response_payload)
  VALUES(selected_tenant_id,selected_request_id,selected_principal_id,selected_operation,selected_body_hash,selected_response_payload)
  ON CONFLICT(tenant_id,request_id) DO NOTHING;
  SELECT result.response_payload INTO stored_payload
  FROM app.agent_service_request_results result
  WHERE result.tenant_id=selected_tenant_id AND result.request_id=selected_request_id
    AND result.principal_id=selected_principal_id AND result.operation=selected_operation AND result.body_hash=selected_body_hash;
  IF stored_payload IS NULL THEN RAISE EXCEPTION 'AGENT_RESULT_CONFLICT'; END IF;
  RETURN stored_payload;
END $$;

REVOKE ALL ON FUNCTION app.authorize_agent_service_request(text,uuid[],text,text,text,uuid,timestamptz,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.read_agent_service_request_result(uuid,uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.store_agent_service_request_result(uuid,uuid,uuid,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.authorize_agent_service_request(text,uuid[],text,text,text,uuid,timestamptz,text,text,text,text) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.read_agent_service_request_result(uuid,uuid,uuid,text,text) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.store_agent_service_request_result(uuid,uuid,uuid,text,text,jsonb) TO commerce_app;
