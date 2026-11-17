-- EVE-CANARY-08: Core-owned Eve session registry and per-request continuation grants.
-- Session history stays in Eve. Commerce Core owns who may address a session.

ALTER TABLE app.agent_session_grants
  ADD COLUMN capability text NOT NULL DEFAULT 'create',
  ADD COLUMN session_id text;
ALTER TABLE app.agent_session_grants
  ADD CONSTRAINT agent_session_grant_capability_check CHECK(
    (capability='create' AND session_id IS NULL)
    OR (capability='continue' AND session_id~'^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$')
  );
CREATE INDEX agent_session_grants_session_idx
  ON app.agent_session_grants(tenant_id,session_id) WHERE session_id IS NOT NULL;

CREATE TABLE app.agent_sessions (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  session_id text NOT NULL CHECK(session_id~'^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'),
  initial_grant_id uuid NOT NULL,
  subject_id uuid NOT NULL REFERENCES private.users(id),
  shop_ids uuid[] NOT NULL CHECK(cardinality(shop_ids) BETWEEN 1 AND 20),
  role_at_creation text NOT NULL CHECK(role_at_creation IN ('owner','finance','operator','marketing','auditor')),
  environment text NOT NULL CHECK(environment IN ('development','staging')),
  policy_version integer CHECK(policy_version IS NULL OR policy_version>0),
  status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked','ended')),
  bound_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  last_authorized_at timestamptz,
  authorization_count integer NOT NULL DEFAULT 0 CHECK(authorization_count>=0),
  revoked_by uuid REFERENCES private.users(id),
  revoked_at timestamptz,
  revocation_reason text,
  PRIMARY KEY(tenant_id,session_id),
  UNIQUE(initial_grant_id),
  FOREIGN KEY(tenant_id,initial_grant_id) REFERENCES app.agent_session_grants(tenant_id,grant_id),
  CONSTRAINT agent_session_state_check CHECK(
    (status='active' AND revoked_by IS NULL AND revoked_at IS NULL AND revocation_reason IS NULL)
    OR (status='revoked' AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND length(revocation_reason) BETWEEN 10 AND 500)
    OR (status='ended' AND revoked_by IS NULL AND revoked_at IS NOT NULL AND length(revocation_reason) BETWEEN 10 AND 500)
  )
);
CREATE UNIQUE INDEX agent_sessions_global_id_idx ON app.agent_sessions(session_id);
CREATE INDEX agent_sessions_subject_idx ON app.agent_sessions(tenant_id,subject_id,bound_at DESC);
CREATE INDEX agent_sessions_active_expiry_idx ON app.agent_sessions(expires_at) WHERE status='active';

ALTER TABLE app.agent_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.agent_sessions NO FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_sessions_read ON app.agent_sessions FOR SELECT TO commerce_app USING(
  tenant_id=app.tenant_id()
  AND (subject_id=app.actor_id() OR app.member_role(tenant_id) IN ('owner','auditor'))
);

CREATE FUNCTION app.agent_session_subject_authorized(
  selected_tenant_id uuid,selected_subject_id uuid,selected_shop_ids uuid[],selected_role text
) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(
    SELECT 1 FROM app.memberships m JOIN private.users u ON u.id=m.user_id
    WHERE m.tenant_id=selected_tenant_id AND m.user_id=selected_subject_id
      AND m.active AND u.active AND m.role=selected_role
      AND NOT EXISTS(
        SELECT 1 FROM unnest(selected_shop_ids) AS selected(shop_id)
        WHERE NOT EXISTS(
          SELECT 1 FROM app.shops s
          WHERE s.tenant_id=selected_tenant_id AND s.id=selected.shop_id
            AND (m.all_shops OR EXISTS(
              SELECT 1 FROM app.shop_grants g
              WHERE g.tenant_id=m.tenant_id AND g.user_id=m.user_id AND g.shop_id=s.id
            ))
        )
      )
  )
$$;

CREATE FUNCTION app.register_agent_session_grant_v2(
  selected_grant_id uuid,selected_subject_id uuid,selected_shop_ids uuid[],selected_role text,
  selected_environment text,selected_key_id text,selected_issued_at timestamptz,
  selected_expires_at timestamptz,selected_policy_version integer,selected_capability text,
  selected_session_id text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=app.tenant_id();actor uuid:=app.actor_id();session_record app.agent_sessions%ROWTYPE;
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
    OR selected_capability NOT IN ('create','continue')
    OR (selected_capability='create' AND selected_session_id IS NOT NULL)
    OR (selected_capability='continue' AND (selected_session_id IS NULL OR selected_session_id!~'^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'))
  THEN RAISE EXCEPTION 'AGENT_SESSION_GRANT_INVALID'; END IF;

  IF selected_capability='continue' THEN
    SELECT * INTO session_record FROM app.agent_sessions s
    WHERE s.tenant_id=t AND s.session_id=selected_session_id FOR UPDATE;
    IF NOT FOUND OR session_record.status<>'active' OR session_record.expires_at<=clock_timestamp()
      OR session_record.subject_id<>actor OR session_record.shop_ids<>selected_shop_ids
      OR session_record.environment<>selected_environment
    THEN RAISE EXCEPTION 'AGENT_SESSION_UNAVAILABLE'; END IF;
  END IF;

  INSERT INTO app.agent_session_grants(
    tenant_id,grant_id,subject_id,shop_ids,role,environment,key_id,policy_version,
    issued_at,expires_at,capability,session_id
  ) VALUES(
    t,selected_grant_id,selected_subject_id,selected_shop_ids,selected_role,selected_environment,
    selected_key_id,selected_policy_version,selected_issued_at,selected_expires_at,selected_capability,selected_session_id
  );
END $$;

CREATE FUNCTION app.bind_agent_session(
  selected_grant_id uuid,selected_session_id text,selected_expires_at timestamptz
) RETURNS TABLE(session_id text,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=app.tenant_id();actor uuid:=app.actor_id();g app.agent_session_grants%ROWTYPE;
BEGIN
  IF t IS NULL OR actor IS NULL OR selected_grant_id IS NULL
    OR selected_session_id!~'^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
    OR selected_expires_at<clock_timestamp()+interval '5 minutes'
    OR selected_expires_at>clock_timestamp()+interval '4 hours'
  THEN RAISE EXCEPTION 'AGENT_SESSION_BIND_INVALID'; END IF;

  SELECT * INTO g FROM app.agent_session_grants
  WHERE tenant_id=t AND grant_id=selected_grant_id FOR UPDATE;
  IF NOT FOUND OR g.status<>'consumed' OR g.capability<>'create' OR g.subject_id<>actor
    OR g.role<>app.member_role(t) OR g.consumed_at<clock_timestamp()-interval '10 minutes'
    OR EXISTS(SELECT 1 FROM unnest(g.shop_ids) AS values_list(shop_id) WHERE NOT app.shop_allowed(t,shop_id))
  THEN RAISE EXCEPTION 'AGENT_SESSION_BIND_UNAVAILABLE'; END IF;

  INSERT INTO app.agent_sessions(
    tenant_id,session_id,initial_grant_id,subject_id,shop_ids,role_at_creation,
    environment,policy_version,expires_at
  ) VALUES(t,selected_session_id,g.grant_id,g.subject_id,g.shop_ids,g.role,g.environment,g.policy_version,selected_expires_at);
  INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details)
  VALUES(t,gen_random_uuid(),actor,'agent.session.bound',g.grant_id,
    jsonb_build_object('sessionId',selected_session_id,'shopIds',g.shop_ids,'expiresAt',selected_expires_at));
  RETURN QUERY SELECT selected_session_id,selected_expires_at;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'AGENT_SESSION_BIND_UNAVAILABLE';
END $$;

CREATE FUNCTION app.read_agent_session_for_continuation(
  selected_session_id text,selected_environment text
) RETURNS TABLE(session_id text,shop_ids uuid[],role text,policy_version integer,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=app.tenant_id();actor uuid:=app.actor_id();actor_role text:=app.member_role(app.tenant_id());
BEGIN
  IF t IS NULL OR actor IS NULL OR actor_role IS NULL OR selected_environment NOT IN ('development','staging')
    OR selected_session_id!~'^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
  THEN RAISE EXCEPTION 'AGENT_SESSION_UNAVAILABLE'; END IF;
  RETURN QUERY SELECT s.session_id,s.shop_ids,actor_role::text,s.policy_version,s.expires_at
  FROM app.agent_sessions s
  WHERE s.tenant_id=t AND s.session_id=selected_session_id AND s.subject_id=actor
    AND s.environment=selected_environment AND s.status='active' AND s.expires_at>clock_timestamp()
    AND NOT EXISTS(SELECT 1 FROM unnest(s.shop_ids) AS values_list(shop_id) WHERE NOT app.shop_allowed(t,shop_id));
  IF NOT FOUND THEN RAISE EXCEPTION 'AGENT_SESSION_UNAVAILABLE'; END IF;
END $$;

CREATE FUNCTION app.consume_agent_session_grant_v2(
  selected_tenant_id uuid,selected_grant_id uuid,selected_subject_id uuid,selected_shop_ids uuid[],
  selected_role text,selected_environment text,selected_issued_at timestamptz,selected_expires_at timestamptz,
  selected_capability text,selected_session_id text
) RETURNS TABLE(grant_id uuid,consumed_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE stored app.agent_session_grants%ROWTYPE;attempt_count integer;window_start timestamptz:=date_trunc('minute',clock_timestamp());
BEGIN
  IF selected_tenant_id IS NULL OR selected_grant_id IS NULL OR selected_subject_id IS NULL
    OR selected_role NOT IN ('owner','finance','operator','marketing','auditor')
    OR selected_environment NOT IN ('development','staging')
    OR cardinality(selected_shop_ids) NOT BETWEEN 1 AND 20
    OR selected_capability NOT IN ('create','continue')
    OR (selected_capability='create' AND selected_session_id IS NOT NULL)
    OR (selected_capability='continue' AND selected_session_id IS NULL)
  THEN RAISE EXCEPTION 'AGENT_SESSION_GRANT_UNAVAILABLE'; END IF;

  IF selected_capability='continue' AND NOT EXISTS(
    SELECT 1 FROM app.agent_sessions s
    WHERE s.tenant_id=selected_tenant_id AND s.session_id=selected_session_id
      AND s.subject_id=selected_subject_id AND s.shop_ids=selected_shop_ids
      AND s.environment=selected_environment AND s.status='active' AND s.expires_at>clock_timestamp()
      AND app.agent_session_subject_authorized(s.tenant_id,s.subject_id,s.shop_ids,selected_role)
  ) THEN RETURN; END IF;

  SELECT * INTO stored FROM app.agent_session_grants g
  WHERE g.tenant_id=selected_tenant_id AND g.grant_id=selected_grant_id
    AND g.subject_id=selected_subject_id AND g.shop_ids=selected_shop_ids
    AND g.role=selected_role AND g.environment=selected_environment
    AND g.issued_at=selected_issued_at AND g.expires_at=selected_expires_at
    AND g.capability=selected_capability AND g.session_id IS NOT DISTINCT FROM selected_session_id
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  INSERT INTO private.agent_session_grant_rate_limits(tenant_id,grant_id,window_started_at,attempts)
  VALUES(selected_tenant_id,selected_grant_id,window_start,1)
  ON CONFLICT ON CONSTRAINT agent_session_grant_rate_limits_pkey DO UPDATE
    SET attempts=private.agent_session_grant_rate_limits.attempts+1,updated_at=clock_timestamp()
  RETURNING private.agent_session_grant_rate_limits.attempts INTO attempt_count;
  IF attempt_count>5 THEN
    INSERT INTO app.agent_session_grant_events(tenant_id,grant_id,event_type,window_started_at,details)
    VALUES(selected_tenant_id,selected_grant_id,'rate_limited',window_start,
      jsonb_build_object('limit',5,'windowSeconds',60,'capability',selected_capability))
    ON CONFLICT DO NOTHING;
    RETURN;
  END IF;

  IF stored.status='active' AND stored.expires_at>clock_timestamp() THEN
    RETURN QUERY UPDATE app.agent_session_grants g SET status='consumed',consumed_at=clock_timestamp()
    WHERE g.tenant_id=selected_tenant_id AND g.grant_id=selected_grant_id AND g.status='active'
    RETURNING g.grant_id,g.consumed_at;
    IF FOUND THEN
      UPDATE app.agent_sessions SET last_authorized_at=clock_timestamp(),authorization_count=authorization_count+1
      WHERE tenant_id=selected_tenant_id AND session_id=selected_session_id;
      INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details)
      VALUES(selected_tenant_id,gen_random_uuid(),selected_subject_id,'agent.session_grant.consumed',selected_grant_id,
        jsonb_build_object('environment',selected_environment,'shopIds',selected_shop_ids,
          'capability',selected_capability,'sessionId',selected_session_id));
    END IF;
    RETURN;
  END IF;

  IF stored.status='consumed' THEN
    INSERT INTO app.agent_session_grant_events(tenant_id,grant_id,event_type,details)
    VALUES(selected_tenant_id,selected_grant_id,'replay',
      jsonb_build_object('environment',selected_environment,'capability',selected_capability));
  ELSIF stored.status='active' AND stored.expires_at<=clock_timestamp() THEN
    INSERT INTO app.agent_session_grant_events(tenant_id,grant_id,event_type,details)
    VALUES(selected_tenant_id,selected_grant_id,'expired',
      jsonb_build_object('environment',selected_environment,'capability',selected_capability))
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

CREATE FUNCTION app.revoke_agent_session(selected_session_id text,selected_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=app.tenant_id();actor uuid:=app.actor_id();actor_role text:=app.member_role(app.tenant_id());s app.agent_sessions%ROWTYPE;
BEGIN
  SELECT * INTO s FROM app.agent_sessions
  WHERE tenant_id=t AND session_id=selected_session_id FOR UPDATE;
  IF t IS NULL OR actor IS NULL OR NOT FOUND OR s.status<>'active'
    OR (s.subject_id<>actor AND actor_role NOT IN ('owner','auditor'))
    OR length(btrim(selected_reason)) NOT BETWEEN 10 AND 500
  THEN RAISE EXCEPTION 'AGENT_SESSION_REVOKE_FORBIDDEN'; END IF;
  UPDATE app.agent_sessions SET status='revoked',revoked_by=actor,revoked_at=clock_timestamp(),revocation_reason=btrim(selected_reason)
  WHERE tenant_id=t AND session_id=selected_session_id;
  UPDATE app.agent_session_grants SET status='revoked',revoked_by=actor,revoked_at=clock_timestamp(),revocation_reason=btrim(selected_reason)
  WHERE tenant_id=t AND session_id=selected_session_id AND status='active';
  INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details)
  VALUES(t,gen_random_uuid(),actor,'agent.session.revoked',s.initial_grant_id,
    jsonb_build_object('sessionId',selected_session_id,'reason',btrim(selected_reason),'actorRole',actor_role));
END $$;

CREATE FUNCTION app.revoke_active_agent_sessions(selected_reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=app.tenant_id();actor uuid:=app.actor_id();actor_role text:=app.member_role(app.tenant_id());item record;revoked_count integer:=0;
BEGIN
  IF t IS NULL OR actor IS NULL OR actor_role NOT IN ('owner','auditor')
    OR length(btrim(selected_reason)) NOT BETWEEN 10 AND 500
  THEN RAISE EXCEPTION 'AGENT_SESSION_REVOKE_FORBIDDEN'; END IF;
  FOR item IN
    UPDATE app.agent_sessions SET status='revoked',revoked_by=actor,revoked_at=clock_timestamp(),revocation_reason=btrim(selected_reason)
    WHERE tenant_id=t AND status='active'
    RETURNING session_id,initial_grant_id
  LOOP
    revoked_count:=revoked_count+1;
    UPDATE app.agent_session_grants SET status='revoked',revoked_by=actor,revoked_at=clock_timestamp(),revocation_reason=btrim(selected_reason)
    WHERE tenant_id=t AND session_id=item.session_id AND status='active';
    INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details)
    VALUES(t,gen_random_uuid(),actor,'agent.session.revoked',item.initial_grant_id,
      jsonb_build_object('sessionId',item.session_id,'reason',btrim(selected_reason),'actorRole',actor_role,'scope','all-active'));
  END LOOP;
  RETURN revoked_count;
END $$;

REVOKE ALL ON app.agent_sessions FROM PUBLIC;
REVOKE ALL ON FUNCTION app.agent_session_subject_authorized(uuid,uuid,uuid[],text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.register_agent_session_grant_v2(uuid,uuid,uuid[],text,text,text,timestamptz,timestamptz,integer,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.bind_agent_session(uuid,text,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.read_agent_session_for_continuation(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.consume_agent_session_grant_v2(uuid,uuid,uuid,uuid[],text,text,timestamptz,timestamptz,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.revoke_agent_session(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.revoke_active_agent_sessions(text) FROM PUBLIC;
GRANT SELECT ON app.agent_sessions TO commerce_app;
GRANT EXECUTE ON FUNCTION app.register_agent_session_grant_v2(uuid,uuid,uuid[],text,text,text,timestamptz,timestamptz,integer,text,text) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.bind_agent_session(uuid,text,timestamptz) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.read_agent_session_for_continuation(text,text) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.consume_agent_session_grant_v2(uuid,uuid,uuid,uuid[],text,text,timestamptz,timestamptz,text,text) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.revoke_agent_session(text,text) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.revoke_active_agent_sessions(text) TO commerce_app;
