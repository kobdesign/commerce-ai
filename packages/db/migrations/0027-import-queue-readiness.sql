CREATE FUNCTION app.import_queue_ready() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM app.import_commit_jobs job
    WHERE (
      job.status='queued'
      AND job.next_attempt_at<=statement_timestamp()
      AND job.requested_at<statement_timestamp()-interval '10 minutes'
    ) OR (
      job.status='running'
      AND job.started_at<statement_timestamp()-interval '6 minutes'
    )
  )
$$;

REVOKE ALL ON FUNCTION app.import_queue_ready() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.import_queue_ready() TO commerce_app;
COMMENT ON FUNCTION app.import_queue_ready() IS 'Fail readiness when a claimable import waited over 10 minutes or a running import exceeded the worker recovery window.';
