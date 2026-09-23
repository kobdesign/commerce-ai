-- Keep AI workflow identity and its bounded request immutable from reservation time.
-- Existing catalog runs retain explicit legacy values rather than being reclassified.
ALTER TABLE app.ai_runs
  ADD COLUMN workflow_version text NOT NULL DEFAULT 'catalog-analysis-v1',
  ADD COLUMN tool_version text NOT NULL DEFAULT 'catalog-read-v1',
  ADD COLUMN policy_version text NOT NULL DEFAULT 'catalog-policy-v1',
  ADD COLUMN request jsonb NOT NULL DEFAULT '{}';

ALTER TABLE app.ai_runs
  ADD CONSTRAINT ai_runs_workflow_version_length CHECK (length(workflow_version) BETWEEN 1 AND 100),
  ADD CONSTRAINT ai_runs_tool_version_length CHECK (length(tool_version) BETWEEN 1 AND 100),
  ADD CONSTRAINT ai_runs_policy_version_length CHECK (length(policy_version) BETWEEN 1 AND 100),
  ADD CONSTRAINT ai_runs_request_object CHECK (jsonb_typeof(request)='object');

CREATE INDEX ai_runs_workflow_time_idx
  ON app.ai_runs(tenant_id,shop_id,workflow_version,created_at DESC);

CREATE FUNCTION app.reserve_ai_workflow_run(
  s uuid,
  m text,
  model_name text,
  workflow_name text,
  prompt_name text,
  tool_name text,
  policy_name text,
  request_data jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE
  t uuid:=app.tenant_id();
  actor uuid:=app.actor_id();
  run uuid:=gen_random_uuid();
  total integer;
BEGIN
  IF t IS NULL OR NOT app.shop_allowed(t,s) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF m NOT IN ('tool-preview','live') THEN RAISE EXCEPTION 'INVALID_MODE'; END IF;
  IF workflow_name IS NULL OR length(workflow_name) NOT BETWEEN 1 AND 100
    OR prompt_name IS NULL OR length(prompt_name) NOT BETWEEN 1 AND 100
    OR tool_name IS NULL OR length(tool_name) NOT BETWEEN 1 AND 100
    OR policy_name IS NULL OR length(policy_name) NOT BETWEEN 1 AND 100
    OR request_data IS NULL OR jsonb_typeof(request_data)<>'object'
  THEN RAISE EXCEPTION 'INVALID_RUN_METADATA'; END IF;

  PERFORM pg_advisory_xact_lock(hashtext(t::text));
  UPDATE app.ai_runs SET status='failed',error_code='EXPIRED',completed_at=now()
    WHERE tenant_id=t AND status='running' AND created_at<now()-interval '2 minutes';
  SELECT count(*) INTO total FROM app.ai_runs
    WHERE tenant_id=t AND mode=m AND created_at>now()-interval '24 hours';
  IF total >= (CASE WHEN m='live' THEN 20 ELSE 100 END) THEN RAISE EXCEPTION 'RUN_QUOTA'; END IF;
  IF m='live' AND EXISTS(
    SELECT 1 FROM app.ai_runs WHERE tenant_id=t AND status='running' AND mode='live'
  ) THEN RAISE EXCEPTION 'RUN_BUSY'; END IF;

  INSERT INTO app.ai_runs(
    tenant_id,id,actor_id,shop_id,mode,status,model,prompt_version,
    workflow_version,tool_version,policy_version,request
  ) VALUES(
    t,run,actor,s,m,'running',model_name,prompt_name,
    workflow_name,tool_name,policy_name,request_data
  );
  INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details)
    VALUES(t,gen_random_uuid(),actor,'ai.run.started',run,jsonb_build_object(
      'mode',m,'workflow_version',workflow_name,'prompt_version',prompt_name,
      'tool_version',tool_name,'policy_version',policy_name
    ));
  RETURN run;
END $$;

REVOKE ALL ON FUNCTION app.reserve_ai_workflow_run(uuid,text,text,text,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.reserve_ai_workflow_run(uuid,text,text,text,text,text,text,jsonb) TO commerce_app;

COMMENT ON COLUMN app.ai_runs.request IS
  'Bounded workflow request metadata. Never stores a raw statement, prompt, customer data, or credentials.';
