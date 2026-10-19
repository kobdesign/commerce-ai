-- INT-AG-01c: human-confirmed operational review and replay requests.
ALTER TABLE app.integration_inbox_events
  ADD COLUMN operational_status text NOT NULL DEFAULT 'observed' CHECK(operational_status IN ('observed','open','replay_requested','resolved')),
  ADD COLUMN resolution_action text CHECK(resolution_action IS NULL OR resolution_action IN ('request_replay','acknowledge')),
  ADD COLUMN resolution_reason text CHECK(resolution_reason IS NULL OR length(resolution_reason) BETWEEN 3 AND 500),
  ADD COLUMN resolved_by uuid REFERENCES private.users(id),
  ADD COLUMN resolved_at timestamptz,
  ADD CONSTRAINT integration_inbox_operational_state CHECK(
    (operational_status IN ('observed','open') AND resolution_action IS NULL AND resolution_reason IS NULL AND resolved_by IS NULL AND resolved_at IS NULL)
    OR (operational_status='replay_requested' AND resolution_action='request_replay' AND resolution_reason IS NOT NULL AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)
    OR (operational_status='resolved' AND resolution_action='acknowledge' AND resolution_reason IS NOT NULL AND resolved_by IS NOT NULL AND resolved_at IS NOT NULL)
  );
UPDATE app.integration_inbox_events SET operational_status='open' WHERE reconciliation_status IN ('needs_review','rejected');

CREATE FUNCTION app.set_integration_inbox_operational_status() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    NEW.operational_status:=CASE WHEN NEW.reconciliation_status='ready' THEN 'observed' ELSE 'open' END;
  ELSIF NEW.reconciliation_status='ready' AND OLD.reconciliation_status<>'ready' AND OLD.operational_status='open' THEN
    NEW.operational_status:='observed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER integration_inbox_operational_status BEFORE INSERT OR UPDATE OF reconciliation_status ON app.integration_inbox_events
  FOR EACH ROW EXECUTE FUNCTION app.set_integration_inbox_operational_status();

CREATE TABLE app.integration_inbox_actions (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  inbox_event_id uuid NOT NULL,
  action text NOT NULL CHECK(action IN ('request_replay','acknowledge')),
  reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),
  actor_id uuid NOT NULL REFERENCES private.users(id),
  event_version integer NOT NULL CHECK(event_version>1),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,inbox_event_id,event_version),
  FOREIGN KEY(tenant_id,inbox_event_id) REFERENCES app.integration_inbox_events(tenant_id,id)
);
CREATE INDEX integration_inbox_actions_event_idx ON app.integration_inbox_actions(tenant_id,inbox_event_id,created_at DESC);
CREATE INDEX integration_inbox_operational_idx ON app.integration_inbox_events(tenant_id,shop_id,operational_status,received_at,position);

ALTER TABLE app.integration_inbox_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.integration_inbox_actions FORCE ROW LEVEL SECURITY;
CREATE POLICY integration_inbox_actions_read ON app.integration_inbox_actions FOR SELECT TO commerce_app USING(
  tenant_id=app.tenant_id() AND app.member_role(tenant_id) IN ('owner','operator','auditor') AND EXISTS(
    SELECT 1 FROM app.integration_inbox_events e WHERE e.tenant_id=integration_inbox_actions.tenant_id
      AND e.id=integration_inbox_actions.inbox_event_id AND app.shop_allowed(e.tenant_id,e.shop_id)
  )
);

CREATE FUNCTION app.transition_integration_inbox_event(
  selected_shop uuid,selected_event uuid,expected_version integer,selected_action text,selected_reason text
) RETURNS TABLE(id uuid,operational_status text,version integer,action_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_event app.integration_inbox_events%ROWTYPE; next_status text; next_version integer; new_action_id uuid:=gen_random_uuid(); event_name text;
BEGIN
  IF app.tenant_id() IS NULL OR app.actor_id() IS NULL OR expected_version<1
    OR selected_action NOT IN ('request_replay','acknowledge') OR length(btrim(selected_reason)) NOT BETWEEN 3 AND 500
    OR app.member_role(app.tenant_id()) NOT IN ('owner','operator') OR NOT app.shop_allowed(app.tenant_id(),selected_shop)
  THEN RAISE EXCEPTION 'INBOX_ACTION_FORBIDDEN'; END IF;

  SELECT e.* INTO current_event FROM app.integration_inbox_events e
  WHERE e.tenant_id=app.tenant_id() AND e.shop_id=selected_shop AND e.id=selected_event FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'INBOX_EVENT_NOT_FOUND'; END IF;
  IF current_event.version<>expected_version THEN RAISE EXCEPTION 'STALE_INBOX_EVENT'; END IF;
  IF current_event.operational_status='resolved' THEN RAISE EXCEPTION 'INBOX_EVENT_RESOLVED'; END IF;
  IF selected_action='request_replay' THEN
    IF current_event.operational_status='replay_requested' THEN RAISE EXCEPTION 'INBOX_REPLAY_ALREADY_REQUESTED'; END IF;
    IF current_event.signature_status<>'verified' THEN RAISE EXCEPTION 'INBOX_SIGNATURE_NOT_VERIFIED'; END IF;
    next_status:='replay_requested';event_name:='integration.inbox_replay_requested.v1';
  ELSE
    IF current_event.operational_status NOT IN ('open','replay_requested') THEN RAISE EXCEPTION 'INBOX_EVENT_NOT_OPEN'; END IF;
    next_status:='resolved';event_name:='integration.inbox_resolved.v1';
  END IF;
  next_version:=current_event.version+1;

  UPDATE app.integration_inbox_events e SET operational_status=next_status,resolution_action=selected_action,
    resolution_reason=btrim(selected_reason),resolved_by=app.actor_id(),resolved_at=clock_timestamp(),version=next_version,updated_at=clock_timestamp()
  WHERE e.tenant_id=app.tenant_id() AND e.id=current_event.id;
  INSERT INTO app.integration_inbox_actions(tenant_id,id,inbox_event_id,action,reason,actor_id,event_version)
  VALUES(app.tenant_id(),new_action_id,current_event.id,selected_action,btrim(selected_reason),app.actor_id(),next_version);
  PERFORM app.emit_integration_event(app.tenant_id(),selected_shop,event_name,'integration_inbox_event',current_event.id,next_version,
    jsonb_build_object('schemaVersion',1,'inboxEventId',current_event.id,'shopId',selected_shop,'providerNamespace',current_event.provider_namespace,
      'providerEventId',current_event.provider_event_id,'reconciliationStatus',current_event.reconciliation_status,
      'operationalStatus',next_status,'requestedAction',selected_action,'version',next_version));
  RETURN QUERY SELECT current_event.id,next_status,next_version,new_action_id;
END $$;

REVOKE ALL ON app.integration_inbox_actions FROM PUBLIC;
REVOKE ALL ON FUNCTION app.transition_integration_inbox_event(uuid,uuid,integer,text,text) FROM PUBLIC;
GRANT SELECT ON app.integration_inbox_actions TO commerce_app;
GRANT EXECUTE ON FUNCTION app.transition_integration_inbox_event(uuid,uuid,integer,text,text) TO commerce_app;
