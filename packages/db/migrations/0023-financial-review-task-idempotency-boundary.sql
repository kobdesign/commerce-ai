CREATE FUNCTION app.enforce_financial_review_draft_task_match() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NEW.confirmed_task_id IS NOT NULL AND NOT EXISTS(
    SELECT 1 FROM app.financial_review_tasks task
    WHERE task.tenant_id=NEW.tenant_id AND task.id=NEW.confirmed_task_id
      AND task.shop_id=NEW.shop_id AND task.exception_id=NEW.exception_id
  ) THEN RAISE EXCEPTION 'TASK_EXCEPTION_MISMATCH'; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER financial_review_draft_task_match
BEFORE INSERT OR UPDATE OF confirmed_task_id ON app.financial_review_task_drafts
FOR EACH ROW EXECUTE FUNCTION app.enforce_financial_review_draft_task_match();

REVOKE ALL ON FUNCTION app.enforce_financial_review_draft_task_match() FROM PUBLIC;

COMMENT ON TRIGGER financial_review_draft_task_match ON app.financial_review_task_drafts IS
  'Prevents reuse of an idempotency key from linking a draft to a task for a different exception.';
