-- EVE-CANARY-06: one-time Commerce session grants and active-grant revocation.
-- Grant registration is bound to the signed claims at issuance. Consumption is
-- an atomic active -> consumed transition, so concurrent/replayed requests fail.

CREATE TABLE app.agent_session_grants (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  grant_id uuid NOT NULL,
  subject_id uuid NOT NULL REFERENCES private.users(id),
  shop_ids uuid[] NOT NULL CHECK(cardinality(shop_ids) BETWEEN 1 AND 20),
  role text NOT NULL CHECK(role IN ('owner','finance','operator','marketing','auditor')),
  environment text NOT NULL CHECK(environment IN ('development','staging')),
  key_id text NOT NULL CHECK(key_id~'^[A-Za-z0-9._-]{1,80}$'),
  policy_version integer CHECK(policy_version IS NULL OR policy_version>0),
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','consumed','revoked')),
  consumed_at timestamptz,
  revoked_by uuid REFERENCES private.users(id),
  revoked_at timestamptz,
  revocation_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,grant_id),
  CONSTRAINT agent_session_grant_lifetime_check CHECK(
    expires_at>=issued_at+interval '30 seconds' AND expires_at<=issued_at+interval '5 minutes'
  ),
  CONSTRAINT agent_session_grant_state_check CHECK(
    (status='active' AND consumed_at IS NULL AND revoked_by IS NULL AND revoked_at IS NULL AND revocation_reason IS NULL)
    OR (status='consumed' AND consumed_at IS NOT NULL AND revoked_by IS NULL AND revoked_at IS NULL AND revocation_reason IS NULL)
    OR (status='revoked' AND consumed_at IS NULL AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL
      AND length(revocation_reason) BETWEEN 10 AND 500)
  )
);
CREATE INDEX agent_session_grants_active_idx
  ON app.agent_session_grants(tenant_id,expires_at) WHERE status='active';

ALTER TABLE app.agent_session_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.agent_session_grants NO FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_session_grants_read ON app.agent_session_grants FOR SELECT TO commerce_app USING(
  tenant_id=app.tenant_id() AND app.member_role(tenant_id) IN ('owner','auditor')
);

CREATE FUNCTION app.register_agent_session_grant(
  selected_grant_id uuid,selected_subject_id uuid,selected_shop_ids uuid[],selected_role text,
  selected_environment text,selected_key_id text,selected_issued_at timestamptz,
  selected_expires_at timestamptz,selected_policy_version integer
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=app.tenant_id();actor uuid:=app.actor_id();
BEGIN
  IF t IS NULL OR actor IS NULL OR selected_grant_id IS NULL OR selected_subject_id<>actor
    OR selected_role<>app.member_role(t) OR selected_environment NOT IN ('development','staging')
    OR selected_key_id!~'^[A-Za-z0-9._-]{1,80}$'
    OR cardinality(selected_shop_ids) NOT BETWEEN 1 AND 20
    OR (SELECT count(DISTINCT shop_id) FROM unnest(selected_shop_ids) AS values_list(shop_id))<>cardinality(selected_shop_ids)
    OR EXISTS(SELECT 1 FROM unnest(selected_shop_ids) AS values_list(shop_id) WHERE NOT app.shop_allowed(t,shop_id))
    OR selected_expires_at<selected_issued_at+interval '30 seconds'
    OR selected_expires_at>selected_issued_at+interval '5 minutes'
    OR (selected_policy_version IS NOT NULL AND selected_policy_version<1)
  THEN RAISE EXCEPTION 'AGENT_SESSION_GRANT_INVALID'; END IF;
  INSERT INTO app.agent_session_grants(
    tenant_id,grant_id,subject_id,shop_ids,role,environment,key_id,policy_version,issued_at,expires_at
  ) VALUES(
    t,selected_grant_id,selected_subject_id,selected_shop_ids,selected_role,selected_environment,
    selected_key_id,selected_policy_version,selected_issued_at,selected_expires_at
  );
END $$;

CREATE FUNCTION app.consume_agent_session_grant(
  selected_tenant_id uuid,selected_grant_id uuid,selected_subject_id uuid,selected_shop_ids uuid[],
  selected_role text,selected_environment text,selected_issued_at timestamptz,selected_expires_at timestamptz
) RETURNS TABLE(grant_id uuid,consumed_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF selected_tenant_id IS NULL OR selected_grant_id IS NULL OR selected_subject_id IS NULL
    OR selected_role NOT IN ('owner','finance','operator','marketing','auditor')
    OR selected_environment NOT IN ('development','staging')
    OR cardinality(selected_shop_ids) NOT BETWEEN 1 AND 20
  THEN RAISE EXCEPTION 'AGENT_SESSION_GRANT_UNAVAILABLE'; END IF;

  RETURN QUERY UPDATE app.agent_session_grants g SET status='consumed',consumed_at=clock_timestamp()
  WHERE g.tenant_id=selected_tenant_id AND g.grant_id=selected_grant_id
    AND g.subject_id=selected_subject_id AND g.shop_ids=selected_shop_ids
    AND g.role=selected_role AND g.environment=selected_environment
    AND g.issued_at=selected_issued_at AND g.expires_at=selected_expires_at
    AND g.status='active' AND g.expires_at>clock_timestamp()
  RETURNING g.grant_id,g.consumed_at;
  IF NOT FOUND THEN RAISE EXCEPTION 'AGENT_SESSION_GRANT_UNAVAILABLE'; END IF;

  INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details)
  VALUES(selected_tenant_id,gen_random_uuid(),selected_subject_id,'agent.session_grant.consumed',selected_grant_id,
    jsonb_build_object('environment',selected_environment,'shopIds',selected_shop_ids));
END $$;

CREATE FUNCTION app.revoke_agent_session_grant(selected_grant_id uuid,selected_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=app.tenant_id();actor uuid:=app.actor_id();actor_role text:=app.member_role(app.tenant_id());
BEGIN
  IF t IS NULL OR actor IS NULL OR actor_role NOT IN ('owner','auditor')
    OR selected_grant_id IS NULL OR length(btrim(selected_reason)) NOT BETWEEN 10 AND 500
  THEN RAISE EXCEPTION 'AGENT_SESSION_GRANT_REVOKE_FORBIDDEN'; END IF;
  UPDATE app.agent_session_grants SET status='revoked',revoked_by=actor,revoked_at=clock_timestamp(),revocation_reason=btrim(selected_reason)
  WHERE tenant_id=t AND grant_id=selected_grant_id AND status='active' AND expires_at>clock_timestamp();
  IF NOT FOUND THEN RAISE EXCEPTION 'AGENT_SESSION_GRANT_UNAVAILABLE'; END IF;
  INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details)
  VALUES(t,gen_random_uuid(),actor,'agent.session_grant.revoked',selected_grant_id,
    jsonb_build_object('reason',btrim(selected_reason),'actorRole',actor_role));
END $$;

CREATE FUNCTION app.revoke_active_agent_session_grants(selected_reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=app.tenant_id();actor uuid:=app.actor_id();actor_role text:=app.member_role(app.tenant_id());revoked_count integer;
BEGIN
  IF t IS NULL OR actor IS NULL OR actor_role NOT IN ('owner','auditor')
    OR length(btrim(selected_reason)) NOT BETWEEN 10 AND 500
  THEN RAISE EXCEPTION 'AGENT_SESSION_GRANT_REVOKE_FORBIDDEN'; END IF;
  WITH revoked AS (
    UPDATE app.agent_session_grants SET status='revoked',revoked_by=actor,revoked_at=clock_timestamp(),revocation_reason=btrim(selected_reason)
    WHERE tenant_id=t AND status='active' AND expires_at>clock_timestamp()
    RETURNING grant_id
  ), audited AS (
    INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details)
    SELECT t,gen_random_uuid(),actor,'agent.session_grant.revoked',grant_id,
      jsonb_build_object('reason',btrim(selected_reason),'actorRole',actor_role,'scope','all-active') FROM revoked
    RETURNING 1
  ) SELECT count(*)::integer INTO revoked_count FROM audited;
  RETURN revoked_count;
END $$;

REVOKE ALL ON app.agent_session_grants FROM PUBLIC;
REVOKE ALL ON FUNCTION app.register_agent_session_grant(uuid,uuid,uuid[],text,text,text,timestamptz,timestamptz,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.consume_agent_session_grant(uuid,uuid,uuid,uuid[],text,text,timestamptz,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.revoke_agent_session_grant(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.revoke_active_agent_session_grants(text) FROM PUBLIC;
GRANT SELECT ON app.agent_session_grants TO commerce_app;
GRANT EXECUTE ON FUNCTION app.register_agent_session_grant(uuid,uuid,uuid[],text,text,text,timestamptz,timestamptz,integer) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.consume_agent_session_grant(uuid,uuid,uuid,uuid[],text,text,timestamptz,timestamptz) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.revoke_agent_session_grant(uuid,text) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.revoke_active_agent_session_grants(text) TO commerce_app;
