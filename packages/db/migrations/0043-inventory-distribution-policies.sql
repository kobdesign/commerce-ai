-- OPS-AG-02a: planning-only stock distribution policy.
-- No row in these tables authorizes an outbound marketplace write.
CREATE TABLE app.inventory_distribution_defaults (
  tenant_id uuid PRIMARY KEY REFERENCES app.tenants(id),
  mode text NOT NULL CHECK(mode IN ('shared','fixed','hybrid')),
  safety_stock integer NOT NULL DEFAULT 0 CHECK(safety_stock BETWEEN 0 AND 1000000000),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES private.users(id)
);

CREATE TABLE app.inventory_distribution_policies (
  tenant_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  mode text NOT NULL CHECK(mode IN ('shared','fixed','hybrid')),
  safety_stock integer NOT NULL DEFAULT 0 CHECK(safety_stock BETWEEN 0 AND 1000000000),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES private.users(id),
  PRIMARY KEY(tenant_id,variant_id),
  FOREIGN KEY(tenant_id,variant_id) REFERENCES app.variants(tenant_id,id) ON DELETE CASCADE
);

CREATE TABLE app.inventory_channel_policies (
  tenant_id uuid NOT NULL,
  variant_id uuid NOT NULL,
  shop_id uuid NOT NULL,
  quantity integer NOT NULL CHECK(quantity BETWEEN 0 AND 1000000000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES private.users(id),
  PRIMARY KEY(tenant_id,variant_id,shop_id),
  FOREIGN KEY(tenant_id,variant_id) REFERENCES app.inventory_distribution_policies(tenant_id,variant_id) ON DELETE CASCADE,
  FOREIGN KEY(tenant_id,shop_id) REFERENCES app.shops(tenant_id,id)
);

ALTER TABLE app.inventory_distribution_defaults ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.inventory_distribution_defaults FORCE ROW LEVEL SECURITY;
ALTER TABLE app.inventory_distribution_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.inventory_distribution_policies FORCE ROW LEVEL SECURITY;
ALTER TABLE app.inventory_channel_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.inventory_channel_policies FORCE ROW LEVEL SECURITY;

CREATE POLICY inventory_distribution_defaults_read ON app.inventory_distribution_defaults FOR SELECT USING(
  tenant_id=app.tenant_id()
  AND app.member_role(tenant_id) IN ('owner','finance','operator','auditor')
);
CREATE POLICY inventory_distribution_defaults_write ON app.inventory_distribution_defaults FOR ALL
  USING(tenant_id=app.tenant_id() AND app.member_role(tenant_id) IN ('owner','finance'))
  WITH CHECK(tenant_id=app.tenant_id() AND app.member_role(tenant_id) IN ('owner','finance'));

CREATE POLICY inventory_distribution_policies_read ON app.inventory_distribution_policies FOR SELECT USING(
  tenant_id=app.tenant_id()
  AND app.member_role(tenant_id) IN ('owner','finance','operator','auditor')
  AND app.variant_allowed(tenant_id,variant_id)
);
CREATE POLICY inventory_distribution_policies_write ON app.inventory_distribution_policies FOR ALL
  USING(
    tenant_id=app.tenant_id()
    AND app.member_role(tenant_id) IN ('owner','finance')
    AND app.variant_allowed(tenant_id,variant_id)
  )
  WITH CHECK(
    tenant_id=app.tenant_id()
    AND app.member_role(tenant_id) IN ('owner','finance')
    AND app.variant_allowed(tenant_id,variant_id)
  );

CREATE POLICY inventory_channel_policies_read ON app.inventory_channel_policies FOR SELECT USING(
  tenant_id=app.tenant_id()
  AND app.member_role(tenant_id) IN ('owner','finance','operator','auditor')
  AND app.variant_allowed(tenant_id,variant_id)
  AND app.shop_allowed(tenant_id,shop_id)
);
CREATE POLICY inventory_channel_policies_write ON app.inventory_channel_policies FOR ALL
  USING(
    tenant_id=app.tenant_id()
    AND app.member_role(tenant_id) IN ('owner','finance')
    AND app.variant_allowed(tenant_id,variant_id)
    AND app.shop_allowed(tenant_id,shop_id)
  )
  WITH CHECK(
    tenant_id=app.tenant_id()
    AND app.member_role(tenant_id) IN ('owner','finance')
    AND app.variant_allowed(tenant_id,variant_id)
    AND app.shop_allowed(tenant_id,shop_id)
  );

GRANT SELECT,INSERT,UPDATE,DELETE ON app.inventory_distribution_defaults TO commerce_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON app.inventory_distribution_policies TO commerce_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON app.inventory_channel_policies TO commerce_app;
