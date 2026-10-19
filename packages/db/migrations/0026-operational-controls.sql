CREATE TABLE app.operational_controls (
  control_name text PRIMARY KEY CHECK(control_name IN ('web_mutations','import_commits')),
  enabled boolean NOT NULL,
  reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500),
  changed_by text NOT NULL CHECK(length(changed_by) BETWEEN 1 AND 120),
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE app.operational_control_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  control_name text NOT NULL,
  previous_enabled boolean,
  enabled boolean NOT NULL,
  reason text NOT NULL,
  changed_by text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX operational_control_events_time_idx ON app.operational_control_events(changed_at DESC);

INSERT INTO app.operational_controls(control_name,enabled,reason,changed_by) VALUES
  ('web_mutations',true,'Initial safe operating state','migration-0026'),
  ('import_commits',true,'Initial safe operating state','migration-0026');

CREATE FUNCTION app.record_operational_control_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  INSERT INTO app.operational_control_events(control_name,previous_enabled,enabled,reason,changed_by,changed_at)
  VALUES(NEW.control_name,OLD.enabled,NEW.enabled,NEW.reason,NEW.changed_by,NEW.changed_at);
  RETURN NEW;
END $$;
CREATE TRIGGER operational_control_audit AFTER UPDATE ON app.operational_controls
FOR EACH ROW EXECUTE FUNCTION app.record_operational_control_event();

CREATE FUNCTION app.operational_control_enabled(control text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT coalesce((SELECT c.enabled FROM app.operational_controls c WHERE c.control_name=control),false)
$$;

REVOKE ALL ON app.operational_controls,app.operational_control_events FROM PUBLIC;
REVOKE ALL ON FUNCTION app.record_operational_control_event() FROM PUBLIC;
REVOKE ALL ON FUNCTION app.operational_control_enabled(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.operational_control_enabled(text) TO commerce_app;

COMMENT ON TABLE app.operational_controls IS 'Platform-wide incident controls. Runtime roles may read only through the fail-closed function.';
COMMENT ON TABLE app.operational_control_events IS 'Append-only audit trail for operational control changes made with the admin role.';
