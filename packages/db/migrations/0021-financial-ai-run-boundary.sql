-- Harden the financial run reservation at the database boundary. Application
-- validation remains required, but a future endpoint cannot reserve a financial
-- run for a non-finance actor or attach arbitrary metadata/raw input.
CREATE OR REPLACE FUNCTION app.reserve_ai_workflow_run(
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
  IF app.member_role(t) NOT IN ('owner','finance','auditor') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF m NOT IN ('tool-preview','live') THEN RAISE EXCEPTION 'INVALID_MODE'; END IF;
  IF (m='tool-preview' AND model_name IS NOT NULL)
    OR (m='live' AND (model_name IS NULL OR length(model_name) NOT BETWEEN 1 AND 150))
  THEN RAISE EXCEPTION 'INVALID_MODEL_METADATA'; END IF;
  IF workflow_name<>'settlement-review-v1'
    OR prompt_name<>'settlement-review-th-v1'
    OR tool_name<>'finance-evidence-v1'
    OR policy_name<>'financial-readonly-v1'
  THEN RAISE EXCEPTION 'INVALID_RUN_METADATA'; END IF;
  IF request_data IS NULL OR jsonb_typeof(request_data) IS DISTINCT FROM 'object'
    OR request_data - ARRAY['period','limit'] <> '{}'::jsonb
    OR jsonb_typeof(request_data->'period') IS DISTINCT FROM 'object'
    OR (request_data->'period') - ARRAY['from','to'] <> '{}'::jsonb
    OR jsonb_typeof(request_data->'period'->'from') IS DISTINCT FROM 'string'
    OR jsonb_typeof(request_data->'period'->'to') IS DISTINCT FROM 'string'
    OR jsonb_typeof(request_data->'limit') IS DISTINCT FROM 'number'
    OR (request_data->>'limit')::numeric NOT BETWEEN 1 AND 50
    OR trunc((request_data->>'limit')::numeric)<>(request_data->>'limit')::numeric
    OR request_data#>>'{period,from}' !~ '^\d{4}-\d{2}-\d{2}$'
    OR request_data#>>'{period,to}' !~ '^\d{4}-\d{2}-\d{2}$'
  THEN RAISE EXCEPTION 'INVALID_RUN_REQUEST'; END IF;

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
