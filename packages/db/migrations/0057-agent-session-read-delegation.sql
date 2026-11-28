-- Multi-tenant Eve reads use the short-lived continuation grant issued by
-- Commerce Core. No tenant ID or tenant credential is stored in Vercel.

CREATE TABLE app.agent_session_read_receipts (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  request_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  session_id text NOT NULL,
  subject_id uuid NOT NULL REFERENCES private.users(id),
  required_scope text NOT NULL CHECK(required_scope IN ('catalog:read','sales:read','inventory:read')),
  shop_ids uuid[] NOT NULL CHECK(cardinality(shop_ids) BETWEEN 1 AND 20),
  environment text NOT NULL CHECK(environment IN ('development','staging')),
  audience text NOT NULL CHECK(audience='commerce-agent-api'),
  method text NOT NULL CHECK(method='POST'),
  path text NOT NULL CHECK(path~'^/api/agent/v1/(products|sales|inventory)/query$'),
  body_hash text NOT NULL CHECK(body_hash~'^[0-9a-f]{64}$'),
  request_timestamp timestamptz NOT NULL,
  authenticated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY(tenant_id,request_id),
  FOREIGN KEY(tenant_id,grant_id) REFERENCES app.agent_session_grants(tenant_id,grant_id),
  FOREIGN KEY(tenant_id,session_id) REFERENCES app.agent_sessions(tenant_id,session_id)
);

CREATE TABLE app.agent_session_read_results (
  tenant_id uuid NOT NULL,
  request_id uuid NOT NULL,
  subject_id uuid NOT NULL REFERENCES private.users(id),
  operation text NOT NULL CHECK(operation IN ('products.query','sales.query','inventory.query')),
  body_hash text NOT NULL CHECK(body_hash~'^[0-9a-f]{64}$'),
  response_payload jsonb NOT NULL CHECK(jsonb_typeof(response_payload)='object'),
  completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,request_id),
  FOREIGN KEY(tenant_id,request_id) REFERENCES app.agent_session_read_receipts(tenant_id,request_id) ON DELETE CASCADE
);

ALTER TABLE app.agent_session_read_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.agent_session_read_receipts NO FORCE ROW LEVEL SECURITY;
ALTER TABLE app.agent_session_read_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.agent_session_read_results NO FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_session_read_receipts_policy ON app.agent_session_read_receipts FOR SELECT TO commerce_app USING(
  tenant_id=app.tenant_id() AND (subject_id=app.actor_id() OR app.member_role(tenant_id) IN ('owner','auditor'))
);
CREATE POLICY agent_session_read_results_policy ON app.agent_session_read_results FOR SELECT TO commerce_app USING(
  tenant_id=app.tenant_id() AND (subject_id=app.actor_id() OR app.member_role(tenant_id) IN ('owner','auditor'))
);

CREATE OR REPLACE FUNCTION app.assert_agent_read_receipt(
  selected_tenant uuid,selected_request_id uuid,selected_scope text,selected_shop_ids uuid[]
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF selected_tenant IS NULL OR selected_request_id IS NULL
    OR selected_scope NOT IN ('catalog:read','sales:read','inventory:read')
    OR cardinality(selected_shop_ids) NOT BETWEEN 1 AND 20
    OR (SELECT count(DISTINCT shop_id) FROM unnest(selected_shop_ids) AS values_list(shop_id))<>cardinality(selected_shop_ids)
    OR NOT (
      EXISTS(
        SELECT 1 FROM app.agent_service_request_receipts r
        WHERE r.tenant_id=selected_tenant AND r.request_id=selected_request_id
          AND r.required_scope=selected_scope AND r.authenticated_at>clock_timestamp()-interval '5 minutes'
          AND r.shop_ids@>selected_shop_ids AND r.shop_ids<@selected_shop_ids
      ) OR EXISTS(
        SELECT 1 FROM app.agent_session_read_receipts r
        WHERE r.tenant_id=selected_tenant AND r.request_id=selected_request_id
          AND r.required_scope=selected_scope AND r.expires_at>clock_timestamp()
          AND r.shop_ids@>selected_shop_ids AND r.shop_ids<@selected_shop_ids
      )
    )
  THEN RAISE EXCEPTION 'AGENT_RECEIPT_FORBIDDEN'; END IF;
END $$;

CREATE FUNCTION app.authorize_agent_session_read_request(
  selected_tenant_id uuid,selected_grant_id uuid,selected_subject_id uuid,selected_claim_shop_ids uuid[],
  selected_role text,selected_environment text,selected_issued_at timestamptz,selected_expires_at timestamptz,
  selected_session_id text,selected_shop_ids uuid[],required_scope text,selected_request_id uuid,
  selected_request_timestamp timestamptz,selected_method text,selected_path text,selected_body_hash text
) RETURNS TABLE(
  tenant_id uuid,principal_id uuid,shop_ids uuid[],scopes text[],environment text,audience text,
  authenticated_at timestamptz,expires_at timestamptz,replayed boolean
) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  stored_grant app.agent_session_grants%ROWTYPE;
  stored_session app.agent_sessions%ROWTYPE;
  stored_policy app.agent_route_policies%ROWTYPE;
  existing_receipt app.agent_session_read_receipts%ROWTYPE;
  authentication_time timestamptz:=clock_timestamp();
  effective_expires_at timestamptz;
  inserted_count integer:=0;
  was_replayed boolean:=false;
BEGIN
  IF selected_tenant_id IS NULL OR selected_grant_id IS NULL OR selected_subject_id IS NULL
    OR selected_role NOT IN ('owner','finance','operator','marketing','auditor')
    OR selected_environment NOT IN ('development','staging') OR selected_session_id IS NULL
    OR required_scope NOT IN ('catalog:read','sales:read','inventory:read')
    OR selected_request_id IS NULL OR selected_request_timestamp IS NULL OR selected_method<>'POST'
    OR selected_path!~'^/api/agent/v1/(products|sales|inventory)/query$'
    OR selected_body_hash!~'^[0-9a-f]{64}$'
    OR cardinality(selected_claim_shop_ids) NOT BETWEEN 1 AND 20
    OR cardinality(selected_shop_ids) NOT BETWEEN 1 AND 20
    OR (SELECT count(DISTINCT shop_id) FROM unnest(selected_shop_ids) AS requested(shop_id))<>cardinality(selected_shop_ids)
    OR abs(extract(epoch FROM (authentication_time-selected_request_timestamp)))>300
  THEN RAISE EXCEPTION 'AGENT_SESSION_READ_INVALID'; END IF;
  IF EXISTS(SELECT 1 FROM unnest(selected_shop_ids) AS requested(shop_id) WHERE shop_id<>ALL(selected_claim_shop_ids))
  THEN RAISE EXCEPTION 'AGENT_SESSION_READ_SCOPE_FORBIDDEN'; END IF;

  SELECT * INTO stored_grant FROM app.agent_session_grants g
  WHERE g.tenant_id=selected_tenant_id AND g.grant_id=selected_grant_id FOR UPDATE;
  IF NOT FOUND OR stored_grant.subject_id<>selected_subject_id OR stored_grant.shop_ids<>selected_claim_shop_ids
    OR stored_grant.role<>selected_role OR stored_grant.environment<>selected_environment
    OR stored_grant.issued_at<>selected_issued_at OR stored_grant.expires_at<>selected_expires_at
    OR stored_grant.capability<>'continue' OR stored_grant.session_id<>selected_session_id
    OR stored_grant.status<>'consumed' OR stored_grant.expires_at<=authentication_time
  THEN RAISE EXCEPTION 'AGENT_SESSION_READ_UNAVAILABLE'; END IF;

  SELECT * INTO stored_session FROM app.agent_sessions s
  WHERE s.tenant_id=selected_tenant_id AND s.session_id=selected_session_id FOR UPDATE;
  IF NOT FOUND OR stored_session.status<>'active' OR stored_session.expires_at<=authentication_time
    OR stored_session.subject_id<>selected_subject_id OR stored_session.shop_ids<>selected_claim_shop_ids
    OR stored_session.environment<>selected_environment
    OR NOT app.agent_session_subject_authorized(selected_tenant_id,selected_subject_id,selected_claim_shop_ids,selected_role)
  THEN RAISE EXCEPTION 'AGENT_SESSION_READ_UNAVAILABLE'; END IF;

  SELECT * INTO stored_policy FROM app.agent_route_policies p
  WHERE p.tenant_id=selected_tenant_id FOR UPDATE;
  IF NOT FOUND OR stored_policy.status<>'active' OR stored_policy.environment<>selected_environment
    OR stored_policy.expires_at<=authentication_time OR stored_grant.policy_version IS DISTINCT FROM stored_policy.version
  THEN RAISE EXCEPTION 'AGENT_SESSION_READ_UNAVAILABLE'; END IF;

  effective_expires_at:=least(stored_grant.expires_at,stored_session.expires_at,stored_policy.expires_at);
  INSERT INTO app.agent_session_read_receipts(
    tenant_id,request_id,grant_id,session_id,subject_id,required_scope,shop_ids,environment,audience,
    method,path,body_hash,request_timestamp,authenticated_at,expires_at
  ) VALUES(
    selected_tenant_id,selected_request_id,selected_grant_id,selected_session_id,selected_subject_id,required_scope,
    selected_shop_ids,selected_environment,'commerce-agent-api',selected_method,selected_path,selected_body_hash,
    selected_request_timestamp,authentication_time,effective_expires_at
  ) ON CONFLICT ON CONSTRAINT agent_session_read_receipts_pkey DO NOTHING;
  GET DIAGNOSTICS inserted_count=ROW_COUNT;

  IF inserted_count=0 THEN
    SELECT * INTO existing_receipt FROM app.agent_session_read_receipts r
    WHERE r.tenant_id=selected_tenant_id AND r.request_id=selected_request_id;
    IF NOT FOUND OR existing_receipt.grant_id<>selected_grant_id OR existing_receipt.session_id<>selected_session_id
      OR existing_receipt.subject_id<>selected_subject_id OR existing_receipt.required_scope<>required_scope
      OR existing_receipt.shop_ids<>selected_shop_ids OR existing_receipt.environment<>selected_environment
      OR existing_receipt.method<>selected_method OR existing_receipt.path<>selected_path
      OR existing_receipt.body_hash<>selected_body_hash
    THEN RAISE EXCEPTION 'AGENT_SESSION_READ_REPLAYED'; END IF;
    was_replayed:=true;
  END IF;

  RETURN QUERY SELECT selected_tenant_id,selected_subject_id,selected_claim_shop_ids,ARRAY[required_scope]::text[],
    selected_environment,'commerce-agent-api'::text,authentication_time,effective_expires_at,was_replayed;
END $$;

CREATE FUNCTION app.read_agent_session_request_result(
  selected_tenant_id uuid,selected_request_id uuid,selected_subject_id uuid,selected_operation text,selected_body_hash text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE stored_payload jsonb;
BEGIN
  IF NOT EXISTS(
    SELECT 1 FROM app.agent_session_read_receipts r
    WHERE r.tenant_id=selected_tenant_id AND r.request_id=selected_request_id
      AND r.subject_id=selected_subject_id AND r.body_hash=selected_body_hash
      AND r.path=CASE selected_operation
        WHEN 'products.query' THEN '/api/agent/v1/products/query'
        WHEN 'sales.query' THEN '/api/agent/v1/sales/query'
        WHEN 'inventory.query' THEN '/api/agent/v1/inventory/query'
        ELSE '' END
  ) THEN RAISE EXCEPTION 'AGENT_RESULT_REQUEST_MISMATCH'; END IF;
  SELECT result.response_payload INTO stored_payload FROM app.agent_session_read_results result
  WHERE result.tenant_id=selected_tenant_id AND result.request_id=selected_request_id
    AND result.subject_id=selected_subject_id AND result.operation=selected_operation AND result.body_hash=selected_body_hash;
  RETURN stored_payload;
END $$;

CREATE FUNCTION app.store_agent_session_request_result(
  selected_tenant_id uuid,selected_request_id uuid,selected_subject_id uuid,selected_operation text,
  selected_body_hash text,selected_response_payload jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE stored_payload jsonb;
BEGIN
  IF selected_response_payload IS NULL OR jsonb_typeof(selected_response_payload)<>'object'
  THEN RAISE EXCEPTION 'AGENT_RESULT_INVALID'; END IF;
  PERFORM app.read_agent_session_request_result(selected_tenant_id,selected_request_id,selected_subject_id,selected_operation,selected_body_hash);
  INSERT INTO app.agent_session_read_results(tenant_id,request_id,subject_id,operation,body_hash,response_payload)
  VALUES(selected_tenant_id,selected_request_id,selected_subject_id,selected_operation,selected_body_hash,selected_response_payload)
  ON CONFLICT(tenant_id,request_id) DO NOTHING;
  SELECT result.response_payload INTO stored_payload FROM app.agent_session_read_results result
  WHERE result.tenant_id=selected_tenant_id AND result.request_id=selected_request_id
    AND result.subject_id=selected_subject_id AND result.operation=selected_operation AND result.body_hash=selected_body_hash;
  IF stored_payload IS NULL THEN RAISE EXCEPTION 'AGENT_RESULT_CONFLICT'; END IF;
  RETURN stored_payload;
END $$;

REVOKE ALL ON app.agent_session_read_receipts FROM PUBLIC;
REVOKE ALL ON app.agent_session_read_results FROM PUBLIC;
REVOKE ALL ON FUNCTION app.authorize_agent_session_read_request(uuid,uuid,uuid,uuid[],text,text,timestamptz,timestamptz,text,uuid[],text,uuid,timestamptz,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.read_agent_session_request_result(uuid,uuid,uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.store_agent_session_request_result(uuid,uuid,uuid,text,text,jsonb) FROM PUBLIC;
GRANT SELECT ON app.agent_session_read_receipts TO commerce_app;
GRANT SELECT ON app.agent_session_read_results TO commerce_app;
GRANT EXECUTE ON FUNCTION app.authorize_agent_session_read_request(uuid,uuid,uuid,uuid[],text,text,timestamptz,timestamptz,text,uuid[],text,uuid,timestamptz,text,text,text) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.read_agent_session_request_result(uuid,uuid,uuid,text,text) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.store_agent_session_request_result(uuid,uuid,uuid,text,text,jsonb) TO commerce_app;
