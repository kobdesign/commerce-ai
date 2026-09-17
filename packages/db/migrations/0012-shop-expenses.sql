CREATE TABLE app.shop_expenses (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  shop_id uuid NOT NULL,
  source_expense_id text NOT NULL,
  expense_type text NOT NULL CHECK(expense_type IN ('advertising','shipping','packaging','payroll','travel','other')),
  occurred_on date NOT NULL,
  amount_minor integer NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000),
  currency text NOT NULL DEFAULT 'THB' CHECK(currency='THB'),
  allocation_scope text NOT NULL CHECK(allocation_scope IN ('shop_direct','shared_allocated')),
  allocation_basis text,
  source_scope text NOT NULL CHECK(source_scope IN ('outside_imported_net_receipt','expense_reversal')),
  note text NOT NULL CHECK(length(btrim(note)) BETWEEN 3 AND 500),
  actor_id uuid NOT NULL REFERENCES private.users(id),
  reverses_expense_id uuid,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,shop_id,id),
  UNIQUE(tenant_id,shop_id,source_expense_id),
  FOREIGN KEY(tenant_id,shop_id) REFERENCES app.shops(tenant_id,id),
  FOREIGN KEY(tenant_id,shop_id,reverses_expense_id)
    REFERENCES app.shop_expenses(tenant_id,shop_id,id),
  CHECK(source_expense_id=btrim(source_expense_id) AND length(source_expense_id) BETWEEN 1 AND 150),
  CHECK(
    (allocation_scope='shop_direct' AND allocation_basis IS NULL)
    OR (allocation_scope='shared_allocated' AND length(btrim(allocation_basis)) BETWEEN 3 AND 300)
  ),
  CHECK(
    (source_scope='outside_imported_net_receipt' AND reverses_expense_id IS NULL)
    OR (source_scope='expense_reversal' AND reverses_expense_id IS NOT NULL)
  ),
  CHECK(reverses_expense_id IS NULL OR reverses_expense_id<>id)
);

CREATE INDEX shop_expenses_shop_time_idx
  ON app.shop_expenses(tenant_id,shop_id,occurred_on DESC,created_at DESC);
CREATE INDEX shop_expenses_shop_type_idx
  ON app.shop_expenses(tenant_id,shop_id,expense_type,occurred_on DESC);
CREATE INDEX shop_expenses_actor_idx ON app.shop_expenses(actor_id);
CREATE UNIQUE INDEX shop_expenses_one_reversal_idx
  ON app.shop_expenses(tenant_id,shop_id,reverses_expense_id)
  WHERE reverses_expense_id IS NOT NULL;

ALTER TABLE app.shop_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.shop_expenses FORCE ROW LEVEL SECURITY;

CREATE POLICY shop_expenses_read ON app.shop_expenses FOR SELECT USING(
  tenant_id=app.tenant_id()
  AND app.shop_allowed(tenant_id,shop_id)
  AND app.member_role(tenant_id) IN ('owner','finance','auditor')
);

CREATE POLICY shop_expenses_insert ON app.shop_expenses FOR INSERT WITH CHECK(
  tenant_id=app.tenant_id()
  AND actor_id=app.actor_id()
  AND app.shop_allowed(tenant_id,shop_id)
  AND app.member_role(tenant_id) IN ('owner','finance')
);

GRANT SELECT,INSERT ON app.shop_expenses TO commerce_app;
-- Expenses are append-only. Corrections are equal and opposite linked entries.

CREATE FUNCTION app.validate_shop_expense_reversal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE original app.shop_expenses%ROWTYPE;
BEGIN
  IF NEW.reverses_expense_id IS NULL THEN RETURN NEW; END IF;

  SELECT e.* INTO original FROM app.shop_expenses e
  WHERE e.tenant_id=NEW.tenant_id AND e.shop_id=NEW.shop_id AND e.id=NEW.reverses_expense_id;

  IF NOT FOUND OR original.reverses_expense_id IS NOT NULL
    OR NEW.expense_type IS DISTINCT FROM original.expense_type
    OR NEW.amount_minor IS DISTINCT FROM original.amount_minor
    OR NEW.currency IS DISTINCT FROM original.currency
    OR NEW.allocation_scope IS DISTINCT FROM original.allocation_scope
    OR NEW.allocation_basis IS DISTINCT FROM original.allocation_basis THEN
    RAISE EXCEPTION 'expense reversal must match one original expense'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER validate_shop_expense_reversal_before_insert
  BEFORE INSERT ON app.shop_expenses
  FOR EACH ROW EXECUTE FUNCTION app.validate_shop_expense_reversal();

REVOKE ALL ON FUNCTION app.validate_shop_expense_reversal() FROM PUBLIC;
