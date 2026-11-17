-- EVE-CANARY-02: synthetic-only, tenant-scoped route control plane.
-- Runtime roles can read effective state but all writes pass through the
-- SECURITY DEFINER transition functions below. Route events are append-only.

CREATE TABLE app.agent_route_policies (
  tenant_id uuid PRIMARY KEY REFERENCES app.tenants(id),
  id uuid NOT NULL,
  engine text NOT NULL DEFAULT 'eve' CHECK(engine='eve'),
  environment text NOT NULL CHECK(environment IN ('development','staging')),
  data_scope text NOT NULL DEFAULT 'synthetic' CHECK(data_scope='synthetic'),
  status text NOT NULL CHECK(status IN ('pending','active','revoked')),
  version integer NOT NULL CHECK(version>0),
  requested_by uuid NOT NULL REFERENCES private.users(id),
  requested_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  approved_by uuid REFERENCES private.users(id),
  approved_at timestamptz,
  expires_at timestamptz NOT NULL,
  revoked_by uuid REFERENCES private.users(id),
  revoked_at timestamptz,
  reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(tenant_id,id),
  CONSTRAINT agent_route_policy_state_check CHECK(
    (status='pending' AND approved_by IS NULL AND approved_at IS NULL AND revoked_by IS NULL AND revoked_at IS NULL)
    OR (status='active' AND approved_by IS NOT NULL AND approved_at IS NOT NULL AND revoked_by IS NULL AND revoked_at IS NULL)
    OR (status='revoked' AND revoked_by IS NOT NULL AND revoked_at IS NOT NULL)
  )
);

CREATE TABLE app.agent_route_policy_events (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  policy_id uuid NOT NULL,
  policy_version integer NOT NULL CHECK(policy_version>0),
  actor_id uuid NOT NULL REFERENCES private.users(id),
  actor_role text NOT NULL CHECK(actor_role IN ('owner','auditor')),
  action text NOT NULL CHECK(action IN ('proposed','approved','revoked')),
  reason text NOT NULL CHECK(length(reason) BETWEEN 10 AND 500),
  snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,policy_id,policy_version),
  FOREIGN KEY(tenant_id,policy_id) REFERENCES app.agent_route_policies(tenant_id,id)
);
CREATE INDEX agent_route_policy_events_time_idx ON app.agent_route_policy_events(tenant_id,created_at DESC);

ALTER TABLE app.agent_route_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.agent_route_policies NO FORCE ROW LEVEL SECURITY;
ALTER TABLE app.agent_route_policy_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.agent_route_policy_events NO FORCE ROW LEVEL SECURITY;

CREATE POLICY agent_route_policies_read ON app.agent_route_policies FOR SELECT TO commerce_app USING(
  tenant_id=app.tenant_id() AND app.member_role(tenant_id) IS NOT NULL
);
CREATE POLICY agent_route_policy_events_read ON app.agent_route_policy_events FOR SELECT TO commerce_app USING(
  tenant_id=app.tenant_id() AND app.member_role(tenant_id) IN ('owner','auditor')
);

-- Keep the policy row locked until the caller's transaction commits its
-- session-grant audit record. The runtime role receives EXECUTE only; it never
-- receives UPDATE privilege merely to satisfy PostgreSQL FOR SHARE semantics.
CREATE FUNCTION app.read_agent_route_policy_for_grant()
RETURNS SETOF app.agent_route_policies LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=app.tenant_id();
BEGIN
  IF t IS NULL OR app.actor_id() IS NULL OR app.member_role(t) IS NULL THEN RAISE EXCEPTION 'AGENT_ROUTE_FORBIDDEN'; END IF;
  RETURN QUERY SELECT p.* FROM app.agent_route_policies p WHERE p.tenant_id=t FOR SHARE;
END $$;

CREATE FUNCTION app.propose_agent_route_policy(
  expected_version integer,selected_environment text,selected_expires_at timestamptz,selected_reason text
) RETURNS SETOF app.agent_route_policies LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_policy app.agent_route_policies%ROWTYPE;next_policy app.agent_route_policies%ROWTYPE;actor uuid:=app.actor_id();t uuid:=app.tenant_id();
BEGIN
  IF t IS NULL OR actor IS NULL OR app.member_role(t)<>'owner' THEN RAISE EXCEPTION 'AGENT_ROUTE_FORBIDDEN'; END IF;
  IF expected_version<0 OR selected_environment NOT IN ('development','staging')
    OR selected_expires_at<=clock_timestamp()+interval '5 minutes'
    OR selected_expires_at>clock_timestamp()+interval '24 hours'
    OR length(btrim(selected_reason)) NOT BETWEEN 10 AND 500
  THEN RAISE EXCEPTION 'AGENT_ROUTE_INVALID'; END IF;

  SELECT * INTO current_policy FROM app.agent_route_policies p WHERE p.tenant_id=t FOR UPDATE;
  IF NOT FOUND THEN
    IF expected_version<>0 THEN RAISE EXCEPTION 'AGENT_ROUTE_STALE'; END IF;
    INSERT INTO app.agent_route_policies(tenant_id,id,environment,status,version,requested_by,expires_at,reason)
    VALUES(t,gen_random_uuid(),selected_environment,'pending',1,actor,selected_expires_at,btrim(selected_reason)) RETURNING * INTO next_policy;
  ELSE
    IF current_policy.version<>expected_version THEN RAISE EXCEPTION 'AGENT_ROUTE_STALE'; END IF;
    IF current_policy.status='active' AND current_policy.expires_at>clock_timestamp() THEN RAISE EXCEPTION 'AGENT_ROUTE_ACTIVE'; END IF;
    UPDATE app.agent_route_policies SET environment=selected_environment,status='pending',version=version+1,
      requested_by=actor,requested_at=clock_timestamp(),approved_by=NULL,approved_at=NULL,expires_at=selected_expires_at,
      revoked_by=NULL,revoked_at=NULL,reason=btrim(selected_reason),updated_at=clock_timestamp()
    WHERE tenant_id=t RETURNING * INTO next_policy;
  END IF;

  INSERT INTO app.agent_route_policy_events(tenant_id,id,policy_id,policy_version,actor_id,actor_role,action,reason,snapshot)
  VALUES(t,gen_random_uuid(),next_policy.id,next_policy.version,actor,'owner','proposed',btrim(selected_reason),to_jsonb(next_policy)-'tenant_id');
  INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details)
  VALUES(t,gen_random_uuid(),actor,'agent.route.proposed',next_policy.id,jsonb_build_object('version',next_policy.version,'environment',selected_environment,'expiresAt',selected_expires_at,'dataScope','synthetic'));
  RETURN NEXT next_policy;
END $$;

CREATE FUNCTION app.approve_agent_route_policy(
  expected_version integer,selected_reason text
) RETURNS SETOF app.agent_route_policies LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_policy app.agent_route_policies%ROWTYPE;next_policy app.agent_route_policies%ROWTYPE;actor uuid:=app.actor_id();t uuid:=app.tenant_id();
BEGIN
  IF t IS NULL OR actor IS NULL OR app.member_role(t)<>'auditor' THEN RAISE EXCEPTION 'AGENT_ROUTE_FORBIDDEN'; END IF;
  IF expected_version<1 OR length(btrim(selected_reason)) NOT BETWEEN 10 AND 500 THEN RAISE EXCEPTION 'AGENT_ROUTE_INVALID'; END IF;
  SELECT * INTO current_policy FROM app.agent_route_policies p WHERE p.tenant_id=t FOR UPDATE;
  IF NOT FOUND OR current_policy.version<>expected_version THEN RAISE EXCEPTION 'AGENT_ROUTE_STALE'; END IF;
  IF current_policy.status<>'pending' OR current_policy.expires_at<=clock_timestamp()+interval '1 minute'
    OR current_policy.requested_by=actor THEN RAISE EXCEPTION 'AGENT_ROUTE_NOT_APPROVABLE'; END IF;

  UPDATE app.agent_route_policies SET status='active',version=version+1,approved_by=actor,approved_at=clock_timestamp(),
    reason=btrim(selected_reason),updated_at=clock_timestamp() WHERE tenant_id=t RETURNING * INTO next_policy;
  INSERT INTO app.agent_route_policy_events(tenant_id,id,policy_id,policy_version,actor_id,actor_role,action,reason,snapshot)
  VALUES(t,gen_random_uuid(),next_policy.id,next_policy.version,actor,'auditor','approved',btrim(selected_reason),to_jsonb(next_policy)-'tenant_id');
  INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details)
  VALUES(t,gen_random_uuid(),actor,'agent.route.approved',next_policy.id,jsonb_build_object('version',next_policy.version,'environment',next_policy.environment,'expiresAt',next_policy.expires_at,'dataScope','synthetic'));
  RETURN NEXT next_policy;
END $$;

CREATE FUNCTION app.revoke_agent_route_policy(
  expected_version integer,selected_reason text
) RETURNS SETOF app.agent_route_policies LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_policy app.agent_route_policies%ROWTYPE;next_policy app.agent_route_policies%ROWTYPE;actor uuid:=app.actor_id();actor_role text; t uuid:=app.tenant_id();
BEGIN
  actor_role:=app.member_role(t);
  IF t IS NULL OR actor IS NULL OR actor_role NOT IN ('owner','auditor') THEN RAISE EXCEPTION 'AGENT_ROUTE_FORBIDDEN'; END IF;
  IF expected_version<1 OR length(btrim(selected_reason)) NOT BETWEEN 10 AND 500 THEN RAISE EXCEPTION 'AGENT_ROUTE_INVALID'; END IF;
  SELECT * INTO current_policy FROM app.agent_route_policies p WHERE p.tenant_id=t FOR UPDATE;
  IF NOT FOUND OR current_policy.version<>expected_version THEN RAISE EXCEPTION 'AGENT_ROUTE_STALE'; END IF;
  IF current_policy.status='revoked' THEN RAISE EXCEPTION 'AGENT_ROUTE_ALREADY_REVOKED'; END IF;

  UPDATE app.agent_route_policies SET status='revoked',version=version+1,revoked_by=actor,revoked_at=clock_timestamp(),
    reason=btrim(selected_reason),updated_at=clock_timestamp() WHERE tenant_id=t RETURNING * INTO next_policy;
  INSERT INTO app.agent_route_policy_events(tenant_id,id,policy_id,policy_version,actor_id,actor_role,action,reason,snapshot)
  VALUES(t,gen_random_uuid(),next_policy.id,next_policy.version,actor,actor_role,'revoked',btrim(selected_reason),to_jsonb(next_policy)-'tenant_id');
  INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details)
  VALUES(t,gen_random_uuid(),actor,'agent.route.revoked',next_policy.id,jsonb_build_object('version',next_policy.version,'previousStatus',current_policy.status,'environment',next_policy.environment,'dataScope','synthetic'));
  RETURN NEXT next_policy;
END $$;

REVOKE ALL ON app.agent_route_policies,app.agent_route_policy_events FROM PUBLIC;
REVOKE ALL ON FUNCTION app.read_agent_route_policy_for_grant() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.propose_agent_route_policy(integer,text,timestamptz,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.approve_agent_route_policy(integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.revoke_agent_route_policy(integer,text) FROM PUBLIC;
GRANT SELECT ON app.agent_route_policies,app.agent_route_policy_events TO commerce_app;
GRANT EXECUTE ON FUNCTION app.read_agent_route_policy_for_grant() TO commerce_app;
GRANT EXECUTE ON FUNCTION app.propose_agent_route_policy(integer,text,timestamptz,text) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.approve_agent_route_policy(integer,text) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.revoke_agent_route_policy(integer,text) TO commerce_app;
