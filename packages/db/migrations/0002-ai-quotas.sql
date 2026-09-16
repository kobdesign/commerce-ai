CREATE SCHEMA jobs AUTHORIZATION commerce_queue;
REVOKE ALL ON SCHEMA jobs FROM PUBLIC;
REVOKE INSERT ON app.ai_runs FROM commerce_app;
CREATE FUNCTION app.reserve_ai_run(s uuid,m text,model_name text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=app.tenant_id(); actor uuid:=app.actor_id(); run uuid:=gen_random_uuid(); total integer;
BEGIN
 IF t IS NULL OR NOT app.shop_allowed(t,s) THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF m NOT IN ('tool-preview','live') THEN RAISE EXCEPTION 'INVALID_MODE'; END IF;
 PERFORM pg_advisory_xact_lock(hashtext(t::text));
 UPDATE app.ai_runs SET status='failed',error_code='EXPIRED',completed_at=now() WHERE tenant_id=t AND status='running' AND created_at<now()-interval '2 minutes';
 SELECT count(*) INTO total FROM app.ai_runs WHERE tenant_id=t AND mode=m AND created_at>now()-interval '24 hours';
 IF total >= (CASE WHEN m='live' THEN 20 ELSE 100 END) THEN RAISE EXCEPTION 'RUN_QUOTA'; END IF;
 IF EXISTS(SELECT 1 FROM app.ai_runs WHERE tenant_id=t AND status='running' AND mode='live') THEN RAISE EXCEPTION 'RUN_BUSY'; END IF;
 INSERT INTO app.ai_runs(tenant_id,id,actor_id,shop_id,mode,status,model) VALUES(t,run,actor,s,m,'running',model_name);
 INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details) VALUES(t,gen_random_uuid(),actor,'ai.run.started',run,jsonb_build_object('mode',m));
 RETURN run;
END $$;
REVOKE ALL ON FUNCTION app.reserve_ai_run(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.reserve_ai_run(uuid,text,text) TO commerce_app;
