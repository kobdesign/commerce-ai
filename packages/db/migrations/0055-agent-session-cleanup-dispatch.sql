-- EVE-CANARY-11: queue-only dispatch/receipt boundary for emergency Eve cleanup.
-- The queue receives metadata only and never stores the short-lived signed credential.

CREATE FUNCTION app.claim_agent_session_cleanup_reconciliations(selected_batch_size integer DEFAULT 20)
RETURNS TABLE(tenant_id uuid,intent_id uuid,session_id text,attempt_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF session_user<>'commerce_queue' OR selected_batch_size NOT BETWEEN 1 AND 100
  THEN RAISE EXCEPTION 'AGENT_SESSION_CLEANUP_CLAIM_FORBIDDEN'; END IF;
  RETURN QUERY
  WITH candidates AS (
    SELECT r.tenant_id,r.id FROM app.agent_session_reconciliations r
    WHERE r.action='revoke_cleanup' AND r.status='pending' AND r.attempt_count<5
      AND r.next_attempt_at<=clock_timestamp()
    ORDER BY r.next_attempt_at,r.requested_at
    LIMIT selected_batch_size FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE app.agent_session_reconciliations r
    SET attempt_count=r.attempt_count+1,next_attempt_at=clock_timestamp()+interval '60 seconds',
      last_error_code='EVE_CLEANUP_DISPATCHED',updated_at=clock_timestamp()
    FROM candidates c WHERE r.tenant_id=c.tenant_id AND r.id=c.id
    RETURNING r.tenant_id,r.id,r.session_id,r.attempt_count
  ) SELECT claimed.tenant_id,claimed.id,claimed.session_id,claimed.attempt_count FROM claimed;
END $$;

CREATE FUNCTION app.complete_agent_session_cleanup_reconciliation(selected_tenant_id uuid,selected_intent_id uuid,selected_delivery_id text)
RETURNS TABLE(intent_id uuid,status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item app.agent_session_reconciliations%ROWTYPE;
BEGIN
  IF session_user<>'commerce_queue' OR selected_tenant_id IS NULL OR selected_intent_id IS NULL
    OR selected_delivery_id IS NULL OR selected_delivery_id!~'^[A-Za-z0-9][A-Za-z0-9._:-]{7,199}$'
  THEN RAISE EXCEPTION 'AGENT_SESSION_CLEANUP_COMPLETE_FORBIDDEN'; END IF;
  SELECT * INTO item FROM app.agent_session_reconciliations r
  WHERE r.tenant_id=selected_tenant_id AND r.id=selected_intent_id FOR UPDATE;
  IF NOT FOUND OR item.action<>'revoke_cleanup' OR item.status NOT IN ('pending','succeeded')
  THEN RAISE EXCEPTION 'AGENT_SESSION_CLEANUP_UNAVAILABLE'; END IF;
  IF item.status='succeeded' THEN
    IF item.eve_delivery_id<>selected_delivery_id THEN RAISE EXCEPTION 'AGENT_SESSION_CLEANUP_RECEIPT_CONFLICT'; END IF;
    RETURN QUERY SELECT item.id,item.status;RETURN;
  END IF;
  UPDATE app.agent_session_reconciliations r SET status='succeeded',eve_delivery_id=selected_delivery_id,
    receipt_received_at=clock_timestamp(),completed_at=clock_timestamp(),last_error_code=NULL,updated_at=clock_timestamp()
  WHERE r.tenant_id=selected_tenant_id AND r.id=selected_intent_id;
  INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details)
  VALUES(item.tenant_id,gen_random_uuid(),item.requested_by,'agent.session.cleanup_confirmed',item.id,
    jsonb_build_object('sessionId',item.session_id,'deliveryId',selected_delivery_id,'source','cleanup-service-identity'));
  RETURN QUERY SELECT item.id,'succeeded'::text;
END $$;

CREATE FUNCTION app.fail_agent_session_cleanup_reconciliation(selected_tenant_id uuid,selected_intent_id uuid,selected_error_code text)
RETURNS TABLE(intent_id uuid,status text,attempt_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE item app.agent_session_reconciliations%ROWTYPE;code text:=btrim(selected_error_code);
BEGIN
  IF session_user<>'commerce_queue' OR selected_tenant_id IS NULL OR selected_intent_id IS NULL
    OR code IS NULL OR code!~'^[A-Z][A-Z0-9_]{2,79}$'
  THEN RAISE EXCEPTION 'AGENT_SESSION_CLEANUP_FAIL_FORBIDDEN'; END IF;
  SELECT * INTO item FROM app.agent_session_reconciliations r
  WHERE r.tenant_id=selected_tenant_id AND r.id=selected_intent_id FOR UPDATE;
  IF NOT FOUND OR item.action<>'revoke_cleanup' OR item.status<>'pending'
  THEN RAISE EXCEPTION 'AGENT_SESSION_CLEANUP_UNAVAILABLE'; END IF;
  IF item.attempt_count>=5 THEN
    UPDATE app.agent_session_reconciliations r SET status='failed',last_error_code=code,
      completed_at=clock_timestamp(),updated_at=clock_timestamp()
    WHERE r.tenant_id=selected_tenant_id AND r.id=selected_intent_id;
    RETURN QUERY SELECT item.id,'failed'::text,item.attempt_count;RETURN;
  END IF;
  UPDATE app.agent_session_reconciliations r SET last_error_code=code,
    next_attempt_at=clock_timestamp()+make_interval(secs=>least(300,power(2,item.attempt_count)::integer*5)),
    updated_at=clock_timestamp()
  WHERE r.tenant_id=selected_tenant_id AND r.id=selected_intent_id;
  RETURN QUERY SELECT item.id,'pending'::text,item.attempt_count;
END $$;

REVOKE ALL ON FUNCTION app.claim_agent_session_cleanup_reconciliations(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.complete_agent_session_cleanup_reconciliation(uuid,uuid,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.fail_agent_session_cleanup_reconciliation(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.claim_agent_session_cleanup_reconciliations(integer) TO commerce_queue;
GRANT EXECUTE ON FUNCTION app.complete_agent_session_cleanup_reconciliation(uuid,uuid,text) TO commerce_queue;
GRANT EXECUTE ON FUNCTION app.fail_agent_session_cleanup_reconciliation(uuid,uuid,text) TO commerce_queue;
