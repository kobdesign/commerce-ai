CREATE TABLE app.import_batches (
  tenant_id uuid NOT NULL, id uuid NOT NULL, shop_id uuid NOT NULL, draft_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES private.users(id),
  filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 150),
  source_hash text NOT NULL, parser_version text NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,draft_id),
  FOREIGN KEY(tenant_id,shop_id) REFERENCES app.shops(tenant_id,id),
  FOREIGN KEY(tenant_id,draft_id) REFERENCES app.import_drafts(tenant_id,id)
);
CREATE INDEX import_batches_shop_time_idx ON app.import_batches(tenant_id,shop_id,committed_at DESC);

CREATE TABLE app.sales_lines (
  tenant_id uuid NOT NULL, id uuid NOT NULL, batch_id uuid NOT NULL, shop_id uuid NOT NULL,
  source_record integer NOT NULL CHECK(source_record>0),
  order_id text NOT NULL CHECK(length(order_id) BETWEEN 1 AND 100),
  variant_id uuid NOT NULL, sold_on date NOT NULL,
  quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 1000000),
  net_receipt_minor integer NOT NULL CHECK(net_receipt_minor BETWEEN 0 AND 1000000000),
  platform_fee_minor integer CHECK(platform_fee_minor BETWEEN 0 AND 1000000000),
  unit_cost_minor integer CHECK(unit_cost_minor BETWEEN 0 AND 1000000000),
  cogs_minor bigint, contribution_minor bigint,
  currency text NOT NULL DEFAULT 'THB' CHECK(currency='THB'),
  calculation_version text NOT NULL DEFAULT 'net-receipt-minus-cogs-v1',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,batch_id,source_record),
  FOREIGN KEY(tenant_id,batch_id) REFERENCES app.import_batches(tenant_id,id),
  FOREIGN KEY(tenant_id,shop_id) REFERENCES app.shops(tenant_id,id),
  FOREIGN KEY(tenant_id,variant_id) REFERENCES app.variants(tenant_id,id),
  CHECK(
    (unit_cost_minor IS NULL AND cogs_minor IS NULL AND contribution_minor IS NULL)
    OR
    (unit_cost_minor IS NOT NULL AND cogs_minor=unit_cost_minor::bigint*quantity
      AND contribution_minor=net_receipt_minor::bigint-cogs_minor)
  )
);
CREATE INDEX sales_lines_shop_date_idx ON app.sales_lines(tenant_id,shop_id,sold_on DESC);
CREATE INDEX sales_lines_variant_date_idx ON app.sales_lines(tenant_id,variant_id,sold_on DESC);
CREATE INDEX sales_lines_order_idx ON app.sales_lines(tenant_id,shop_id,order_id);

ALTER TABLE app.import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.import_batches FORCE ROW LEVEL SECURITY;
ALTER TABLE app.sales_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.sales_lines FORCE ROW LEVEL SECURITY;

CREATE POLICY batches_read ON app.import_batches FOR SELECT USING(
  tenant_id=app.tenant_id() AND app.shop_allowed(tenant_id,shop_id)
  AND app.member_role(tenant_id) IN ('owner','finance','auditor')
);
CREATE POLICY batches_insert ON app.import_batches FOR INSERT WITH CHECK(
  tenant_id=app.tenant_id() AND actor_id=app.actor_id() AND app.shop_allowed(tenant_id,shop_id)
  AND app.member_role(tenant_id) IN ('owner','finance')
);
CREATE POLICY sales_lines_read ON app.sales_lines FOR SELECT USING(
  tenant_id=app.tenant_id() AND app.shop_allowed(tenant_id,shop_id)
  AND app.member_role(tenant_id) IN ('owner','finance','auditor')
);
CREATE POLICY sales_lines_insert ON app.sales_lines FOR INSERT WITH CHECK(
  tenant_id=app.tenant_id() AND app.shop_allowed(tenant_id,shop_id)
  AND app.member_role(tenant_id) IN ('owner','finance')
  AND EXISTS(SELECT 1 FROM app.import_batches b WHERE b.tenant_id=sales_lines.tenant_id
    AND b.id=sales_lines.batch_id AND b.shop_id=sales_lines.shop_id AND b.actor_id=app.actor_id())
);

GRANT SELECT,INSERT ON app.import_batches,app.sales_lines TO commerce_app;
-- Committed financial facts are append-only for the runtime role.
