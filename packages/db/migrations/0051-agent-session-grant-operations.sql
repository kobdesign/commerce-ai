-- EVE-CANARY-07: durable grant telemetry, shared abuse controls and bounded retention.
-- The limits are deliberately fixed in the trusted database boundary for the
-- non-production canary. Changing them requires a new reviewed migration.

CREATE TABLE app.agent_session_grant_events (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  grant_id uuid NOT NULL,
  event_type text NOT NULL CHECK(event_type IN ('issued','consumed','replay','revoked','expired','rate_limited')),
  window_started_at timestamptz,
  details jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(details)='object'),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id)
);
CREATE INDEX agent_session_grant_events_metrics_idx
  ON app.agent_session_grant_events(tenant_id,occurred_at DESC,event_type);
CREATE UNIQUE INDEX agent_session_grant_events_lifecycle_idx
  ON app.agent_session_grant_events(tenant_id,grant_id,event_type)
  WHERE event_type IN ('issued','consumed','revoked','expired');
CREATE UNIQUE INDEX agent_session_grant_events_rate_bucket_idx
  ON app.agent_session_grant_events(tenant_id,grant_id,event_type,window_started_at)
  WHERE event_type='rate_limited';

ALTER TABLE app.agent_session_grant_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.agent_session_grant_events NO FORCE ROW LEVEL SECURITY;
CREATE POLICY agent_session_grant_events_read ON app.agent_session_grant_events FOR SELECT TO commerce_app USING(
  tenant_id=app.tenant_id() AND app.member_role(tenant_id) IN ('owner','auditor')
);

CREATE TABLE private.agent_session_grant_rate_limits (
  tenant_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  window_started_at timestamptz NOT NULL,
  attempts integer NOT NULL CHECK(attempts BETWEEN 1 AND 100000),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,grant_id,window_started_at)
);
CREATE INDEX agent_session_grant_rate_limits_cleanup_idx
  ON private.agent_session_grant_rate_limits(updated_at);

CREATE FUNCTION app.record_agent_session_grant_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE transition_type text;
BEGIN
  IF TG_OP='INSERT' THEN transition_type:='issued';
  ELSIF OLD.status IS DISTINCT FROM NEW.status AND NEW.status IN ('consumed','revoked') THEN transition_type:=NEW.status;
  ELSE RETURN NEW;
  END IF;
  INSERT INTO app.agent_session_grant_events(tenant_id,grant_id,event_type,details)
  VALUES(NEW.tenant_id,NEW.grant_id,transition_type,jsonb_build_object('environment',NEW.environment))
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

CREATE TRIGGER agent_session_grant_transition
AFTER INSERT OR UPDATE OF status ON app.agent_session_grants
FOR EACH ROW EXECUTE FUNCTION app.record_agent_session_grant_transition();

-- Backfill lifecycle telemetry for grants created before this migration.
INSERT INTO app.agent_session_grant_events(tenant_id,grant_id,event_type,details,occurred_at)
SELECT tenant_id,grant_id,'issued',jsonb_build_object('environment',environment),created_at
FROM app.agent_session_grants ON CONFLICT DO NOTHING;
INSERT INTO app.agent_session_grant_events(tenant_id,grant_id,event_type,details,occurred_at)
SELECT tenant_id,grant_id,status,jsonb_build_object('environment',environment),COALESCE(consumed_at,revoked_at,created_at)
FROM app.agent_session_grants WHERE status IN ('consumed','revoked') ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION app.consume_agent_session_grant(
  selected_tenant_id uuid,selected_grant_id uuid,selected_subject_id uuid,selected_shop_ids uuid[],
  selected_role text,selected_environment text,selected_issued_at timestamptz,selected_expires_at timestamptz
) RETURNS TABLE(grant_id uuid,consumed_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE stored app.agent_session_grants%ROWTYPE;attempt_count integer;window_start timestamptz:=date_trunc('minute',clock_timestamp());
BEGIN
  IF selected_tenant_id IS NULL OR selected_grant_id IS NULL OR selected_subject_id IS NULL
    OR selected_role NOT IN ('owner','finance','operator','marketing','auditor')
    OR selected_environment NOT IN ('development','staging')
    OR cardinality(selected_shop_ids) NOT BETWEEN 1 AND 20
  THEN RETURN; END IF;

  SELECT * INTO stored FROM app.agent_session_grants g
  WHERE g.tenant_id=selected_tenant_id AND g.grant_id=selected_grant_id
    AND g.subject_id=selected_subject_id AND g.shop_ids=selected_shop_ids
    AND g.role=selected_role AND g.environment=selected_environment
    AND g.issued_at=selected_issued_at AND g.expires_at=selected_expires_at
  FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  INSERT INTO private.agent_session_grant_rate_limits(tenant_id,grant_id,window_started_at,attempts)
  VALUES(selected_tenant_id,selected_grant_id,window_start,1)
  ON CONFLICT ON CONSTRAINT agent_session_grant_rate_limits_pkey DO UPDATE
    SET attempts=private.agent_session_grant_rate_limits.attempts+1,updated_at=clock_timestamp()
  RETURNING private.agent_session_grant_rate_limits.attempts INTO attempt_count;
  IF attempt_count>5 THEN
    INSERT INTO app.agent_session_grant_events(tenant_id,grant_id,event_type,window_started_at,details)
    VALUES(selected_tenant_id,selected_grant_id,'rate_limited',window_start,jsonb_build_object('limit',5,'windowSeconds',60))
    ON CONFLICT DO NOTHING;
    RETURN;
  END IF;

  IF stored.status='active' AND stored.expires_at>clock_timestamp() THEN
    RETURN QUERY UPDATE app.agent_session_grants g SET status='consumed',consumed_at=clock_timestamp()
    WHERE g.tenant_id=selected_tenant_id AND g.grant_id=selected_grant_id AND g.status='active'
    RETURNING g.grant_id,g.consumed_at;
    IF FOUND THEN
      INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details)
      VALUES(selected_tenant_id,gen_random_uuid(),selected_subject_id,'agent.session_grant.consumed',selected_grant_id,
        jsonb_build_object('environment',selected_environment,'shopIds',selected_shop_ids));
    END IF;
    RETURN;
  END IF;
  IF stored.status='consumed' THEN
    INSERT INTO app.agent_session_grant_events(tenant_id,grant_id,event_type,details)
    VALUES(selected_tenant_id,selected_grant_id,'replay',jsonb_build_object('environment',selected_environment));
  ELSIF stored.status='active' AND stored.expires_at<=clock_timestamp() THEN
    INSERT INTO app.agent_session_grant_events(tenant_id,grant_id,event_type,details)
    VALUES(selected_tenant_id,selected_grant_id,'expired',jsonb_build_object('environment',selected_environment))
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

CREATE FUNCTION app.agent_session_grant_metrics(selected_window_minutes integer DEFAULT 60)
RETURNS TABLE(event_type text,event_count bigint) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=app.tenant_id();actor_role text:=app.member_role(app.tenant_id());
BEGIN
  IF t IS NULL OR actor_role NOT IN ('owner','auditor') OR selected_window_minutes NOT BETWEEN 1 AND 10080
  THEN RAISE EXCEPTION 'AGENT_SESSION_GRANT_METRICS_FORBIDDEN'; END IF;
  RETURN QUERY
    SELECT names.event_name,COALESCE(counts.event_count,0) FROM
      unnest(ARRAY['issued','consumed','replay','revoked','expired','rate_limited']::text[]) AS names(event_name)
    LEFT JOIN (
      SELECT e.event_type,count(*)::bigint AS event_count FROM app.agent_session_grant_events e
      WHERE e.tenant_id=t AND e.occurred_at>=clock_timestamp()-make_interval(mins=>selected_window_minutes)
      GROUP BY e.event_type
    ) counts ON counts.event_type=event_name;
END $$;

CREATE FUNCTION app.maintain_agent_session_grants(selected_batch_size integer DEFAULT 500)
RETURNS TABLE(expired_recorded integer,grants_deleted integer,events_deleted integer,rate_limits_deleted integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE expired_count integer:=0;grant_count integer:=0;event_count integer:=0;rate_count integer:=0;
BEGIN
  IF session_user<>'commerce_queue' OR selected_batch_size NOT BETWEEN 1 AND 2000
  THEN RAISE EXCEPTION 'AGENT_SESSION_GRANT_MAINTENANCE_FORBIDDEN'; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtext('commerce-agent-session-grant-maintenance')) THEN
    RETURN QUERY SELECT 0,0,0,0;RETURN;
  END IF;
  WITH candidates AS (
    SELECT tenant_id,grant_id,environment FROM app.agent_session_grants
    WHERE status='active' AND expires_at<=clock_timestamp()
    ORDER BY expires_at LIMIT selected_batch_size
  ), inserted AS (
    INSERT INTO app.agent_session_grant_events(tenant_id,grant_id,event_type,details)
    SELECT tenant_id,grant_id,'expired',jsonb_build_object('environment',environment) FROM candidates
    ON CONFLICT DO NOTHING RETURNING 1
  ) SELECT count(*)::integer INTO expired_count FROM inserted;

  WITH candidates AS (
    SELECT tenant_id,grant_id FROM app.agent_session_grants
    WHERE (status='consumed' AND consumed_at<clock_timestamp()-interval '30 days')
       OR (status='revoked' AND revoked_at<clock_timestamp()-interval '30 days')
       OR (status='active' AND expires_at<clock_timestamp()-interval '7 days')
    ORDER BY created_at LIMIT selected_batch_size
  ), deleted AS (
    DELETE FROM app.agent_session_grants g USING candidates c
    WHERE g.tenant_id=c.tenant_id AND g.grant_id=c.grant_id RETURNING 1
  ) SELECT count(*)::integer INTO grant_count FROM deleted;

  WITH candidates AS (
    SELECT ctid FROM app.agent_session_grant_events
    WHERE occurred_at<clock_timestamp()-interval '90 days'
    ORDER BY occurred_at LIMIT selected_batch_size
  ), deleted AS (
    DELETE FROM app.agent_session_grant_events e USING candidates c WHERE e.ctid=c.ctid RETURNING 1
  ) SELECT count(*)::integer INTO event_count FROM deleted;

  WITH candidates AS (
    SELECT ctid FROM private.agent_session_grant_rate_limits
    WHERE updated_at<clock_timestamp()-interval '1 day'
    ORDER BY updated_at LIMIT selected_batch_size
  ), deleted AS (
    DELETE FROM private.agent_session_grant_rate_limits r USING candidates c WHERE r.ctid=c.ctid RETURNING 1
  ) SELECT count(*)::integer INTO rate_count FROM deleted;
  RETURN QUERY SELECT expired_count,grant_count,event_count,rate_count;
END $$;

REVOKE ALL ON app.agent_session_grant_events FROM PUBLIC;
REVOKE ALL ON private.agent_session_grant_rate_limits FROM PUBLIC;
REVOKE ALL ON FUNCTION app.record_agent_session_grant_transition() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.consume_agent_session_grant(uuid,uuid,uuid,uuid[],text,text,timestamptz,timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.agent_session_grant_metrics(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.maintain_agent_session_grants(integer) FROM PUBLIC;
GRANT SELECT ON app.agent_session_grant_events TO commerce_app;
GRANT EXECUTE ON FUNCTION app.consume_agent_session_grant(uuid,uuid,uuid,uuid[],text,text,timestamptz,timestamptz) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.agent_session_grant_metrics(integer) TO commerce_app;
GRANT USAGE ON SCHEMA app TO commerce_queue;
GRANT EXECUTE ON FUNCTION app.maintain_agent_session_grants(integer) TO commerce_queue;

COMMENT ON FUNCTION app.maintain_agent_session_grants(integer) IS
  'Records expired grants, deletes expired active grants after 7 days, terminal grants after 30 days, telemetry after 90 days and rate buckets after 1 day.';
