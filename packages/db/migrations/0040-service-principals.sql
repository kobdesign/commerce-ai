-- AUTH-AG-01a: tenant-owned service identities with revocable shop delegations.
CREATE TABLE app.service_principals (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  id uuid NOT NULL,
  name text NOT NULL CHECK(length(name) BETWEEN 3 AND 100),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  expires_at timestamptz NOT NULL,
  credential_prefix text NOT NULL CHECK(length(credential_prefix) BETWEEN 8 AND 24),
  created_by uuid NOT NULL REFERENCES private.users(id),
  revoked_by uuid REFERENCES private.users(id),
  revoked_at timestamptz,
  revoke_reason text CHECK(revoke_reason IS NULL OR length(revoke_reason) BETWEEN 3 AND 500),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id),
  CONSTRAINT service_principal_state CHECK(
    (status='active' AND revoked_by IS NULL AND revoked_at IS NULL AND revoke_reason IS NULL)
    OR (status='revoked' AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND revoke_reason IS NOT NULL)
  )
);

CREATE TABLE app.service_principal_delegations (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  principal_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  scopes text[] NOT NULL CHECK(cardinality(scopes) BETWEEN 1 AND 10 AND scopes<@ARRAY['integration:ingest','integration:read','outbox:publish']::text[]),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,principal_id,shop_id),
  FOREIGN KEY(tenant_id,principal_id) REFERENCES app.service_principals(tenant_id,id),
  FOREIGN KEY(tenant_id,shop_id) REFERENCES app.shops(tenant_id,id)
);
CREATE INDEX service_principal_delegations_lookup_idx ON app.service_principal_delegations(tenant_id,principal_id,shop_id,expires_at) WHERE revoked_at IS NULL;

CREATE TABLE private.service_principal_credentials (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  principal_id uuid NOT NULL,
  secret_hash text NOT NULL UNIQUE CHECK(secret_hash~'^[0-9a-f]{64}$'),
  secret_prefix text NOT NULL CHECK(length(secret_prefix) BETWEEN 8 AND 24),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,principal_id) REFERENCES app.service_principals(tenant_id,id)
);
CREATE INDEX service_principal_credentials_lookup_idx ON private.service_principal_credentials(secret_hash) WHERE revoked_at IS NULL;

ALTER TABLE app.service_principals ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.service_principals FORCE ROW LEVEL SECURITY;
ALTER TABLE app.service_principal_delegations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.service_principal_delegations FORCE ROW LEVEL SECURITY;
CREATE POLICY service_principals_read ON app.service_principals FOR SELECT TO commerce_app USING(
  tenant_id=app.tenant_id() AND app.member_role(tenant_id) IN ('owner','auditor') AND EXISTS(
    SELECT 1 FROM app.service_principal_delegations d WHERE d.tenant_id=service_principals.tenant_id
      AND d.principal_id=service_principals.id AND app.shop_allowed(d.tenant_id,d.shop_id)
  )
);
CREATE POLICY service_principal_delegations_read ON app.service_principal_delegations FOR SELECT TO commerce_app USING(
  tenant_id=app.tenant_id() AND app.member_role(tenant_id) IN ('owner','auditor') AND app.shop_allowed(tenant_id,shop_id)
);

CREATE FUNCTION app.create_service_principal(
  selected_id uuid,selected_credential_id uuid,selected_name text,selected_shop_ids uuid[],selected_scopes text[],selected_expires_at timestamptz,
  credential_hash text,credential_prefix text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE selected_shop uuid;
BEGIN
  IF app.tenant_id() IS NULL OR app.actor_id() IS NULL OR app.member_role(app.tenant_id())<>'owner'
    OR selected_id IS NULL OR selected_credential_id IS NULL OR length(btrim(selected_name)) NOT BETWEEN 3 AND 100
    OR selected_expires_at<=clock_timestamp()+interval '5 minutes' OR selected_expires_at>clock_timestamp()+interval '366 days'
    OR cardinality(selected_shop_ids) NOT BETWEEN 1 AND 50 OR cardinality(selected_scopes) NOT BETWEEN 1 AND 10
    OR credential_hash!~'^[0-9a-f]{64}$' OR length(credential_prefix) NOT BETWEEN 8 AND 24
    OR EXISTS(SELECT 1 FROM unnest(selected_scopes) AS values_list(scope) WHERE scope NOT IN ('integration:ingest','integration:read','outbox:publish'))
    OR (SELECT count(DISTINCT scope) FROM unnest(selected_scopes) AS values_list(scope))<>cardinality(selected_scopes)
    OR (SELECT count(DISTINCT shop_id) FROM unnest(selected_shop_ids) AS values_list(shop_id))<>cardinality(selected_shop_ids)
    OR EXISTS(SELECT 1 FROM unnest(selected_shop_ids) AS values_list(shop_id) WHERE NOT app.shop_allowed(app.tenant_id(),shop_id))
  THEN RAISE EXCEPTION 'SERVICE_PRINCIPAL_INVALID'; END IF;
  INSERT INTO app.service_principals(tenant_id,id,name,expires_at,credential_prefix,created_by)
  VALUES(app.tenant_id(),selected_id,btrim(selected_name),selected_expires_at,credential_prefix,app.actor_id());
  FOREACH selected_shop IN ARRAY selected_shop_ids LOOP
    INSERT INTO app.service_principal_delegations(tenant_id,id,principal_id,shop_id,scopes,expires_at)
    VALUES(app.tenant_id(),gen_random_uuid(),selected_id,selected_shop,selected_scopes,selected_expires_at);
  END LOOP;
  INSERT INTO private.service_principal_credentials(tenant_id,id,principal_id,secret_hash,secret_prefix,expires_at)
  VALUES(app.tenant_id(),selected_credential_id,selected_id,credential_hash,credential_prefix,selected_expires_at);
  INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details)
  VALUES(app.tenant_id(),gen_random_uuid(),app.actor_id(),'service_principal.created',selected_id,
    jsonb_build_object('name',btrim(selected_name),'shopIds',selected_shop_ids,'scopes',selected_scopes,'expiresAt',selected_expires_at,'credentialPrefix',credential_prefix));
  RETURN selected_id;
END $$;

CREATE FUNCTION app.revoke_service_principal(selected_id uuid,expected_version integer,selected_reason text)
RETURNS TABLE(id uuid,status text,version integer) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE principal app.service_principals%ROWTYPE;
BEGIN
  IF app.tenant_id() IS NULL OR app.actor_id() IS NULL OR app.member_role(app.tenant_id())<>'owner'
    OR expected_version<1 OR length(btrim(selected_reason)) NOT BETWEEN 3 AND 500
  THEN RAISE EXCEPTION 'SERVICE_PRINCIPAL_FORBIDDEN'; END IF;
  SELECT p.* INTO principal FROM app.service_principals p WHERE p.tenant_id=app.tenant_id() AND p.id=selected_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SERVICE_PRINCIPAL_NOT_FOUND'; END IF;
  IF principal.version<>expected_version THEN RAISE EXCEPTION 'STALE_SERVICE_PRINCIPAL'; END IF;
  IF principal.status='revoked' THEN RAISE EXCEPTION 'SERVICE_PRINCIPAL_REVOKED'; END IF;
  UPDATE app.service_principals p SET status='revoked',revoked_by=app.actor_id(),revoked_at=clock_timestamp(),revoke_reason=btrim(selected_reason),
    version=p.version+1,updated_at=clock_timestamp() WHERE p.tenant_id=app.tenant_id() AND p.id=selected_id;
  UPDATE app.service_principal_delegations d SET revoked_at=clock_timestamp()
    WHERE d.tenant_id=app.tenant_id() AND d.principal_id=selected_id AND d.revoked_at IS NULL;
  UPDATE private.service_principal_credentials c SET revoked_at=clock_timestamp()
    WHERE c.tenant_id=app.tenant_id() AND c.principal_id=selected_id AND c.revoked_at IS NULL;
  INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details)
  VALUES(app.tenant_id(),gen_random_uuid(),app.actor_id(),'service_principal.revoked',selected_id,
    jsonb_build_object('reason',btrim(selected_reason),'version',principal.version+1));
  RETURN QUERY SELECT principal.id,'revoked'::text,principal.version+1;
END $$;

CREATE FUNCTION app.authorize_service_principal(credential_hash text,selected_tenant uuid,selected_shop uuid,required_scope text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE principal_id uuid;credential_tenant uuid;
BEGIN
  IF credential_hash!~'^[0-9a-f]{64}$' OR required_scope NOT IN ('integration:ingest','integration:read','outbox:publish')
  THEN RAISE EXCEPTION 'SERVICE_CREDENTIAL_INVALID'; END IF;
  SELECT p.id,p.tenant_id INTO principal_id,credential_tenant
  FROM private.service_principal_credentials c JOIN app.service_principals p ON p.tenant_id=c.tenant_id AND p.id=c.principal_id
  WHERE c.secret_hash=credential_hash AND c.revoked_at IS NULL AND c.expires_at>clock_timestamp()
    AND p.status='active' AND p.revoked_at IS NULL AND p.expires_at>clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'SERVICE_CREDENTIAL_INVALID'; END IF;
  IF credential_tenant<>selected_tenant OR NOT EXISTS(
    SELECT 1 FROM app.service_principal_delegations d WHERE d.tenant_id=selected_tenant AND d.principal_id=principal_id
      AND d.shop_id=selected_shop AND d.revoked_at IS NULL AND d.expires_at>clock_timestamp() AND required_scope=ANY(d.scopes)
  ) THEN RAISE EXCEPTION 'SERVICE_SCOPE_FORBIDDEN'; END IF;
  UPDATE private.service_principal_credentials c SET last_used_at=clock_timestamp()
  WHERE c.secret_hash=credential_hash AND (c.last_used_at IS NULL OR c.last_used_at<clock_timestamp()-interval '5 minutes');
  RETURN principal_id;
END $$;

CREATE FUNCTION app.ingest_scoped_integration_inbox_event(
  service_credential_hash text,selected_tenant uuid,selected_shop uuid,inbox_id uuid,selected_provider text,external_event_id text,
  selected_event_type text,selected_stream_type text,selected_stream_id text,selected_sequence bigint,event_occurred_at timestamptz,
  body_hash text,normalized_payload jsonb,safe_metadata jsonb,signature_result text,verification_method text,key_reference text DEFAULT NULL
) RETURNS TABLE(id uuid,duplicate boolean,reconciliation_status text,disposition text,version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM app.authorize_service_principal(service_credential_hash,selected_tenant,selected_shop,'integration:ingest');
  RETURN QUERY SELECT result.id,result.duplicate,result.reconciliation_status,result.disposition,result.version
  FROM app.ingest_integration_inbox_event(selected_tenant,selected_shop,inbox_id,selected_provider,external_event_id,selected_event_type,
    selected_stream_type,selected_stream_id,selected_sequence,event_occurred_at,body_hash,normalized_payload,safe_metadata,
    signature_result,verification_method,key_reference) result;
END $$;

REVOKE ALL ON app.service_principals,app.service_principal_delegations FROM PUBLIC;
REVOKE ALL ON private.service_principal_credentials FROM PUBLIC;
REVOKE ALL ON FUNCTION app.create_service_principal(uuid,uuid,text,uuid[],text[],timestamptz,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.revoke_service_principal(uuid,integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.authorize_service_principal(text,uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.ingest_scoped_integration_inbox_event(text,uuid,uuid,uuid,text,text,text,text,text,bigint,timestamptz,text,jsonb,jsonb,text,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION app.ingest_integration_inbox_event(uuid,uuid,uuid,text,text,text,text,text,bigint,timestamptz,text,jsonb,jsonb,text,text,text) FROM commerce_queue;
GRANT SELECT ON app.service_principals,app.service_principal_delegations TO commerce_app;
GRANT EXECUTE ON FUNCTION app.create_service_principal(uuid,uuid,text,uuid[],text[],timestamptz,text,text) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.revoke_service_principal(uuid,integer,text) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.ingest_scoped_integration_inbox_event(text,uuid,uuid,uuid,text,text,text,text,text,bigint,timestamptz,text,jsonb,jsonb,text,text,text) TO commerce_queue;
