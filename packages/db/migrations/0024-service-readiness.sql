CREATE TABLE app.service_heartbeats (
  service_name text NOT NULL CHECK(service_name IN ('worker')),
  instance_id text NOT NULL CHECK(length(instance_id) BETWEEN 1 AND 120),
  status text NOT NULL CHECK(status IN ('running','stopped')),
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(service_name,instance_id)
);
CREATE INDEX service_heartbeats_status_idx ON app.service_heartbeats(service_name,status,last_seen_at DESC);

REVOKE ALL ON app.service_heartbeats FROM PUBLIC;

CREATE FUNCTION app.touch_service_heartbeat(service text,instance text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF service <> 'worker' OR length(instance) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'invalid service heartbeat';
  END IF;
  INSERT INTO app.service_heartbeats(service_name,instance_id,status)
  VALUES(service,instance,'running')
  ON CONFLICT(service_name,instance_id) DO UPDATE
    SET status='running',last_seen_at=clock_timestamp();
  DELETE FROM app.service_heartbeats
  WHERE last_seen_at < clock_timestamp()-interval '7 days';
END $$;

CREATE FUNCTION app.stop_service_heartbeat(service text,instance text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF service <> 'worker' OR length(instance) NOT BETWEEN 1 AND 120 THEN
    RAISE EXCEPTION 'invalid service heartbeat';
  END IF;
  UPDATE app.service_heartbeats
  SET status='stopped',last_seen_at=clock_timestamp()
  WHERE service_name=service AND instance_id=instance;
END $$;

CREATE FUNCTION app.service_heartbeat_status(service text)
RETURNS TABLE(available boolean,last_seen_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT
    coalesce(bool_or(h.status='running' AND h.last_seen_at >= statement_timestamp()-interval '45 seconds'),false),
    max(h.last_seen_at)
  FROM app.service_heartbeats h
  WHERE h.service_name=service AND service='worker'
$$;

REVOKE ALL ON FUNCTION app.touch_service_heartbeat(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.stop_service_heartbeat(text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.service_heartbeat_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.touch_service_heartbeat(text,text) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.stop_service_heartbeat(text,text) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.service_heartbeat_status(text) TO commerce_app;
