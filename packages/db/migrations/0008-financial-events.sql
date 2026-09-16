CREATE TABLE app.financial_events (
  tenant_id uuid NOT NULL,
  id uuid NOT NULL,
  shop_id uuid NOT NULL,
  source_event_id text NOT NULL,
  order_id text NOT NULL,
  event_type text NOT NULL CHECK(event_type IN ('refund','fee_rebate')),
  occurred_on date NOT NULL,
  amount_minor integer NOT NULL CHECK(amount_minor BETWEEN 1 AND 1000000000),
  currency text NOT NULL DEFAULT 'THB' CHECK(currency='THB'),
  source_scope text NOT NULL CHECK(source_scope='outside_imported_net_receipt'),
  note text NOT NULL CHECK(length(btrim(note)) BETWEEN 3 AND 500),
  actor_id uuid NOT NULL REFERENCES private.users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,shop_id,source_event_id),
  FOREIGN KEY(tenant_id,shop_id) REFERENCES app.shops(tenant_id,id),
  CHECK(source_event_id=btrim(source_event_id) AND length(source_event_id) BETWEEN 1 AND 150),
  CHECK(order_id=btrim(order_id) AND length(order_id) BETWEEN 1 AND 100)
);

CREATE INDEX financial_events_shop_order_idx
  ON app.financial_events(tenant_id,shop_id,order_id,occurred_on DESC);
CREATE INDEX financial_events_shop_time_idx
  ON app.financial_events(tenant_id,shop_id,occurred_on DESC,created_at DESC);
CREATE INDEX financial_events_actor_idx
  ON app.financial_events(actor_id);

ALTER TABLE app.financial_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.financial_events FORCE ROW LEVEL SECURITY;

CREATE POLICY financial_events_read ON app.financial_events FOR SELECT USING(
  tenant_id=app.tenant_id()
  AND app.shop_allowed(tenant_id,shop_id)
  AND app.member_role(tenant_id) IN ('owner','finance','auditor')
);

CREATE POLICY financial_events_insert ON app.financial_events FOR INSERT WITH CHECK(
  tenant_id=app.tenant_id()
  AND actor_id=app.actor_id()
  AND app.shop_allowed(tenant_id,shop_id)
  AND app.member_role(tenant_id) IN ('owner','finance')
);

GRANT SELECT,INSERT ON app.financial_events TO commerce_app;
-- Events are append-only for the runtime role. Corrections must be new reversing events.

