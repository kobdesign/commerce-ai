CREATE TABLE app.settlement_lines (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  shop_id uuid NOT NULL,
  source_line_id text NOT NULL,
  payout_reference text NOT NULL,
  order_id text NOT NULL,
  settled_on date NOT NULL,
  payout_total_minor integer NOT NULL CHECK(payout_total_minor BETWEEN 1 AND 1000000000),
  amount_minor integer NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000),
  currency text NOT NULL DEFAULT 'THB' CHECK(currency='THB'),
  source_scope text NOT NULL CHECK(source_scope IN ('settlement_statement','settlement_reversal')),
  note text NOT NULL CHECK(length(btrim(note)) BETWEEN 3 AND 500),
  actor_id uuid NOT NULL REFERENCES private.users(id),
  reverses_line_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,shop_id,id),
  UNIQUE(tenant_id,shop_id,source_line_id),
  FOREIGN KEY(tenant_id,shop_id) REFERENCES app.shops(tenant_id,id),
  FOREIGN KEY(tenant_id,shop_id,reverses_line_id)
    REFERENCES app.settlement_lines(tenant_id,shop_id,id),
  CHECK(source_line_id=btrim(source_line_id) AND length(source_line_id) BETWEEN 1 AND 150),
  CHECK(payout_reference=btrim(payout_reference) AND length(payout_reference) BETWEEN 1 AND 150),
  CHECK(order_id=btrim(order_id) AND length(order_id) BETWEEN 1 AND 100),
  CHECK(
    (source_scope='settlement_statement' AND reverses_line_id IS NULL)
    OR (source_scope='settlement_reversal' AND reverses_line_id IS NOT NULL)
  ),
  CHECK(reverses_line_id IS NULL OR reverses_line_id<>id)
);

CREATE INDEX settlement_lines_shop_payout_idx
  ON app.settlement_lines(tenant_id,shop_id,payout_reference,settled_on DESC);
CREATE INDEX settlement_lines_shop_order_idx
  ON app.settlement_lines(tenant_id,shop_id,order_id,settled_on DESC);
CREATE INDEX settlement_lines_shop_time_idx
  ON app.settlement_lines(tenant_id,shop_id,settled_on DESC,created_at DESC);
CREATE UNIQUE INDEX settlement_lines_one_reversal_idx
  ON app.settlement_lines(tenant_id,shop_id,reverses_line_id)
  WHERE reverses_line_id IS NOT NULL;

ALTER TABLE app.settlement_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.settlement_lines FORCE ROW LEVEL SECURITY;

CREATE POLICY settlement_lines_read ON app.settlement_lines FOR SELECT USING(
  tenant_id=app.tenant_id()
  AND app.shop_allowed(tenant_id,shop_id)
  AND app.member_role(tenant_id) IN ('owner','finance','auditor')
);
CREATE POLICY settlement_lines_insert ON app.settlement_lines FOR INSERT WITH CHECK(
  tenant_id=app.tenant_id()
  AND actor_id=app.actor_id()
  AND app.shop_allowed(tenant_id,shop_id)
  AND app.member_role(tenant_id) IN ('owner','finance')
);

GRANT SELECT,INSERT ON app.settlement_lines TO commerce_app;

CREATE FUNCTION app.validate_settlement_line() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE original app.settlement_lines%ROWTYPE;
BEGIN
  IF NEW.reverses_line_id IS NULL THEN
    IF EXISTS(
      SELECT 1 FROM app.settlement_lines e
      WHERE e.tenant_id=NEW.tenant_id AND e.shop_id=NEW.shop_id
        AND e.payout_reference=NEW.payout_reference AND e.reverses_line_id IS NULL
        AND (e.settled_on IS DISTINCT FROM NEW.settled_on
          OR e.payout_total_minor IS DISTINCT FROM NEW.payout_total_minor
          OR e.currency IS DISTINCT FROM NEW.currency)
    ) THEN
      RAISE EXCEPTION 'payout reference has conflicting summary data' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;

  SELECT e.* INTO original FROM app.settlement_lines e
  WHERE e.tenant_id=NEW.tenant_id AND e.shop_id=NEW.shop_id AND e.id=NEW.reverses_line_id;

  IF NOT FOUND OR original.reverses_line_id IS NOT NULL
    OR NEW.payout_reference IS DISTINCT FROM original.payout_reference
    OR NEW.order_id IS DISTINCT FROM original.order_id
    OR NEW.settled_on IS DISTINCT FROM original.settled_on
    OR NEW.payout_total_minor IS DISTINCT FROM original.payout_total_minor
    OR NEW.amount_minor IS DISTINCT FROM original.amount_minor
    OR NEW.currency IS DISTINCT FROM original.currency THEN
    RAISE EXCEPTION 'settlement reversal must match one original line' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER validate_settlement_line_before_insert
  BEFORE INSERT ON app.settlement_lines
  FOR EACH ROW EXECUTE FUNCTION app.validate_settlement_line();

REVOKE ALL ON FUNCTION app.validate_settlement_line() FROM PUBLIC;

COMMENT ON TABLE app.settlement_lines IS 'Append-only payout statement allocations. A payout can contain many orders and an order can span payouts.';
