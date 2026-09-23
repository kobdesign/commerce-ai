-- Existing evidence remains immutable and unclassified. Do not infer provenance
-- from equal amounts, an old parser version, or a user's import confirmation.
ALTER TABLE app.settlement_lines
  ADD COLUMN payout_total_basis text NOT NULL DEFAULT 'unknown'
  CHECK (payout_total_basis IN ('reported_total','derived_from_lines','unknown'));

CREATE FUNCTION app.validate_settlement_total_basis() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE original_basis text;
BEGIN
  IF NEW.reverses_line_id IS NOT NULL THEN
    SELECT e.payout_total_basis INTO original_basis FROM app.settlement_lines e
      WHERE e.tenant_id=NEW.tenant_id AND e.shop_id=NEW.shop_id AND e.id=NEW.reverses_line_id;
    IF NOT FOUND OR NEW.payout_total_basis IS DISTINCT FROM original_basis THEN
      RAISE EXCEPTION 'settlement reversal must preserve total provenance' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER validate_settlement_total_basis_before_insert
  BEFORE INSERT ON app.settlement_lines
  FOR EACH ROW EXECUTE FUNCTION app.validate_settlement_total_basis();
REVOKE ALL ON FUNCTION app.validate_settlement_total_basis() FROM PUBLIC;
COMMENT ON COLUMN app.settlement_lines.payout_total_basis IS
  'Origin of the reference total, not bank verification. Old rows remain unknown; mixed payout origins must not be classified as reported.';
