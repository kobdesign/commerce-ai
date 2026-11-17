-- EVE-CANARY-09: fail-closed session handshake, terminal reconciliation and
-- bounded metadata retention. Eve owns conversation history; Core owns the
-- authorization lifecycle and stores metadata only.

ALTER TABLE app.agent_sessions DROP CONSTRAINT agent_sessions_status_check;
ALTER TABLE app.agent_sessions DROP CONSTRAINT agent_session_state_check;
ALTER TABLE app.agent_sessions
  ADD CONSTRAINT agent_sessions_status_check CHECK(status IN ('active','revoked','ended','abandoned')),
  ADD CONSTRAINT agent_session_state_check CHECK(
    (status='active' AND revoked_by IS NULL AND revoked_at IS NULL AND revocation_reason IS NULL)
    OR (status='revoked' AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL AND length(revocation_reason) BETWEEN 10 AND 500)
    OR (status IN ('ended','abandoned') AND revoked_by IS NULL AND revoked_at IS NOT NULL AND length(revocation_reason) BETWEEN 10 AND 500)
  );

ALTER TABLE app.agent_session_grant_events DROP CONSTRAINT agent_session_grant_events_event_type_check;
ALTER TABLE app.agent_session_grant_events
  ADD CONSTRAINT agent_session_grant_events_event_type_check
  CHECK(event_type IN ('issued','consumed','replay','revoked','expired','rate_limited','abandoned'));
DROP INDEX app.agent_session_grant_events_lifecycle_idx;
CREATE UNIQUE INDEX agent_session_grant_events_lifecycle_idx
  ON app.agent_session_grant_events(tenant_id,grant_id,event_type)
  WHERE event_type IN ('issued','consumed','revoked','expired','abandoned');

CREATE OR REPLACE FUNCTION app.bind_agent_session(
  selected_grant_id uuid,selected_session_id text,selected_expires_at timestamptz
) RETURNS TABLE(session_id text,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=app.tenant_id();actor uuid:=app.actor_id();g app.agent_session_grants%ROWTYPE;existing app.agent_sessions%ROWTYPE;
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

  SELECT * INTO existing FROM app.agent_sessions s
  WHERE s.tenant_id=t AND s.initial_grant_id=g.grant_id FOR UPDATE;
  IF FOUND THEN
    IF existing.session_id=selected_session_id AND existing.status='active' THEN
      RETURN QUERY SELECT existing.session_id,existing.expires_at;
      RETURN;
    END IF;
    RAISE EXCEPTION 'AGENT_SESSION_BIND_UNAVAILABLE';
  END IF;

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

CREATE FUNCTION app.abandon_agent_session(
  selected_grant_id uuid,selected_session_id text,selected_reason text
) RETURNS TABLE(session_id text,status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=app.tenant_id();actor uuid:=app.actor_id();g app.agent_session_grants%ROWTYPE;existing app.agent_sessions%ROWTYPE;reason text:=btrim(selected_reason);
BEGIN
  IF t IS NULL OR actor IS NULL OR selected_grant_id IS NULL
    OR selected_session_id!~'^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
    OR length(reason) NOT BETWEEN 10 AND 500
  THEN RAISE EXCEPTION 'AGENT_SESSION_ABANDON_UNAVAILABLE'; END IF;
  SELECT * INTO g FROM app.agent_session_grants
  WHERE tenant_id=t AND grant_id=selected_grant_id FOR UPDATE;
  IF NOT FOUND OR g.status<>'consumed' OR g.capability<>'create' OR g.subject_id<>actor
    OR g.consumed_at<clock_timestamp()-interval '10 minutes'
  THEN RAISE EXCEPTION 'AGENT_SESSION_ABANDON_UNAVAILABLE'; END IF;

  SELECT * INTO existing FROM app.agent_sessions s
  WHERE s.tenant_id=t AND s.initial_grant_id=g.grant_id FOR UPDATE;
  IF FOUND THEN
    IF existing.session_id<>selected_session_id OR existing.status NOT IN ('active','abandoned')
    THEN RAISE EXCEPTION 'AGENT_SESSION_ABANDON_UNAVAILABLE'; END IF;
    IF existing.status='abandoned' THEN
      RETURN QUERY SELECT selected_session_id,'abandoned'::text;
      RETURN;
    END IF;
    IF existing.status='active' THEN
      UPDATE app.agent_sessions SET status='abandoned',revoked_at=clock_timestamp(),revocation_reason=reason
      WHERE tenant_id=t AND app.agent_sessions.session_id=selected_session_id;
    END IF;
  ELSE
    INSERT INTO app.agent_sessions(
      tenant_id,session_id,initial_grant_id,subject_id,shop_ids,role_at_creation,
      environment,policy_version,status,expires_at,revoked_at,revocation_reason
    ) VALUES(
      t,selected_session_id,g.grant_id,g.subject_id,g.shop_ids,g.role,g.environment,g.policy_version,
      'abandoned',clock_timestamp(),clock_timestamp(),reason
    );
  END IF;
  UPDATE app.agent_session_grants SET status='revoked',revoked_by=actor,revoked_at=clock_timestamp(),revocation_reason=reason
  WHERE tenant_id=t AND app.agent_session_grants.session_id=selected_session_id AND app.agent_session_grants.status='active';
  INSERT INTO app.agent_session_grant_events(tenant_id,grant_id,event_type,details)
  VALUES(t,g.grant_id,'abandoned',jsonb_build_object('sessionId',selected_session_id,'reason',reason))
  ON CONFLICT DO NOTHING;
  INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details)
  VALUES(t,gen_random_uuid(),actor,'agent.session.abandoned',g.grant_id,
    jsonb_build_object('sessionId',selected_session_id,'reason',reason))
  ON CONFLICT DO NOTHING;
  RETURN QUERY SELECT selected_session_id,'abandoned'::text;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'AGENT_SESSION_ABANDON_UNAVAILABLE';
END $$;

CREATE FUNCTION app.end_agent_session(selected_session_id text,selected_reason text)
RETURNS TABLE(session_id text,status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=app.tenant_id();actor uuid:=app.actor_id();actor_role text:=app.member_role(app.tenant_id());s app.agent_sessions%ROWTYPE;reason text:=btrim(selected_reason);
BEGIN
  SELECT * INTO s FROM app.agent_sessions
  WHERE tenant_id=t AND app.agent_sessions.session_id=selected_session_id FOR UPDATE;
  IF t IS NULL OR actor IS NULL OR NOT FOUND
    OR (s.subject_id<>actor AND actor_role NOT IN ('owner','auditor'))
    OR length(reason) NOT BETWEEN 10 AND 500
  THEN RAISE EXCEPTION 'AGENT_SESSION_END_FORBIDDEN'; END IF;
  IF s.status='ended' THEN
    RETURN QUERY SELECT selected_session_id,'ended'::text;
    RETURN;
  END IF;
  IF s.status<>'active' THEN RAISE EXCEPTION 'AGENT_SESSION_END_UNAVAILABLE'; END IF;
  UPDATE app.agent_sessions SET status='ended',revoked_at=clock_timestamp(),revocation_reason=reason
  WHERE tenant_id=t AND app.agent_sessions.session_id=selected_session_id;
  UPDATE app.agent_session_grants SET status='revoked',revoked_by=actor,revoked_at=clock_timestamp(),revocation_reason=reason
  WHERE tenant_id=t AND app.agent_session_grants.session_id=selected_session_id AND app.agent_session_grants.status='active';
  INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details)
  VALUES(t,gen_random_uuid(),actor,'agent.session.ended',s.initial_grant_id,
    jsonb_build_object('sessionId',selected_session_id,'reason',reason,'actorRole',actor_role));
  RETURN QUERY SELECT selected_session_id,'ended'::text;
END $$;

CREATE FUNCTION app.maintain_agent_sessions(selected_batch_size integer DEFAULT 500)
RETURNS TABLE(sessions_ended integer,abandoned_recorded integer,sessions_deleted integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ended_count integer:=0;abandoned_count integer:=0;deleted_count integer:=0;
BEGIN
  IF session_user<>'commerce_queue' OR selected_batch_size NOT BETWEEN 1 AND 2000
  THEN RAISE EXCEPTION 'AGENT_SESSION_MAINTENANCE_FORBIDDEN'; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtext('commerce-agent-session-maintenance')) THEN
    RETURN QUERY SELECT 0,0,0;RETURN;
  END IF;
  WITH candidates AS (
    SELECT tenant_id,session_id FROM app.agent_sessions
    WHERE status='active' AND expires_at<=clock_timestamp()
    ORDER BY expires_at LIMIT selected_batch_size FOR UPDATE SKIP LOCKED
  ), ended AS (
    UPDATE app.agent_sessions s SET status='ended',revoked_at=clock_timestamp(),
      revocation_reason='Session lifetime expired during bounded maintenance.'
    FROM candidates c WHERE s.tenant_id=c.tenant_id AND s.session_id=c.session_id
    RETURNING s.tenant_id,s.session_id
  ) SELECT count(*)::integer INTO ended_count FROM ended;

  WITH candidates AS (
    SELECT g.tenant_id,g.grant_id,g.environment FROM app.agent_session_grants g
    WHERE g.capability='create' AND g.status='consumed'
      AND g.consumed_at<clock_timestamp()-interval '15 minutes'
      AND NOT EXISTS(SELECT 1 FROM app.agent_sessions s WHERE s.tenant_id=g.tenant_id AND s.initial_grant_id=g.grant_id)
    ORDER BY g.consumed_at LIMIT selected_batch_size
  ), inserted AS (
    INSERT INTO app.agent_session_grant_events(tenant_id,grant_id,event_type,details)
    SELECT tenant_id,grant_id,'abandoned',jsonb_build_object('environment',environment,'reason','bind_not_completed') FROM candidates
    ON CONFLICT DO NOTHING RETURNING 1
  ) SELECT count(*)::integer INTO abandoned_count FROM inserted;

  WITH candidates AS (
    SELECT tenant_id,session_id FROM app.agent_sessions
    WHERE status IN ('revoked','ended','abandoned') AND revoked_at<clock_timestamp()-interval '30 days'
    ORDER BY revoked_at LIMIT selected_batch_size FOR UPDATE SKIP LOCKED
  ), deleted AS (
    DELETE FROM app.agent_sessions s USING candidates c
    WHERE s.tenant_id=c.tenant_id AND s.session_id=c.session_id RETURNING 1
  ) SELECT count(*)::integer INTO deleted_count FROM deleted;
  RETURN QUERY SELECT ended_count,abandoned_count,deleted_count;
END $$;

CREATE OR REPLACE FUNCTION app.agent_session_grant_metrics(selected_window_minutes integer DEFAULT 60)
RETURNS TABLE(event_type text,event_count bigint) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=app.tenant_id();actor_role text:=app.member_role(app.tenant_id());
BEGIN
  IF t IS NULL OR actor_role NOT IN ('owner','auditor') OR selected_window_minutes NOT BETWEEN 1 AND 10080
  THEN RAISE EXCEPTION 'AGENT_SESSION_GRANT_METRICS_FORBIDDEN'; END IF;
  RETURN QUERY
    SELECT names.event_name,COALESCE(counts.event_count,0) FROM
      unnest(ARRAY['issued','consumed','replay','revoked','expired','rate_limited','abandoned']::text[]) AS names(event_name)
    LEFT JOIN (
      SELECT e.event_type,count(*)::bigint AS event_count FROM app.agent_session_grant_events e
      WHERE e.tenant_id=t AND e.occurred_at>=clock_timestamp()-make_interval(mins=>selected_window_minutes)
      GROUP BY e.event_type
    ) counts ON counts.event_type=names.event_name;
END $$;

REVOKE ALL ON FUNCTION app.abandon_agent_session(uuid,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.end_agent_session(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.maintain_agent_sessions(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.abandon_agent_session(uuid,text,text) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.end_agent_session(text,text) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.maintain_agent_sessions(integer) TO commerce_queue;

COMMENT ON FUNCTION app.maintain_agent_sessions(integer) IS
  'Ends expired sessions, records consumed create grants with no bind after 15 minutes, and deletes terminal session metadata after 30 days.';
