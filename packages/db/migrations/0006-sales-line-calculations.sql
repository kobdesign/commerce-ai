CREATE TABLE app.sales_line_calculations (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  sales_line_id uuid NOT NULL,
  version integer NOT NULL CHECK(version > 0),
  unit_cost_minor integer CHECK(unit_cost_minor BETWEEN 0 AND 1000000000),
  basis text NOT NULL CHECK(basis IN ('import','manual_missing_cost')),
  reason text,
  actor_id uuid NOT NULL REFERENCES private.users(id),
  calculation_version text NOT NULL DEFAULT 'net-receipt-minus-cogs-v1',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,sales_line_id,version),
  FOREIGN KEY(tenant_id,sales_line_id) REFERENCES app.sales_lines(tenant_id,id),
  CHECK(
    (basis='import' AND version=1 AND reason IS NULL)
    OR
    (basis='manual_missing_cost' AND version>1 AND unit_cost_minor IS NOT NULL
      AND length(btrim(reason)) BETWEEN 3 AND 500)
  )
);

CREATE INDEX sales_line_calculations_latest_idx
  ON app.sales_line_calculations(tenant_id,sales_line_id,version DESC);

INSERT INTO app.sales_line_calculations(
  tenant_id,id,sales_line_id,version,unit_cost_minor,basis,reason,actor_id,calculation_version,created_at
)
SELECT l.tenant_id,gen_random_uuid(),l.id,1,l.unit_cost_minor,'import',NULL,b.actor_id,l.calculation_version,l.created_at
FROM app.sales_lines l
JOIN app.import_batches b ON b.tenant_id=l.tenant_id AND b.id=l.batch_id;

ALTER TABLE app.sales_line_calculations ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sales_line_calculations FORCE ROW LEVEL SECURITY;

CREATE POLICY sales_line_calculations_read ON app.sales_line_calculations FOR SELECT USING(
  tenant_id=app.tenant_id()
  AND app.member_role(tenant_id) IN ('owner','finance','auditor')
  AND EXISTS(
    SELECT 1 FROM app.sales_lines l
    WHERE l.tenant_id=sales_line_calculations.tenant_id
      AND l.id=sales_line_calculations.sales_line_id
      AND app.shop_allowed(l.tenant_id,l.shop_id)
  )
);

CREATE POLICY sales_line_calculations_insert ON app.sales_line_calculations FOR INSERT WITH CHECK(
  tenant_id=app.tenant_id()
  AND actor_id=app.actor_id()
  AND app.member_role(tenant_id) IN ('owner','finance')
  AND EXISTS(
    SELECT 1 FROM app.sales_lines l
    WHERE l.tenant_id=sales_line_calculations.tenant_id
      AND l.id=sales_line_calculations.sales_line_id
      AND app.shop_allowed(l.tenant_id,l.shop_id)
  )
);

GRANT SELECT,INSERT ON app.sales_line_calculations TO commerce_app;
-- Calculation history is append-only for the runtime role.
