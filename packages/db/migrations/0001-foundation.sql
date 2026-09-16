CREATE SCHEMA app;
CREATE SCHEMA private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

CREATE TABLE private.users (
  id uuid PRIMARY KEY, email text UNIQUE NOT NULL, name text NOT NULL,
  password_hash text NOT NULL, active boolean NOT NULL DEFAULT true
);
CREATE TABLE private.sessions (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES private.users(id),
  expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON private.sessions(user_id);
CREATE TABLE private.login_attempts (
  email text PRIMARY KEY, failures int NOT NULL DEFAULT 0, blocked_until timestamptz
);
CREATE TABLE app.tenants (
  id uuid PRIMARY KEY, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE app.memberships (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id), user_id uuid NOT NULL REFERENCES private.users(id),
  role text NOT NULL CHECK(role IN ('owner','finance','operator','marketing','auditor')),
  all_shops boolean NOT NULL DEFAULT false, active boolean NOT NULL DEFAULT true,
  PRIMARY KEY(tenant_id,user_id)
);
CREATE INDEX memberships_user_idx ON app.memberships(user_id,tenant_id);
CREATE TABLE app.shops (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id), id uuid NOT NULL,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
  channel text NOT NULL CHECK(channel IN ('tiktok','shopee','lazada','direct')),
  PRIMARY KEY(tenant_id,id)
);
CREATE TABLE app.shop_grants (
  tenant_id uuid NOT NULL, user_id uuid NOT NULL, shop_id uuid NOT NULL,
  PRIMARY KEY(tenant_id,user_id,shop_id),
  FOREIGN KEY(tenant_id,user_id) REFERENCES app.memberships(tenant_id,user_id),
  FOREIGN KEY(tenant_id,shop_id) REFERENCES app.shops(tenant_id,id)
);
CREATE TABLE app.products (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id), id uuid NOT NULL,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 150),
  category text NOT NULL CHECK(length(category) BETWEEN 1 AND 80),
  sales_unit text NOT NULL CHECK(length(sales_unit) BETWEEN 1 AND 30),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,id)
);
CREATE TABLE app.shop_products (
  tenant_id uuid NOT NULL, shop_id uuid NOT NULL, product_id uuid NOT NULL,
  PRIMARY KEY(tenant_id,shop_id,product_id),
  FOREIGN KEY(tenant_id,shop_id) REFERENCES app.shops(tenant_id,id),
  FOREIGN KEY(tenant_id,product_id) REFERENCES app.products(tenant_id,id)
);
CREATE INDEX shop_products_product_idx ON app.shop_products(tenant_id,product_id);
CREATE TABLE app.variants (
  tenant_id uuid NOT NULL, id uuid NOT NULL, product_id uuid NOT NULL,
  sku text NOT NULL CHECK(length(sku) BETWEEN 1 AND 64),
  attributes jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(attributes)='object'),
  price_minor integer NOT NULL CHECK(price_minor BETWEEN 0 AND 1000000000),
  currency text NOT NULL DEFAULT 'THB' CHECK(currency='THB'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id), UNIQUE(tenant_id,sku),
  FOREIGN KEY(tenant_id,product_id) REFERENCES app.products(tenant_id,id)
);
CREATE INDEX variants_product_idx ON app.variants(tenant_id,product_id);
CREATE TABLE app.cost_versions (
  tenant_id uuid NOT NULL, id uuid NOT NULL, variant_id uuid NOT NULL,
  amount_minor integer NOT NULL CHECK(amount_minor BETWEEN 0 AND 1000000000),
  effective_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,variant_id) REFERENCES app.variants(tenant_id,id)
);
CREATE INDEX cost_versions_lookup_idx ON app.cost_versions(tenant_id,variant_id,effective_at DESC);
CREATE TABLE app.audit_events (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id), id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES private.users(id), action text NOT NULL, entity_id uuid,
  details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id)
);
CREATE INDEX audit_tenant_time_idx ON app.audit_events(tenant_id,created_at DESC);
CREATE TABLE app.ai_runs (
  tenant_id uuid NOT NULL, id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES private.users(id),
  shop_id uuid NOT NULL, mode text NOT NULL CHECK(mode IN ('tool-preview','live')),
  status text NOT NULL CHECK(status IN ('running','succeeded','failed','cancelled')),
  model text, prompt_version text NOT NULL DEFAULT 'catalog-v1',
  result jsonb, input_tokens integer, output_tokens integer,
  estimated_cost_usd_micros bigint, error_code text,
  created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  PRIMARY KEY(tenant_id,id), FOREIGN KEY(tenant_id,shop_id) REFERENCES app.shops(tenant_id,id)
);
CREATE INDEX ai_runs_tenant_time_idx ON app.ai_runs(tenant_id,created_at DESC);

CREATE FUNCTION app.actor_id() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('app.actor_id',true),'')::uuid
$$;
CREATE FUNCTION app.tenant_id() RETURNS uuid LANGUAGE sql STABLE AS $$
 SELECT nullif(current_setting('app.tenant_id',true),'')::uuid
$$;
CREATE FUNCTION app.member_role(t uuid) RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT m.role FROM app.memberships m JOIN private.users u ON u.id=m.user_id
 WHERE m.tenant_id=t AND m.user_id=app.actor_id() AND m.active AND u.active
$$;
CREATE FUNCTION app.shop_allowed(t uuid,s uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS (SELECT 1 FROM app.memberships m JOIN private.users u ON u.id=m.user_id
 JOIN app.shops sh ON sh.tenant_id=m.tenant_id AND sh.id=s
 WHERE m.tenant_id=t AND m.user_id=app.actor_id() AND m.active AND u.active
 AND (m.all_shops OR EXISTS(SELECT 1 FROM app.shop_grants g WHERE g.tenant_id=t AND g.user_id=m.user_id AND g.shop_id=s)))
$$;
CREATE FUNCTION app.product_allowed(t uuid,p uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM app.shop_products sp WHERE sp.tenant_id=t AND sp.product_id=p AND app.shop_allowed(t,sp.shop_id))
$$;
CREATE FUNCTION app.variant_allowed(t uuid,v uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM app.variants x WHERE x.tenant_id=t AND x.id=v AND app.product_allowed(t,x.product_id))
$$;
CREATE FUNCTION app.member_profiles() RETURNS TABLE(user_id uuid,name text,email text,role text,active boolean,all_shops boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT u.id,u.name,u.email,m.role,m.active,m.all_shops FROM app.memberships m JOIN private.users u ON u.id=m.user_id
 WHERE m.tenant_id=app.tenant_id() AND app.member_role(m.tenant_id)='owner'
$$;
CREATE FUNCTION app.create_organization(n text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE t uuid:=gen_random_uuid();
BEGIN
 IF NOT EXISTS(SELECT 1 FROM private.users WHERE id=app.actor_id() AND active) THEN RAISE EXCEPTION 'unauthorized'; END IF;
 INSERT INTO app.tenants(id,name) VALUES(t,n);
 INSERT INTO app.memberships(tenant_id,user_id,role,all_shops) VALUES(t,app.actor_id(),'owner',true);
 INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id) VALUES(t,gen_random_uuid(),app.actor_id(),'organization.created',t);
 RETURN t;
END $$;

DO $$ DECLARE tbl text; BEGIN
 FOREACH tbl IN ARRAY ARRAY['tenants','memberships','shops','shop_grants','products','shop_products','variants','cost_versions','audit_events','ai_runs'] LOOP
 EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY',tbl);
 EXECUTE format('ALTER TABLE app.%I FORCE ROW LEVEL SECURITY',tbl);
 END LOOP;
END $$;

CREATE POLICY tenants_read ON app.tenants FOR SELECT USING(app.member_role(id) IS NOT NULL);
CREATE POLICY memberships_read ON app.memberships FOR SELECT USING(tenant_id=app.tenant_id() AND (user_id=app.actor_id() OR app.member_role(tenant_id)='owner'));
CREATE POLICY memberships_update ON app.memberships FOR UPDATE USING(tenant_id=app.tenant_id() AND app.member_role(tenant_id)='owner' AND user_id<>app.actor_id()) WITH CHECK(tenant_id=app.tenant_id() AND user_id<>app.actor_id());
CREATE POLICY shops_read ON app.shops FOR SELECT USING(tenant_id=app.tenant_id() AND app.shop_allowed(tenant_id,id));
CREATE POLICY shops_insert ON app.shops FOR INSERT WITH CHECK(tenant_id=app.tenant_id() AND app.member_role(tenant_id)='owner');
CREATE POLICY grants_read ON app.shop_grants FOR SELECT USING(tenant_id=app.tenant_id() AND (user_id=app.actor_id() OR app.member_role(tenant_id)='owner'));
CREATE POLICY products_read ON app.products FOR SELECT USING(tenant_id=app.tenant_id() AND app.product_allowed(tenant_id,id));
CREATE POLICY products_insert ON app.products FOR INSERT WITH CHECK(tenant_id=app.tenant_id() AND app.member_role(tenant_id) IN ('owner','finance'));
CREATE POLICY shop_products_read ON app.shop_products FOR SELECT USING(tenant_id=app.tenant_id() AND app.shop_allowed(tenant_id,shop_id));
CREATE POLICY shop_products_insert ON app.shop_products FOR INSERT WITH CHECK(tenant_id=app.tenant_id() AND app.shop_allowed(tenant_id,shop_id) AND app.member_role(tenant_id) IN ('owner','finance'));
CREATE POLICY variants_read ON app.variants FOR SELECT USING(tenant_id=app.tenant_id() AND app.product_allowed(tenant_id,product_id));
CREATE POLICY variants_insert ON app.variants FOR INSERT WITH CHECK(tenant_id=app.tenant_id() AND app.product_allowed(tenant_id,product_id) AND app.member_role(tenant_id) IN ('owner','finance'));
CREATE POLICY costs_read ON app.cost_versions FOR SELECT USING(tenant_id=app.tenant_id() AND app.variant_allowed(tenant_id,variant_id) AND app.member_role(tenant_id) IN ('owner','finance','auditor'));
CREATE POLICY costs_insert ON app.cost_versions FOR INSERT WITH CHECK(tenant_id=app.tenant_id() AND app.variant_allowed(tenant_id,variant_id) AND app.member_role(tenant_id) IN ('owner','finance'));
CREATE POLICY audit_read ON app.audit_events FOR SELECT USING(tenant_id=app.tenant_id() AND app.member_role(tenant_id) IN ('owner','auditor'));
CREATE POLICY audit_insert ON app.audit_events FOR INSERT WITH CHECK(tenant_id=app.tenant_id() AND actor_id=app.actor_id() AND app.member_role(tenant_id) IS NOT NULL);
CREATE POLICY runs_read ON app.ai_runs FOR SELECT USING(tenant_id=app.tenant_id() AND actor_id=app.actor_id() AND app.shop_allowed(tenant_id,shop_id));
CREATE POLICY runs_insert ON app.ai_runs FOR INSERT WITH CHECK(tenant_id=app.tenant_id() AND actor_id=app.actor_id() AND app.shop_allowed(tenant_id,shop_id));
CREATE POLICY runs_update ON app.ai_runs FOR UPDATE USING(tenant_id=app.tenant_id() AND actor_id=app.actor_id() AND app.shop_allowed(tenant_id,shop_id)) WITH CHECK(tenant_id=app.tenant_id() AND actor_id=app.actor_id() AND app.shop_allowed(tenant_id,shop_id));

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app FROM PUBLIC;
GRANT USAGE ON SCHEMA app TO commerce_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO commerce_app;
GRANT SELECT ON ALL TABLES IN SCHEMA app TO commerce_app;
GRANT INSERT ON app.shops,app.products,app.shop_products,app.variants,app.cost_versions,app.audit_events,app.ai_runs TO commerce_app;
GRANT UPDATE(role,active) ON app.memberships TO commerce_app;
GRANT UPDATE(status,result,input_tokens,output_tokens,estimated_cost_usd_micros,error_code,completed_at) ON app.ai_runs TO commerce_app;
GRANT USAGE ON SCHEMA private TO commerce_identity;
GRANT SELECT ON private.users TO commerce_identity;
GRANT SELECT,INSERT,UPDATE,DELETE ON private.sessions,private.login_attempts TO commerce_identity;
