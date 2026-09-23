CREATE TABLE app.financial_review_task_drafts (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  id uuid NOT NULL,
  shop_id uuid NOT NULL,
  requester_id uuid NOT NULL REFERENCES private.users(id),
  proposed_by_run_id uuid,
  action_type text NOT NULL DEFAULT 'create_financial_review_task' CHECK(action_type='create_financial_review_task'),
  exception_id text NOT NULL CHECK(length(exception_id) BETWEEN 1 AND 300),
  exception_kind text NOT NULL CHECK(exception_kind IN ('unmatched_statement_line','order_difference','payout_difference','insufficient_payout_evidence')),
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 180),
  reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),
  assignee_id uuid NOT NULL REFERENCES private.users(id),
  period_from date NOT NULL,
  period_to date NOT NULL CHECK(period_to>=period_from AND period_to-period_from<=366),
  evidence_snapshot jsonb NOT NULL CHECK(jsonb_typeof(evidence_snapshot)='object'),
  evidence_hash text NOT NULL CHECK(evidence_hash ~ '^[0-9a-f]{64}$'),
  payload_hash text NOT NULL CHECK(payload_hash ~ '^[0-9a-f]{64}$'),
  evidence_version text NOT NULL CHECK(length(evidence_version) BETWEEN 1 AND 100),
  policy_version text NOT NULL CHECK(length(policy_version) BETWEEN 1 AND 100),
  status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','confirmed','rejected','expired','stale')),
  confirmed_task_id uuid,
  confirmation_key uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '20 minutes',
  confirmed_at timestamptz,
  PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,shop_id) REFERENCES app.shops(tenant_id,id),
  FOREIGN KEY(tenant_id,proposed_by_run_id) REFERENCES app.ai_runs(tenant_id,id)
);

CREATE TABLE app.financial_review_tasks (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  id uuid NOT NULL,
  shop_id uuid NOT NULL,
  source_draft_id uuid NOT NULL,
  exception_id text NOT NULL CHECK(length(exception_id) BETWEEN 1 AND 300),
  exception_kind text NOT NULL CHECK(exception_kind IN ('unmatched_statement_line','order_difference','payout_difference','insufficient_payout_evidence')),
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 180),
  reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 500),
  assignee_id uuid NOT NULL REFERENCES private.users(id),
  status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved','cancelled')),
  evidence_snapshot jsonb NOT NULL CHECK(jsonb_typeof(evidence_snapshot)='object'),
  evidence_hash text NOT NULL CHECK(evidence_hash ~ '^[0-9a-f]{64}$'),
  evidence_version text NOT NULL CHECK(length(evidence_version) BETWEEN 1 AND 100),
  policy_version text NOT NULL CHECK(length(policy_version) BETWEEN 1 AND 100),
  proposed_by_run_id uuid,
  proposed_by uuid NOT NULL REFERENCES private.users(id),
  approved_by uuid NOT NULL REFERENCES private.users(id),
  executed_by uuid NOT NULL REFERENCES private.users(id),
  confirmation_key uuid NOT NULL,
  outcome text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,source_draft_id),
  UNIQUE(tenant_id,shop_id,confirmation_key),
  FOREIGN KEY(tenant_id,shop_id) REFERENCES app.shops(tenant_id,id),
  FOREIGN KEY(tenant_id,source_draft_id) REFERENCES app.financial_review_task_drafts(tenant_id,id),
  FOREIGN KEY(tenant_id,proposed_by_run_id) REFERENCES app.ai_runs(tenant_id,id)
);

ALTER TABLE app.financial_review_task_drafts
  ADD FOREIGN KEY(tenant_id,confirmed_task_id) REFERENCES app.financial_review_tasks(tenant_id,id);

CREATE UNIQUE INDEX financial_review_tasks_one_active_exception
  ON app.financial_review_tasks(tenant_id,shop_id,exception_id)
  WHERE status IN ('open','in_progress');
CREATE INDEX financial_review_tasks_shop_time
  ON app.financial_review_tasks(tenant_id,shop_id,updated_at DESC);
CREATE INDEX financial_review_drafts_shop_time
  ON app.financial_review_task_drafts(tenant_id,shop_id,created_at DESC);

CREATE TABLE app.financial_review_task_events (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  id uuid NOT NULL,
  task_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES private.users(id),
  from_status text,
  to_status text NOT NULL CHECK(to_status IN ('open','in_progress','resolved','cancelled')),
  reason text NOT NULL DEFAULT '' CHECK(length(reason)<=500),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,task_id) REFERENCES app.financial_review_tasks(tenant_id,id)
);
CREATE INDEX financial_review_task_events_task_time
  ON app.financial_review_task_events(tenant_id,task_id,created_at);

ALTER TABLE app.financial_review_task_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.financial_review_task_drafts FORCE ROW LEVEL SECURITY;
ALTER TABLE app.financial_review_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.financial_review_tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE app.financial_review_task_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.financial_review_task_events FORCE ROW LEVEL SECURITY;

CREATE POLICY financial_review_drafts_read ON app.financial_review_task_drafts FOR SELECT USING(
  tenant_id=app.tenant_id() AND app.shop_allowed(tenant_id,shop_id)
  AND app.member_role(tenant_id) IN ('owner','finance','auditor')
);
CREATE POLICY financial_review_tasks_read ON app.financial_review_tasks FOR SELECT USING(
  tenant_id=app.tenant_id() AND app.shop_allowed(tenant_id,shop_id)
  AND app.member_role(tenant_id) IN ('owner','finance','auditor')
);
CREATE POLICY financial_review_task_events_read ON app.financial_review_task_events FOR SELECT USING(
  tenant_id=app.tenant_id() AND EXISTS(
    SELECT 1 FROM app.financial_review_tasks task
    WHERE task.tenant_id=financial_review_task_events.tenant_id
      AND task.id=financial_review_task_events.task_id
      AND app.shop_allowed(task.tenant_id,task.shop_id)
  ) AND app.member_role(tenant_id) IN ('owner','finance','auditor')
);

CREATE FUNCTION app.financial_review_assignee_allowed(t uuid,s uuid,u uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(
    SELECT 1 FROM app.memberships m JOIN private.users p ON p.id=m.user_id
    JOIN app.shops sh ON sh.tenant_id=m.tenant_id AND sh.id=s
    WHERE m.tenant_id=t AND m.user_id=u AND m.active AND p.active
      AND m.role IN ('owner','finance')
      AND (m.all_shops OR EXISTS(
        SELECT 1 FROM app.shop_grants g
        WHERE g.tenant_id=t AND g.user_id=u AND g.shop_id=s
      ))
  )
$$;

CREATE FUNCTION app.financial_review_assignees(s uuid)
RETURNS TABLE(user_id uuid,name text,role text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=app.tenant_id();
BEGIN
  IF t IS NULL OR NOT app.shop_allowed(t,s)
    OR app.member_role(t) NOT IN ('owner','finance','auditor') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN QUERY
    SELECT p.id,p.name,m.role FROM app.memberships m JOIN private.users p ON p.id=m.user_id
    WHERE m.tenant_id=t AND app.financial_review_assignee_allowed(t,s,m.user_id)
    ORDER BY p.name,p.id;
END $$;

CREATE FUNCTION app.reserve_financial_review_draft(
  s uuid, exception_ref text, exception_type text, task_title text, task_reason text,
  assignee uuid, from_date date, to_date date, evidence jsonb, evidence_fingerprint text,
  payload_fingerprint text, evidence_name text, policy_name text, source_run uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=app.tenant_id(); actor uuid:=app.actor_id(); draft uuid:=gen_random_uuid();
BEGIN
  IF t IS NULL OR actor IS NULL OR NOT app.shop_allowed(t,s)
    OR app.member_role(t) NOT IN ('owner','finance') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF NOT app.financial_review_assignee_allowed(t,s,assignee) THEN RAISE EXCEPTION 'INVALID_ASSIGNEE'; END IF;
  IF exception_type NOT IN ('unmatched_statement_line','order_difference','payout_difference','insufficient_payout_evidence')
    OR length(exception_ref) NOT BETWEEN 1 AND 300 OR length(task_title) NOT BETWEEN 1 AND 180
    OR length(task_reason) NOT BETWEEN 3 AND 500 OR to_date<from_date OR to_date-from_date>366
    OR jsonb_typeof(evidence) IS DISTINCT FROM 'object'
    OR evidence_fingerprint !~ '^[0-9a-f]{64}$' OR payload_fingerprint !~ '^[0-9a-f]{64}$'
  THEN RAISE EXCEPTION 'INVALID_DRAFT'; END IF;
  IF source_run IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM app.ai_runs r WHERE r.tenant_id=t AND r.id=source_run AND r.shop_id=s
      AND r.actor_id=actor AND r.status='succeeded' AND r.workflow_version='settlement-review-v1'
  ) THEN RAISE EXCEPTION 'INVALID_SOURCE_RUN'; END IF;
  INSERT INTO app.financial_review_task_drafts(
    tenant_id,id,shop_id,requester_id,proposed_by_run_id,exception_id,exception_kind,title,reason,
    assignee_id,period_from,period_to,evidence_snapshot,evidence_hash,payload_hash,evidence_version,policy_version
  ) VALUES(t,draft,s,actor,source_run,exception_ref,exception_type,task_title,task_reason,
    assignee,from_date,to_date,evidence,evidence_fingerprint,payload_fingerprint,evidence_name,policy_name);
  INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details)
    VALUES(t,gen_random_uuid(),actor,'financial_review.draft.created',draft,
      jsonb_build_object('shopId',s,'exceptionId',exception_ref,'assigneeId',assignee,'sourceRunId',source_run));
  RETURN draft;
END $$;

CREATE FUNCTION app.confirm_financial_review_draft(
  draft_ref uuid, s uuid, expected_payload_hash text, current_evidence_hash text, confirm_key uuid
) RETURNS TABLE(outcome text,task_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  t uuid:=app.tenant_id(); actor uuid:=app.actor_id(); d app.financial_review_task_drafts%ROWTYPE;
  existing uuid; created uuid:=gen_random_uuid();
BEGIN
  IF t IS NULL OR actor IS NULL OR NOT app.shop_allowed(t,s)
    OR app.member_role(t) NOT IN ('owner','finance') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  PERFORM pg_advisory_xact_lock(hashtext(t::text||':'||draft_ref::text));
  SELECT * INTO d FROM app.financial_review_task_drafts
    WHERE tenant_id=t AND id=draft_ref AND shop_id=s FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'DRAFT_NOT_FOUND'; END IF;
  IF d.status='confirmed' AND d.confirmed_task_id IS NOT NULL THEN
    RETURN QUERY SELECT 'existing'::text,d.confirmed_task_id; RETURN;
  END IF;
  IF d.status<>'draft' THEN RAISE EXCEPTION 'DRAFT_NOT_CONFIRMABLE'; END IF;
  IF d.expires_at<=now() THEN
    UPDATE app.financial_review_task_drafts SET status='expired' WHERE tenant_id=t AND id=draft_ref;
    RETURN QUERY SELECT 'expired'::text,NULL::uuid; RETURN;
  END IF;
  IF d.payload_hash<>expected_payload_hash THEN RETURN QUERY SELECT 'payload_changed'::text,NULL::uuid; RETURN; END IF;
  IF d.evidence_hash<>current_evidence_hash THEN
    UPDATE app.financial_review_task_drafts SET status='stale' WHERE tenant_id=t AND id=draft_ref;
    INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details)
      VALUES(t,gen_random_uuid(),actor,'financial_review.draft.stale',draft_ref,jsonb_build_object('shopId',s,'exceptionId',d.exception_id));
    RETURN QUERY SELECT 'evidence_changed'::text,NULL::uuid; RETURN;
  END IF;
  IF NOT app.financial_review_assignee_allowed(t,s,d.assignee_id) THEN RETURN QUERY SELECT 'invalid_assignee'::text,NULL::uuid; RETURN; END IF;
  SELECT task.id INTO existing FROM app.financial_review_tasks task
    WHERE task.tenant_id=t AND task.shop_id=s AND task.confirmation_key=confirm_key;
  IF existing IS NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(t::text||':'||s::text||':'||d.exception_id));
    SELECT task.id INTO existing FROM app.financial_review_tasks task
      WHERE task.tenant_id=t AND task.shop_id=s AND task.exception_id=d.exception_id
        AND task.status IN ('open','in_progress') ORDER BY task.created_at LIMIT 1;
  END IF;
  IF existing IS NULL THEN
    INSERT INTO app.financial_review_tasks(
      tenant_id,id,shop_id,source_draft_id,exception_id,exception_kind,title,reason,assignee_id,status,
      evidence_snapshot,evidence_hash,evidence_version,policy_version,proposed_by_run_id,proposed_by,
      approved_by,executed_by,confirmation_key
    ) VALUES(t,created,s,d.id,d.exception_id,d.exception_kind,d.title,d.reason,d.assignee_id,'open',
      d.evidence_snapshot,d.evidence_hash,d.evidence_version,d.policy_version,d.proposed_by_run_id,d.requester_id,
      actor,actor,confirm_key);
    INSERT INTO app.financial_review_task_events(tenant_id,id,task_id,actor_id,from_status,to_status,reason)
      VALUES(t,gen_random_uuid(),created,actor,NULL,'open','สร้างจากร่างที่ผู้ใช้ยืนยัน');
    existing:=created; outcome:='created';
  ELSE outcome:='existing'; END IF;
  UPDATE app.financial_review_task_drafts SET status='confirmed',confirmed_task_id=existing,
    confirmation_key=confirm_key,confirmed_at=now() WHERE tenant_id=t AND id=draft_ref;
  INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details)
    VALUES(t,gen_random_uuid(),actor,'financial_review.task.confirmed',existing,
      jsonb_build_object('shopId',s,'draftId',draft_ref,'exceptionId',d.exception_id,'outcome',outcome));
  RETURN QUERY SELECT outcome,existing;
END $$;

CREATE FUNCTION app.change_financial_review_task_status(
  task_ref uuid, s uuid, next_status text, change_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=app.tenant_id(); actor uuid:=app.actor_id(); task app.financial_review_tasks%ROWTYPE;
BEGIN
  IF t IS NULL OR actor IS NULL OR NOT app.shop_allowed(t,s)
    OR app.member_role(t) NOT IN ('owner','finance') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  SELECT * INTO task FROM app.financial_review_tasks WHERE tenant_id=t AND id=task_ref AND shop_id=s FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'TASK_NOT_FOUND'; END IF;
  IF next_status NOT IN ('open','in_progress','resolved','cancelled')
    OR length(change_reason)>500 OR (next_status IN ('resolved','cancelled') AND length(trim(change_reason))<3)
  THEN RAISE EXCEPTION 'INVALID_TASK_CHANGE'; END IF;
  IF task.status IN ('resolved','cancelled') OR NOT (
    (task.status='open' AND next_status IN ('in_progress','resolved','cancelled')) OR
    (task.status='in_progress' AND next_status IN ('open','resolved','cancelled'))
  ) THEN RAISE EXCEPTION 'INVALID_TASK_TRANSITION'; END IF;
  UPDATE app.financial_review_tasks SET status=next_status,outcome=NULLIF(trim(change_reason),''),updated_at=now(),
    resolved_at=CASE WHEN next_status IN ('resolved','cancelled') THEN now() ELSE NULL END
    WHERE tenant_id=t AND id=task_ref;
  INSERT INTO app.financial_review_task_events(tenant_id,id,task_id,actor_id,from_status,to_status,reason)
    VALUES(t,gen_random_uuid(),task_ref,actor,task.status,next_status,trim(change_reason));
  INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details)
    VALUES(t,gen_random_uuid(),actor,'financial_review.task.status_changed',task_ref,
      jsonb_build_object('shopId',s,'from',task.status,'to',next_status,'reason',trim(change_reason)));
END $$;

REVOKE ALL ON FUNCTION app.financial_review_assignee_allowed(uuid,uuid,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.financial_review_assignees(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.reserve_financial_review_draft(uuid,text,text,text,text,uuid,date,date,jsonb,text,text,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.confirm_financial_review_draft(uuid,uuid,text,text,uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.change_financial_review_task_status(uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.financial_review_assignees(uuid) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.reserve_financial_review_draft(uuid,text,text,text,text,uuid,date,date,jsonb,text,text,text,text,uuid) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.confirm_financial_review_draft(uuid,uuid,text,text,uuid) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.change_financial_review_task_status(uuid,uuid,text,text) TO commerce_app;
GRANT SELECT ON app.financial_review_task_drafts,app.financial_review_tasks,app.financial_review_task_events TO commerce_app;

COMMENT ON TABLE app.financial_review_task_drafts IS 'Immutable human-review proposal. A model run may propose it but cannot confirm it.';
COMMENT ON TABLE app.financial_review_tasks IS 'Operational follow-up only. Status changes never mutate reconciliation or ledger records.';
