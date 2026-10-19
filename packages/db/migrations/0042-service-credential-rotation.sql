-- AUTH-AG-01b: environment/audience-bound credentials, overlap rotation and safe usage telemetry.
ALTER TABLE app.service_principals
  ADD COLUMN environment text NOT NULL DEFAULT 'development' CHECK(environment IN ('development','staging','production')),
  ADD COLUMN audience text NOT NULL DEFAULT 'integration-inbox' CHECK(audience~'^[a-z0-9][a-z0-9._-]{2,79}$');

ALTER TABLE private.service_principal_credentials
  ADD COLUMN retire_at timestamptz,
  ADD COLUMN rotated_from_id uuid,
  ADD COLUMN authorized_request_count bigint NOT NULL DEFAULT 0 CHECK(authorized_request_count>=0),
  ADD CONSTRAINT service_principal_credentials_rotated_from_fk
    FOREIGN KEY(tenant_id,rotated_from_id) REFERENCES private.service_principal_credentials(tenant_id,id),
  ADD CONSTRAINT service_principal_credentials_retire_window CHECK(retire_at IS NULL OR retire_at>created_at);

CREATE INDEX service_principal_credentials_principal_idx
  ON private.service_principal_credentials(tenant_id,principal_id,created_at DESC);

DROP FUNCTION app.create_service_principal(uuid,uuid,text,uuid[],text[],timestamptz,text,text);
CREATE FUNCTION app.create_service_principal(
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
    OR EXISTS(SELECT 1 FROM unnest(selected_scopes) AS values_list(scope) WHERE scope NOT IN ('integration:ingest','integration:read','outbox:publish'))
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

CREATE FUNCTION app.rotate_service_principal_credential(
  selected_id uuid,expected_version integer,selected_credential_id uuid,selected_expires_at timestamptz,
  overlap_minutes integer,selected_reason text,selected_credential_hash text,selected_credential_prefix text
) RETURNS TABLE(id uuid,version integer,retire_previous_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE principal app.service_principals%ROWTYPE;current_credential_id uuid;retire_time timestamptz;
BEGIN
  IF app.tenant_id() IS NULL OR app.actor_id() IS NULL OR app.member_role(app.tenant_id())<>'owner'
    OR expected_version<1 OR selected_credential_id IS NULL OR overlap_minutes NOT BETWEEN 5 AND 1440
    OR length(btrim(selected_reason)) NOT BETWEEN 3 AND 500 OR selected_credential_hash!~'^[0-9a-f]{64}$'
    OR length(selected_credential_prefix) NOT BETWEEN 8 AND 24
    OR selected_expires_at<=clock_timestamp()+make_interval(mins=>overlap_minutes)+interval '5 minutes'
    OR selected_expires_at>clock_timestamp()+interval '366 days'
  THEN RAISE EXCEPTION 'SERVICE_ROTATION_INVALID'; END IF;
  SELECT p.* INTO principal FROM app.service_principals p
    WHERE p.tenant_id=app.tenant_id() AND p.id=selected_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'SERVICE_PRINCIPAL_NOT_FOUND'; END IF;
  IF principal.version<>expected_version THEN RAISE EXCEPTION 'STALE_SERVICE_PRINCIPAL'; END IF;
  IF principal.status<>'active' OR principal.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'SERVICE_PRINCIPAL_REVOKED'; END IF;
  retire_time:=clock_timestamp()+make_interval(mins=>overlap_minutes);
  SELECT c.id INTO current_credential_id FROM private.service_principal_credentials c
    WHERE c.tenant_id=app.tenant_id() AND c.principal_id=selected_id AND c.revoked_at IS NULL
      AND c.expires_at>clock_timestamp() AND (c.retire_at IS NULL OR c.retire_at>clock_timestamp())
    ORDER BY c.created_at DESC LIMIT 1;
  IF current_credential_id IS NULL THEN RAISE EXCEPTION 'SERVICE_CREDENTIAL_INVALID'; END IF;
  UPDATE private.service_principal_credentials c SET retire_at=LEAST(coalesce(c.retire_at,retire_time),retire_time)
    WHERE c.tenant_id=app.tenant_id() AND c.principal_id=selected_id AND c.revoked_at IS NULL
      AND c.expires_at>clock_timestamp() AND (c.retire_at IS NULL OR c.retire_at>clock_timestamp());
  INSERT INTO private.service_principal_credentials(tenant_id,id,principal_id,secret_hash,secret_prefix,expires_at,rotated_from_id)
  VALUES(app.tenant_id(),selected_credential_id,selected_id,selected_credential_hash,selected_credential_prefix,selected_expires_at,current_credential_id);
  UPDATE app.service_principals p SET expires_at=selected_expires_at,credential_prefix=selected_credential_prefix,
    version=p.version+1,updated_at=clock_timestamp() WHERE p.tenant_id=app.tenant_id() AND p.id=selected_id;
  UPDATE app.service_principal_delegations d SET expires_at=selected_expires_at
    WHERE d.tenant_id=app.tenant_id() AND d.principal_id=selected_id AND d.revoked_at IS NULL;
  INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details)
  VALUES(app.tenant_id(),gen_random_uuid(),app.actor_id(),'service_principal.credential_rotated',selected_id,
    jsonb_build_object('reason',btrim(selected_reason),'previousCredentialPrefix',principal.credential_prefix,
      'credentialPrefix',selected_credential_prefix,'retirePreviousAt',retire_time,'expiresAt',selected_expires_at,'version',principal.version+1));
  RETURN QUERY SELECT principal.id,principal.version+1,retire_time;
END $$;

DROP FUNCTION app.ingest_scoped_integration_inbox_event(text,uuid,uuid,uuid,text,text,text,text,text,bigint,timestamptz,text,jsonb,jsonb,text,text,text);
DROP FUNCTION app.authorize_service_principal(text,uuid,uuid,text);

CREATE FUNCTION app.authorize_service_principal(
  credential_hash text,selected_tenant uuid,selected_shop uuid,required_scope text,selected_environment text,selected_audience text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE authorized_principal_id uuid;credential_tenant uuid;principal_environment text;principal_audience text;
BEGIN
  IF credential_hash!~'^[0-9a-f]{64}$' OR required_scope NOT IN ('integration:ingest','integration:read','outbox:publish')
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

CREATE FUNCTION app.ingest_scoped_integration_inbox_event(
  service_credential_hash text,selected_environment text,selected_audience text,selected_tenant uuid,selected_shop uuid,inbox_id uuid,
  selected_provider text,external_event_id text,selected_event_type text,selected_stream_type text,selected_stream_id text,
  selected_sequence bigint,event_occurred_at timestamptz,body_hash text,normalized_payload jsonb,safe_metadata jsonb,
  signature_result text,verification_method text,key_reference text DEFAULT NULL
) RETURNS TABLE(id uuid,duplicate boolean,reconciliation_status text,disposition text,version integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  PERFORM app.authorize_service_principal(service_credential_hash,selected_tenant,selected_shop,'integration:ingest',selected_environment,selected_audience);
  RETURN QUERY SELECT result.id,result.duplicate,result.reconciliation_status,result.disposition,result.version
  FROM app.ingest_integration_inbox_event(selected_tenant,selected_shop,inbox_id,selected_provider,external_event_id,selected_event_type,
    selected_stream_type,selected_stream_id,selected_sequence,event_occurred_at,body_hash,normalized_payload,safe_metadata,
    signature_result,verification_method,key_reference) result;
END $$;

CREATE FUNCTION app.service_principal_credential_summaries()
RETURNS TABLE(principal_id uuid,credential_id uuid,secret_prefix text,status text,created_at timestamptz,expires_at timestamptz,
  retire_at timestamptz,last_used_at timestamptz,authorized_request_count bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' STABLE AS $$
BEGIN
  IF app.tenant_id() IS NULL OR app.actor_id() IS NULL OR app.member_role(app.tenant_id()) NOT IN ('owner','auditor')
  THEN RAISE EXCEPTION 'SERVICE_PRINCIPAL_FORBIDDEN'; END IF;
  RETURN QUERY SELECT c.principal_id,c.id,c.secret_prefix,
    CASE WHEN c.revoked_at IS NOT NULL THEN 'revoked'
      WHEN c.expires_at<=clock_timestamp() THEN 'expired'
      WHEN c.retire_at IS NOT NULL AND c.retire_at<=clock_timestamp() THEN 'retired'
      WHEN c.retire_at IS NOT NULL THEN 'retiring' ELSE 'active' END,
    c.created_at,c.expires_at,c.retire_at,c.last_used_at,c.authorized_request_count
  FROM private.service_principal_credentials c JOIN app.service_principals p ON p.tenant_id=c.tenant_id AND p.id=c.principal_id
  WHERE c.tenant_id=app.tenant_id() AND EXISTS(
    SELECT 1 FROM app.service_principal_delegations d WHERE d.tenant_id=c.tenant_id AND d.principal_id=c.principal_id
      AND app.shop_allowed(d.tenant_id,d.shop_id)
  ) ORDER BY c.created_at DESC;
END $$;

REVOKE ALL ON FUNCTION app.create_service_principal(uuid,uuid,text,uuid[],text[],timestamptz,text,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.rotate_service_principal_credential(uuid,integer,uuid,timestamptz,integer,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.authorize_service_principal(text,uuid,uuid,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.ingest_scoped_integration_inbox_event(text,text,text,uuid,uuid,uuid,text,text,text,text,text,bigint,timestamptz,text,jsonb,jsonb,text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.service_principal_credential_summaries() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.create_service_principal(uuid,uuid,text,uuid[],text[],timestamptz,text,text,text,text) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.rotate_service_principal_credential(uuid,integer,uuid,timestamptz,integer,text,text,text) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.service_principal_credential_summaries() TO commerce_app;
GRANT EXECUTE ON FUNCTION app.ingest_scoped_integration_inbox_event(text,text,text,uuid,uuid,uuid,text,text,text,text,text,bigint,timestamptz,text,jsonb,jsonb,text,text,text) TO commerce_queue;
