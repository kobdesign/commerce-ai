CREATE FUNCTION app.validate_financial_event_reversal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE original app.financial_events%ROWTYPE;
BEGIN
  IF NEW.reverses_event_id IS NULL THEN RETURN NEW; END IF;

  SELECT e.* INTO original FROM app.financial_events e
  WHERE e.tenant_id=NEW.tenant_id AND e.shop_id=NEW.shop_id AND e.id=NEW.reverses_event_id;

  IF NOT FOUND OR original.reverses_event_id IS NOT NULL
    OR NEW.order_id IS DISTINCT FROM original.order_id
    OR NEW.event_type IS DISTINCT FROM original.event_type
    OR NEW.amount_minor IS DISTINCT FROM original.amount_minor
    OR NEW.currency IS DISTINCT FROM original.currency THEN
    RAISE EXCEPTION 'financial reversal must match one original event'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER validate_financial_event_reversal_before_insert
  BEFORE INSERT ON app.financial_events
  FOR EACH ROW EXECUTE FUNCTION app.validate_financial_event_reversal();

REVOKE ALL ON FUNCTION app.validate_financial_event_reversal() FROM PUBLIC;

