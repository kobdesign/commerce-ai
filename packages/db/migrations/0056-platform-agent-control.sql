-- Platform-owned, tenant-scoped AI routing. Deployment flags remain only as
-- global availability and emergency controls; tenant enrollment is durable.

CREATE TABLE private.platform_operators (
  user_id uuid PRIMARY KEY REFERENCES private.users(id),
  role text NOT NULL CHECK(role='platform_owner'),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION app.is_platform_owner()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT EXISTS(
    SELECT 1 FROM private.platform_operators p
    JOIN private.users u ON u.id=p.user_id
    WHERE p.user_id=app.actor_id() AND p.role='platform_owner' AND p.active AND u.active
  )
$$;

ALTER TABLE app.agent_route_policy_events DROP CONSTRAINT agent_route_policy_events_actor_role_check;
ALTER TABLE app.agent_route_policy_events ADD CONSTRAINT agent_route_policy_events_actor_role_check
  CHECK(actor_role IN ('owner','auditor','platform_owner'));
ALTER TABLE app.agent_route_policy_events DROP CONSTRAINT agent_route_policy_events_action_check;
ALTER TABLE app.agent_route_policy_events ADD CONSTRAINT agent_route_policy_events_action_check
  CHECK(action IN ('proposed','approved','activated','revoked'));

CREATE FUNCTION app.platform_agent_route_workspace()
RETURNS TABLE(
  tenant_id uuid,tenant_name text,shop_count bigint,policy_id uuid,environment text,data_scope text,
  status text,version integer,expires_at timestamptz,reason text,updated_at timestamptz,
  event_count bigint,last_action text,last_event_at timestamptz
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT app.is_platform_owner() THEN RAISE EXCEPTION 'PLATFORM_OWNER_FORBIDDEN'; END IF;
  RETURN QUERY
  SELECT t.id,t.name,(SELECT count(*) FROM app.shops s WHERE s.tenant_id=t.id),p.id,p.environment,p.data_scope,
    p.status,p.version,p.expires_at,p.reason,p.updated_at,
    (SELECT count(*) FROM app.agent_route_policy_events e WHERE e.tenant_id=t.id),
    (SELECT e.action FROM app.agent_route_policy_events e WHERE e.tenant_id=t.id ORDER BY e.created_at DESC,e.id DESC LIMIT 1),
    (SELECT e.created_at FROM app.agent_route_policy_events e WHERE e.tenant_id=t.id ORDER BY e.created_at DESC,e.id DESC LIMIT 1)
  FROM app.tenants t LEFT JOIN app.agent_route_policies p ON p.tenant_id=t.id
  ORDER BY t.name,t.id;
END $$;

CREATE FUNCTION app.platform_activate_agent_route_policy(
  selected_tenant_id uuid,expected_version integer,selected_environment text,
  selected_expires_at timestamptz,selected_reason text
) RETURNS SETOF app.agent_route_policies LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_policy app.agent_route_policies%ROWTYPE;next_policy app.agent_route_policies%ROWTYPE;actor uuid:=app.actor_id();
BEGIN
  IF actor IS NULL OR NOT app.is_platform_owner() THEN RAISE EXCEPTION 'PLATFORM_OWNER_FORBIDDEN'; END IF;
  IF NOT EXISTS(SELECT 1 FROM app.tenants t WHERE t.id=selected_tenant_id)
    OR expected_version<0 OR selected_environment NOT IN ('development','staging')
    OR selected_expires_at<=clock_timestamp()+interval '5 minutes'
    OR selected_expires_at>clock_timestamp()+interval '24 hours'
    OR length(btrim(selected_reason)) NOT BETWEEN 10 AND 500
  THEN RAISE EXCEPTION 'AGENT_ROUTE_INVALID'; END IF;

  SELECT * INTO current_policy FROM app.agent_route_policies p WHERE p.tenant_id=selected_tenant_id FOR UPDATE;
  IF NOT FOUND THEN
    IF expected_version<>0 THEN RAISE EXCEPTION 'AGENT_ROUTE_STALE'; END IF;
    INSERT INTO app.agent_route_policies(
      tenant_id,id,environment,status,version,requested_by,requested_at,approved_by,approved_at,expires_at,reason
    ) VALUES(
      selected_tenant_id,gen_random_uuid(),selected_environment,'active',1,actor,clock_timestamp(),actor,clock_timestamp(),selected_expires_at,btrim(selected_reason)
    ) RETURNING * INTO next_policy;
  ELSE
    IF current_policy.version<>expected_version THEN RAISE EXCEPTION 'AGENT_ROUTE_STALE'; END IF;
    UPDATE app.agent_route_policies SET environment=selected_environment,status='active',version=version+1,
      requested_by=actor,requested_at=clock_timestamp(),approved_by=actor,approved_at=clock_timestamp(),
      expires_at=selected_expires_at,revoked_by=NULL,revoked_at=NULL,reason=btrim(selected_reason),updated_at=clock_timestamp()
    WHERE tenant_id=selected_tenant_id RETURNING * INTO next_policy;
  END IF;

  INSERT INTO app.agent_route_policy_events(tenant_id,id,policy_id,policy_version,actor_id,actor_role,action,reason,snapshot)
  VALUES(selected_tenant_id,gen_random_uuid(),next_policy.id,next_policy.version,actor,'platform_owner','activated',btrim(selected_reason),to_jsonb(next_policy)-'tenant_id');
  INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details)
  VALUES(selected_tenant_id,gen_random_uuid(),actor,'agent.route.platform_activated',next_policy.id,
    jsonb_build_object('version',next_policy.version,'environment',selected_environment,'expiresAt',selected_expires_at,'dataScope','synthetic'));
  RETURN NEXT next_policy;
END $$;

CREATE FUNCTION app.platform_revoke_agent_route_policy(
  selected_tenant_id uuid,expected_version integer,selected_reason text
) RETURNS SETOF app.agent_route_policies LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE current_policy app.agent_route_policies%ROWTYPE;next_policy app.agent_route_policies%ROWTYPE;actor uuid:=app.actor_id();
BEGIN
  IF actor IS NULL OR NOT app.is_platform_owner() THEN RAISE EXCEPTION 'PLATFORM_OWNER_FORBIDDEN'; END IF;
  IF expected_version<1 OR length(btrim(selected_reason)) NOT BETWEEN 10 AND 500 THEN RAISE EXCEPTION 'AGENT_ROUTE_INVALID'; END IF;
  SELECT * INTO current_policy FROM app.agent_route_policies p WHERE p.tenant_id=selected_tenant_id FOR UPDATE;
  IF NOT FOUND OR current_policy.version<>expected_version THEN RAISE EXCEPTION 'AGENT_ROUTE_STALE'; END IF;
  IF current_policy.status='revoked' THEN RAISE EXCEPTION 'AGENT_ROUTE_ALREADY_REVOKED'; END IF;

  UPDATE app.agent_route_policies SET status='revoked',version=version+1,revoked_by=actor,revoked_at=clock_timestamp(),
    reason=btrim(selected_reason),updated_at=clock_timestamp() WHERE tenant_id=selected_tenant_id RETURNING * INTO next_policy;
  UPDATE app.agent_session_grants SET status='revoked',revoked_by=actor,revoked_at=clock_timestamp(),revocation_reason=btrim(selected_reason)
    WHERE tenant_id=selected_tenant_id AND status='active';
  UPDATE app.agent_sessions SET status='revoked',revoked_by=actor,revoked_at=clock_timestamp(),revocation_reason=btrim(selected_reason)
    WHERE tenant_id=selected_tenant_id AND status='active';
  INSERT INTO app.agent_route_policy_events(tenant_id,id,policy_id,policy_version,actor_id,actor_role,action,reason,snapshot)
  VALUES(selected_tenant_id,gen_random_uuid(),next_policy.id,next_policy.version,actor,'platform_owner','revoked',btrim(selected_reason),to_jsonb(next_policy)-'tenant_id');
  INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details)
  VALUES(selected_tenant_id,gen_random_uuid(),actor,'agent.route.platform_revoked',next_policy.id,
    jsonb_build_object('version',next_policy.version,'previousStatus',current_policy.status,'dataScope','synthetic','activeSessionsRevoked',true));
  RETURN NEXT next_policy;
END $$;

REVOKE ALL ON private.platform_operators FROM PUBLIC;
REVOKE ALL ON FUNCTION app.is_platform_owner() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.platform_agent_route_workspace() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.platform_activate_agent_route_policy(uuid,integer,text,timestamptz,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.platform_revoke_agent_route_policy(uuid,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.is_platform_owner() TO commerce_app;
GRANT EXECUTE ON FUNCTION app.platform_agent_route_workspace() TO commerce_app;
GRANT EXECUTE ON FUNCTION app.platform_activate_agent_route_policy(uuid,integer,text,timestamptz,text) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.platform_revoke_agent_route_policy(uuid,integer,text) TO commerce_app;
