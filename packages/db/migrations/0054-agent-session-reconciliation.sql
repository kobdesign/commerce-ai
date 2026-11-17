-- EVE-CANARY-10: durable lifecycle intents and receipts. This table stores
-- metadata only; signed grants and model content are never persisted here.

CREATE TABLE app.agent_session_reconciliations (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  session_id text NOT NULL,
  action text NOT NULL CHECK(action IN ('end','revoke_cleanup')),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','receipt_received','succeeded','failed')),
  requested_by uuid NOT NULL REFERENCES private.users(id),
  request_grant_id uuid,
  idempotency_key uuid NOT NULL,
  reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
  eve_delivery_id text CHECK(eve_delivery_id IS NULL OR eve_delivery_id~'^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'),
  attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count BETWEEN 0 AND 5),
  next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_error_code text CHECK(last_error_code IS NULL OR last_error_code~'^[A-Z][A-Z0-9_]{2,79}$'),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  receipt_received_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,idempotency_key),
  FOREIGN KEY(tenant_id,session_id) REFERENCES app.agent_sessions(tenant_id,session_id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,request_grant_id) REFERENCES app.agent_session_grants(tenant_id,grant_id),
  CONSTRAINT agent_session_reconciliation_state_check CHECK(
    (status='pending' AND eve_delivery_id IS NULL AND receipt_received_at IS NULL AND completed_at IS NULL)
    OR (status='receipt_received' AND eve_delivery_id IS NOT NULL AND receipt_received_at IS NOT NULL AND completed_at IS NULL)
    OR (status='succeeded' AND eve_delivery_id IS NOT NULL AND receipt_received_at IS NOT NULL AND completed_at IS NOT NULL)
    OR (status='failed' AND completed_at IS NOT NULL AND last_error_code IS NOT NULL)
  )
);
CREATE INDEX agent_session_reconciliations_work_idx
  ON app.agent_session_reconciliations(status,next_attempt_at,requested_at)
  WHERE status IN ('pending','receipt_received');
CREATE INDEX agent_session_reconciliations_tenant_idx
  ON app.agent_session_reconciliations(tenant_id,requested_at DESC,status);

ALTER TABLE app.agent_session_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.agent_session_reconciliations NO FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_session_reconciliations_read ON app.agent_session_reconciliations FOR SELECT TO commerce_app USING(
  tenant_id=app.tenant_id()
  AND (requested_by=app.actor_id() OR app.member_role(tenant_id) IN ('owner','auditor'))
);

CREATE FUNCTION app.create_agent_session_end_intent(
  selected_id uuid,selected_session_id text,selected_grant_id uuid,
  selected_idempotency_key uuid,selected_reason text
) RETURNS TABLE(intent_id uuid,status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=app.tenant_id();actor uuid:=app.actor_id();reason text:=btrim(selected_reason);s app.agent_sessions%ROWTYPE;g app.agent_session_grants%ROWTYPE;existing app.agent_session_reconciliations%ROWTYPE;
BEGIN
  IF t IS NULL OR actor IS NULL OR selected_id IS NULL OR selected_idempotency_key IS NULL
    OR selected_grant_id IS NULL OR selected_session_id IS NULL OR reason IS NULL OR length(reason) NOT BETWEEN 10 AND 500
  THEN RAISE EXCEPTION 'AGENT_SESSION_INTENT_UNAVAILABLE'; END IF;

  SELECT * INTO existing FROM app.agent_session_reconciliations r
  WHERE r.tenant_id=t AND r.idempotency_key=selected_idempotency_key FOR UPDATE;
  IF FOUND THEN
    IF existing.session_id<>selected_session_id OR existing.action<>'end'
      OR existing.request_grant_id<>selected_grant_id OR existing.reason<>reason
    THEN RAISE EXCEPTION 'AGENT_SESSION_INTENT_CONFLICT'; END IF;
    RETURN QUERY SELECT existing.id,existing.status;
    RETURN;
  END IF;

  SELECT * INTO s FROM app.agent_sessions
  WHERE tenant_id=t AND session_id=selected_session_id FOR UPDATE;
  SELECT * INTO g FROM app.agent_session_grants
  WHERE tenant_id=t AND grant_id=selected_grant_id FOR UPDATE;
  IF s.tenant_id IS NULL OR s.status<>'active' OR s.subject_id<>actor OR s.expires_at<=clock_timestamp()
    OR g.tenant_id IS NULL OR g.status<>'active' OR g.capability<>'continue'
    OR g.session_id<>selected_session_id OR g.subject_id<>actor OR g.expires_at<=clock_timestamp()
  THEN RAISE EXCEPTION 'AGENT_SESSION_INTENT_UNAVAILABLE'; END IF;

  INSERT INTO app.agent_session_reconciliations(
    tenant_id,id,session_id,action,requested_by,request_grant_id,idempotency_key,reason
  ) VALUES(t,selected_id,selected_session_id,'end',actor,selected_grant_id,selected_idempotency_key,reason)
  ON CONFLICT(tenant_id,idempotency_key) DO NOTHING;
  IF NOT FOUND THEN
    SELECT * INTO existing FROM app.agent_session_reconciliations r
    WHERE r.tenant_id=t AND r.idempotency_key=selected_idempotency_key FOR UPDATE;
    IF existing.session_id<>selected_session_id OR existing.action<>'end'
      OR existing.request_grant_id<>selected_grant_id OR existing.reason<>reason
    THEN RAISE EXCEPTION 'AGENT_SESSION_INTENT_CONFLICT'; END IF;
    RETURN QUERY SELECT existing.id,existing.status;
    RETURN;
  END IF;
  INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details)
  VALUES(t,gen_random_uuid(),actor,'agent.session.end_requested',selected_id,
    jsonb_build_object('sessionId',selected_session_id,'grantId',selected_grant_id));
  RETURN QUERY SELECT selected_id,'pending'::text;
END $$;

CREATE FUNCTION app.record_agent_session_eve_receipt(
  selected_intent_id uuid,selected_delivery_id text
) RETURNS TABLE(intent_id uuid,status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=app.tenant_id();actor uuid:=app.actor_id();item app.agent_session_reconciliations%ROWTYPE;
BEGIN
  IF t IS NULL OR actor IS NULL OR selected_intent_id IS NULL OR selected_delivery_id IS NULL
    OR selected_delivery_id!~'^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
  THEN RAISE EXCEPTION 'AGENT_SESSION_RECEIPT_UNAVAILABLE'; END IF;
  SELECT * INTO item FROM app.agent_session_reconciliations
  WHERE tenant_id=t AND id=selected_intent_id FOR UPDATE;
  IF NOT FOUND OR item.requested_by<>actor OR item.action<>'end' OR item.status NOT IN ('pending','receipt_received')
  THEN RAISE EXCEPTION 'AGENT_SESSION_RECEIPT_UNAVAILABLE'; END IF;
  IF item.status='receipt_received' THEN
    IF item.eve_delivery_id<>selected_delivery_id THEN RAISE EXCEPTION 'AGENT_SESSION_RECEIPT_CONFLICT'; END IF;
    RETURN QUERY SELECT item.id,item.status;
    RETURN;
  END IF;
  UPDATE app.agent_session_reconciliations SET status='receipt_received',eve_delivery_id=selected_delivery_id,
    receipt_received_at=clock_timestamp(),next_attempt_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE tenant_id=t AND id=selected_intent_id;
  INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details)
  VALUES(t,gen_random_uuid(),actor,'agent.session.eve_end_accepted',selected_intent_id,
    jsonb_build_object('sessionId',item.session_id,'deliveryId',selected_delivery_id));
  RETURN QUERY SELECT selected_intent_id,'receipt_received'::text;
END $$;

CREATE OR REPLACE FUNCTION app.end_agent_session(selected_session_id text,selected_reason text)
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
    UPDATE app.agent_session_reconciliations SET status='succeeded',completed_at=COALESCE(completed_at,clock_timestamp()),
      last_error_code=NULL,updated_at=clock_timestamp()
    WHERE app.agent_session_reconciliations.tenant_id=t
      AND app.agent_session_reconciliations.session_id=selected_session_id
      AND app.agent_session_reconciliations.action='end'
      AND app.agent_session_reconciliations.status='receipt_received';
    RETURN QUERY SELECT selected_session_id,'ended'::text;
    RETURN;
  END IF;
  IF s.status<>'active' THEN RAISE EXCEPTION 'AGENT_SESSION_END_UNAVAILABLE'; END IF;
  IF NOT EXISTS(
    SELECT 1 FROM app.agent_session_reconciliations r
    JOIN app.agent_session_grants g ON g.tenant_id=r.tenant_id AND g.grant_id=r.request_grant_id
    WHERE r.tenant_id=t AND r.session_id=selected_session_id AND r.action='end'
      AND r.status='receipt_received' AND r.requested_by=actor AND g.status='consumed'
  ) THEN RAISE EXCEPTION 'AGENT_SESSION_END_EVIDENCE_REQUIRED'; END IF;
  UPDATE app.agent_sessions SET status='ended',revoked_at=clock_timestamp(),revocation_reason=reason
  WHERE tenant_id=t AND app.agent_sessions.session_id=selected_session_id;
  UPDATE app.agent_session_grants SET status='revoked',revoked_by=actor,revoked_at=clock_timestamp(),revocation_reason=reason
  WHERE tenant_id=t AND app.agent_session_grants.session_id=selected_session_id AND app.agent_session_grants.status='active';
  UPDATE app.agent_session_reconciliations SET status='succeeded',completed_at=clock_timestamp(),
    last_error_code=NULL,updated_at=clock_timestamp()
  WHERE app.agent_session_reconciliations.tenant_id=t
    AND app.agent_session_reconciliations.session_id=selected_session_id
    AND app.agent_session_reconciliations.action='end'
    AND app.agent_session_reconciliations.status='receipt_received';
  INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details)
  VALUES(t,gen_random_uuid(),actor,'agent.session.ended',s.initial_grant_id,
    jsonb_build_object('sessionId',selected_session_id,'reason',reason,'actorRole',actor_role));
  RETURN QUERY SELECT selected_session_id,'ended'::text;
END $$;

CREATE OR REPLACE FUNCTION app.revoke_agent_session(selected_session_id text,selected_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=app.tenant_id();actor uuid:=app.actor_id();actor_role text:=app.member_role(app.tenant_id());s app.agent_sessions%ROWTYPE;intent_id uuid:=gen_random_uuid();reason text:=btrim(selected_reason);
BEGIN
  SELECT * INTO s FROM app.agent_sessions
  WHERE app.agent_sessions.tenant_id=t AND app.agent_sessions.session_id=selected_session_id FOR UPDATE;
  IF t IS NULL OR actor IS NULL OR NOT FOUND OR s.status<>'active'
    OR (s.subject_id<>actor AND actor_role NOT IN ('owner','auditor'))
    OR length(reason) NOT BETWEEN 10 AND 500
  THEN RAISE EXCEPTION 'AGENT_SESSION_REVOKE_FORBIDDEN'; END IF;
  UPDATE app.agent_sessions SET status='revoked',revoked_by=actor,revoked_at=clock_timestamp(),revocation_reason=reason
  WHERE app.agent_sessions.tenant_id=t AND app.agent_sessions.session_id=selected_session_id;
  UPDATE app.agent_session_grants SET status='revoked',revoked_by=actor,revoked_at=clock_timestamp(),revocation_reason=reason
  WHERE app.agent_session_grants.tenant_id=t AND app.agent_session_grants.session_id=selected_session_id
    AND app.agent_session_grants.status='active';
  INSERT INTO app.agent_session_reconciliations(
    tenant_id,id,session_id,action,requested_by,idempotency_key,reason,last_error_code
  ) VALUES(t,intent_id,selected_session_id,'revoke_cleanup',actor,intent_id,reason,'EVE_RECEIPT_PENDING');
  INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details)
  VALUES(t,gen_random_uuid(),actor,'agent.session.revoked',s.initial_grant_id,
    jsonb_build_object('sessionId',selected_session_id,'reason',reason,'actorRole',actor_role,'reconciliationIntentId',intent_id));
END $$;

CREATE FUNCTION app.process_agent_session_reconciliations(selected_batch_size integer DEFAULT 100)
RETURNS TABLE(sessions_finalized integer,intents_retried integer,intents_failed integer,intents_timed_out integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE finalized_count integer:=0;retried_count integer:=0;failed_count integer:=0;timed_out_count integer:=0;item record;s app.agent_sessions%ROWTYPE;grant_consumed boolean;
BEGIN
  IF session_user<>'commerce_queue' OR selected_batch_size NOT BETWEEN 1 AND 500
  THEN RAISE EXCEPTION 'AGENT_SESSION_RECONCILIATION_FORBIDDEN'; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtext('commerce-agent-session-reconciliation')) THEN
    RETURN QUERY SELECT 0,0,0,0;RETURN;
  END IF;

  WITH candidates AS (
    SELECT tenant_id,id FROM app.agent_session_reconciliations
    WHERE status='pending' AND requested_at<clock_timestamp()-interval '15 minutes'
      AND next_attempt_at<=clock_timestamp()
    ORDER BY requested_at LIMIT selected_batch_size FOR UPDATE SKIP LOCKED
  ), failed AS (
    UPDATE app.agent_session_reconciliations r SET status='failed',last_error_code='EVE_RECEIPT_MISSING',
      completed_at=clock_timestamp(),updated_at=clock_timestamp()
    FROM candidates c WHERE r.tenant_id=c.tenant_id AND r.id=c.id RETURNING 1
  ) SELECT count(*)::integer INTO timed_out_count FROM failed;

  FOR item IN
    SELECT tenant_id,id,session_id,request_grant_id,requested_by,reason,attempt_count
    FROM app.agent_session_reconciliations
    WHERE action='end' AND status='receipt_received' AND next_attempt_at<=clock_timestamp()
    ORDER BY next_attempt_at,requested_at LIMIT selected_batch_size FOR UPDATE SKIP LOCKED
  LOOP
    SELECT * INTO s FROM app.agent_sessions
    WHERE tenant_id=item.tenant_id AND session_id=item.session_id FOR UPDATE;
    SELECT EXISTS(
      SELECT 1 FROM app.agent_session_grants g
      WHERE g.tenant_id=item.tenant_id AND g.grant_id=item.request_grant_id AND g.status='consumed'
    ) INTO grant_consumed;
    IF s.tenant_id IS NOT NULL AND grant_consumed AND s.status IN ('active','ended') THEN
      IF s.status='active' THEN
        UPDATE app.agent_sessions SET status='ended',revoked_at=clock_timestamp(),revocation_reason=item.reason
        WHERE tenant_id=item.tenant_id AND session_id=item.session_id;
        UPDATE app.agent_session_grants SET status='revoked',revoked_by=item.requested_by,
          revoked_at=clock_timestamp(),revocation_reason=item.reason
        WHERE tenant_id=item.tenant_id AND session_id=item.session_id AND status='active';
        INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details)
        VALUES(item.tenant_id,gen_random_uuid(),item.requested_by,'agent.session.ended',s.initial_grant_id,
          jsonb_build_object('sessionId',item.session_id,'reason',item.reason,'source','durable-reconciliation'));
      END IF;
      UPDATE app.agent_session_reconciliations SET status='succeeded',attempt_count=attempt_count+1,
        completed_at=clock_timestamp(),last_error_code=NULL,updated_at=clock_timestamp()
      WHERE tenant_id=item.tenant_id AND id=item.id;
      finalized_count:=finalized_count+1;
    ELSIF item.attempt_count+1>=5 THEN
      UPDATE app.agent_session_reconciliations SET status='failed',attempt_count=attempt_count+1,
        completed_at=clock_timestamp(),last_error_code='CORE_SESSION_MISMATCH',updated_at=clock_timestamp()
      WHERE tenant_id=item.tenant_id AND id=item.id;
      failed_count:=failed_count+1;
    ELSE
      UPDATE app.agent_session_reconciliations SET attempt_count=attempt_count+1,
        next_attempt_at=clock_timestamp()+make_interval(secs=>least(300,power(2,attempt_count+1)::integer*5)),
        last_error_code='CORE_SESSION_NOT_READY',updated_at=clock_timestamp()
      WHERE tenant_id=item.tenant_id AND id=item.id;
      retried_count:=retried_count+1;
    END IF;
  END LOOP;
  RETURN QUERY SELECT finalized_count,retried_count,failed_count,timed_out_count;
END $$;

CREATE FUNCTION app.agent_session_reconciliation_metrics()
RETURNS TABLE(pending_end bigint,pending_revoke_cleanup bigint,failed bigint,oldest_pending_seconds bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=app.tenant_id();actor_role text:=app.member_role(app.tenant_id());
BEGIN
  IF t IS NULL OR actor_role NOT IN ('owner','auditor')
  THEN RAISE EXCEPTION 'AGENT_SESSION_RECONCILIATION_METRICS_FORBIDDEN'; END IF;
  RETURN QUERY SELECT
    count(*) FILTER(WHERE action='end' AND status IN ('pending','receipt_received')),
    count(*) FILTER(WHERE action='revoke_cleanup' AND status='pending'),
    count(*) FILTER(WHERE status='failed'),
    COALESCE(extract(epoch FROM clock_timestamp()-min(requested_at) FILTER(WHERE status IN ('pending','receipt_received')))::bigint,0)
  FROM app.agent_session_reconciliations WHERE tenant_id=t;
END $$;

REVOKE ALL ON app.agent_session_reconciliations FROM PUBLIC;
REVOKE ALL ON FUNCTION app.create_agent_session_end_intent(uuid,text,uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.record_agent_session_eve_receipt(uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.process_agent_session_reconciliations(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.agent_session_reconciliation_metrics() FROM PUBLIC;
GRANT SELECT ON app.agent_session_reconciliations TO commerce_app;
GRANT EXECUTE ON FUNCTION app.create_agent_session_end_intent(uuid,text,uuid,uuid,text) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.record_agent_session_eve_receipt(uuid,text) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.agent_session_reconciliation_metrics() TO commerce_app;
GRANT EXECUTE ON FUNCTION app.process_agent_session_reconciliations(integer) TO commerce_queue;

COMMENT ON TABLE app.agent_session_reconciliations IS
  'Metadata-only durable lifecycle intents and Eve acceptance receipts; contains no signed grant or model content.';
