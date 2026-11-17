-- EVE-POC-04: request-time authentication for read-only Commerce Agent APIs.
-- The raw credential and request signature never enter an application table.

ALTER TABLE app.service_principal_delegations
  DROP CONSTRAINT IF EXISTS service_principal_delegations_scopes_check;
ALTER TABLE app.service_principal_delegations
  ADD CONSTRAINT service_principal_delegations_scopes_check CHECK(
    cardinality(scopes) BETWEEN 1 AND 10
    AND scopes<@ARRAY[
      'integration:ingest','integration:read','outbox:publish',
      'catalog:read','sales:read','inventory:read'
    ]::text[]
  );

CREATE OR REPLACE FUNCTION app.create_service_principal(
  selected_id uuid,selected_credential_id uuid,selected_name text,selected_shop_ids uuid[],selected_scopes text[],selected_expires_at timestamptz,
  selected_environment text,selected_audience text,selected_credential_hash text,selected_credential_prefix text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE selected_shop uuid;
BEGIN
  IF app.tenant_id() IS NULL OR app.actor_id() IS NULL OR app.member_role(app.tenant_id())<>'owner'
    OR selected_id IS NULL OR selected_credential_id IS NULL OR length(btrim(selected_name)) NOT BETWEEN 3 AND 100
    OR selected_expires_at<=clock_timestamp()+interval '5 minutes' OR selected_expires_at>clock_timestamp()+interval '366 days'
    OR selected_environment NOT IN ('development','staging','production') OR selected_audience!~'^[a-z0-9][a-z0-9._-]{2,79}$'
    OR cardinality(selected_shop_ids) NOT BETWEEN 1 AND 50 OR cardinality(selected_scopes) NOT BETWEEN 1 AND 10
    OR selected_credential_hash!~'^[0-9a-f]{64}$' OR length(selected_credential_prefix) NOT BETWEEN 8 AND 24
    OR EXISTS(SELECT 1 FROM unnest(selected_scopes) AS values_list(scope) WHERE scope NOT IN (
      'integration:ingest','integration:read','outbox:publish','catalog:read','sales:read','inventory:read'))
    OR (SELECT count(DISTINCT scope) FROM unnest(selected_scopes) AS values_list(scope))<>cardinality(selected_scopes)
    OR (SELECT count(DISTINCT shop_id) FROM unnest(selected_shop_ids) AS values_list(shop_id))<>cardinality(selected_shop_ids)
    OR EXISTS(SELECT 1 FROM unnest(selected_shop_ids) AS values_list(shop_id) WHERE NOT app.shop_allowed(app.tenant_id(),shop_id))
  THEN RAISE EXCEPTION 'SERVICE_PRINCIPAL_INVALID'; END IF;
  INSERT INTO app.service_principals(tenant_id,id,name,expires_at,credential_prefix,created_by,environment,audience)
  VALUES(app.tenant_id(),selected_id,btrim(selected_name),selected_expires_at,selected_credential_prefix,app.actor_id(),selected_environment,selected_audience);
  FOREACH selected_shop IN ARRAY selected_shop_ids LOOP
    INSERT INTO app.service_principal_delegations(tenant_id,id,principal_id,shop_id,scopes,expires_at)
    VALUES(app.tenant_id(),gen_random_uuid(),selected_id,selected_shop,selected_scopes,selected_expires_at);
  END LOOP;
  INSERT INTO private.service_principal_credentials(tenant_id,id,principal_id,secret_hash,secret_prefix,expires_at)
  VALUES(app.tenant_id(),selected_credential_id,selected_id,selected_credential_hash,selected_credential_prefix,selected_expires_at);
  INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details)
  VALUES(app.tenant_id(),gen_random_uuid(),app.actor_id(),'service_principal.created',selected_id,
    jsonb_build_object('name',btrim(selected_name),'shopIds',selected_shop_ids,'scopes',selected_scopes,'expiresAt',selected_expires_at,
      'environment',selected_environment,'audience',selected_audience,'credentialPrefix',selected_credential_prefix));
  RETURN selected_id;
END $$;

CREATE OR REPLACE FUNCTION app.authorize_service_principal(
  credential_hash text,selected_tenant uuid,selected_shop uuid,required_scope text,selected_environment text,selected_audience text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE authorized_principal_id uuid;credential_tenant uuid;principal_environment text;principal_audience text;
BEGIN
  IF credential_hash!~'^[0-9a-f]{64}$' OR required_scope NOT IN (
      'integration:ingest','integration:read','outbox:publish','catalog:read','sales:read','inventory:read')
    OR selected_environment NOT IN ('development','staging','production') OR selected_audience!~'^[a-z0-9][a-z0-9._-]{2,79}$'
  THEN RAISE EXCEPTION 'SERVICE_CREDENTIAL_INVALID'; END IF;
  SELECT p.id,p.tenant_id,p.environment,p.audience
    INTO authorized_principal_id,credential_tenant,principal_environment,principal_audience
  FROM private.service_principal_credentials c JOIN app.service_principals p ON p.tenant_id=c.tenant_id AND p.id=c.principal_id
  WHERE c.secret_hash=credential_hash AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp()
    AND (c.retire_at IS NULL OR c.retire_at>clock_timestamp())
    AND p.status='active' AND p.revoked_at IS NULL AND p.expires_at>clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'SERVICE_CREDENTIAL_INVALID'; END IF;
  IF principal_environment<>selected_environment OR principal_audience<>selected_audience
  THEN RAISE EXCEPTION 'SERVICE_AUDIENCE_FORBIDDEN'; END IF;
  IF credential_tenant<>selected_tenant OR NOT EXISTS(
    SELECT 1 FROM app.service_principal_delegations d WHERE d.tenant_id=selected_tenant AND d.principal_id=authorized_principal_id
      AND d.shop_id=selected_shop AND d.revoked_at IS NULL AND d.expires_at>clock_timestamp() AND required_scope=ANY(d.scopes)
  ) THEN RAISE EXCEPTION 'SERVICE_SCOPE_FORBIDDEN'; END IF;
  UPDATE private.service_principal_credentials c
    SET last_used_at=clock_timestamp(),authorized_request_count=c.authorized_request_count+1
    WHERE c.secret_hash=credential_hash;
  RETURN authorized_principal_id;
END $$;

CREATE TABLE app.agent_service_request_receipts (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  request_id uuid NOT NULL,
  principal_id uuid NOT NULL,
  credential_id uuid NOT NULL,
  required_scope text NOT NULL CHECK(required_scope IN ('catalog:read','sales:read','inventory:read')),
  shop_ids uuid[] NOT NULL CHECK(cardinality(shop_ids) BETWEEN 1 AND 20),
  environment text NOT NULL CHECK(environment IN ('development','staging','production')),
  audience text NOT NULL CHECK(audience='commerce-agent-api'),
  method text NOT NULL CHECK(method='POST'),
  path text NOT NULL CHECK(path~'^/api/agent/v1/(products|sales|inventory)/query$'),
  body_hash text NOT NULL CHECK(body_hash~'^[0-9a-f]{64}$'),
  request_hash text NOT NULL CHECK(request_hash~'^[0-9a-f]{64}$'),
  request_timestamp timestamptz NOT NULL,
  authenticated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,request_id),
  FOREIGN KEY(tenant_id,principal_id) REFERENCES app.service_principals(tenant_id,id),
  FOREIGN KEY(tenant_id,credential_id) REFERENCES private.service_principal_credentials(tenant_id,id)
);
CREATE INDEX agent_service_request_receipts_principal_idx
  ON app.agent_service_request_receipts(tenant_id,principal_id,authenticated_at DESC);

ALTER TABLE app.agent_service_request_receipts ENABLE ROW LEVEL SECURITY;
-- The migration owner must bypass policies inside SECURITY DEFINER functions;
-- commerce_app does not own the table and remains subject to RLS.
ALTER TABLE app.agent_service_request_receipts NO FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_service_request_receipts_read ON app.agent_service_request_receipts FOR SELECT TO commerce_app USING(
  tenant_id=app.tenant_id() AND app.member_role(tenant_id) IN ('owner','auditor')
  AND EXISTS(
    SELECT 1 FROM app.service_principal_delegations d
    WHERE d.tenant_id=agent_service_request_receipts.tenant_id
      AND d.principal_id=agent_service_request_receipts.principal_id
      AND d.shop_id=ANY(agent_service_request_receipts.shop_ids)
      AND app.shop_allowed(d.tenant_id,d.shop_id)
  )
);

CREATE FUNCTION app.authorize_agent_service_request(
  credential_hash text,selected_shop_ids uuid[],required_scope text,selected_environment text,selected_audience text,
  selected_request_id uuid,selected_request_timestamp timestamptz,selected_method text,selected_path text,
  selected_body_hash text,selected_request_hash text
) RETURNS TABLE(
  tenant_id uuid,principal_id uuid,shop_ids uuid[],scopes text[],environment text,audience text,
  authenticated_at timestamptz,expires_at timestamptz
) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  selected_credential private.service_principal_credentials%ROWTYPE;
  selected_principal app.service_principals%ROWTYPE;
  effective_expires_at timestamptz;
  authentication_time timestamptz:=clock_timestamp();
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

  BEGIN
    INSERT INTO app.agent_service_request_receipts(
      tenant_id,request_id,principal_id,credential_id,required_scope,shop_ids,environment,audience,
      method,path,body_hash,request_hash,request_timestamp,authenticated_at
    ) VALUES(
      selected_principal.tenant_id,selected_request_id,selected_principal.id,selected_credential.id,required_scope,
      selected_shop_ids,selected_environment,selected_audience,selected_method,selected_path,
      selected_body_hash,selected_request_hash,selected_request_timestamp,authentication_time
    );
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'AGENT_REQUEST_REPLAYED'; END;

  UPDATE private.service_principal_credentials c
    SET last_used_at=authentication_time,authorized_request_count=c.authorized_request_count+1
    WHERE c.tenant_id=selected_credential.tenant_id AND c.id=selected_credential.id;

  RETURN QUERY SELECT selected_principal.tenant_id,selected_principal.id,selected_shop_ids,ARRAY[required_scope]::text[],
    selected_principal.environment,selected_principal.audience,authentication_time,effective_expires_at;
END $$;

REVOKE ALL ON FUNCTION app.authorize_agent_service_request(text,uuid[],text,text,text,uuid,timestamptz,text,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.authorize_agent_service_request(text,uuid[],text,text,text,uuid,timestamptz,text,text,text,text) TO commerce_app;
GRANT SELECT ON app.agent_service_request_receipts TO commerce_app;
