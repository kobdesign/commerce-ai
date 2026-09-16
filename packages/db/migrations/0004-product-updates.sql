ALTER TABLE app.products ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE app.cost_versions ALTER COLUMN amount_minor DROP NOT NULL;
ALTER TABLE app.cost_versions ADD COLUMN note text CHECK(length(note)<=500);
ALTER TABLE app.cost_versions ADD COLUMN created_by uuid DEFAULT app.actor_id() REFERENCES private.users(id);

-- Prices and product details are shared across linked shops. Editing requires
-- access to every linked shop, including links hidden by ordinary read policies.
CREATE FUNCTION app.product_edit_allowed(t uuid,p uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT t=app.tenant_id() AND app.member_role(t) IN ('owner','finance')
 AND app.product_allowed(t,p)
 AND NOT EXISTS(SELECT 1 FROM app.shop_products sp WHERE sp.tenant_id=t
   AND sp.product_id=p AND NOT app.shop_allowed(t,sp.shop_id))
$$;
REVOKE ALL ON FUNCTION app.product_edit_allowed(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.product_edit_allowed(uuid,uuid) TO commerce_app;
CREATE POLICY products_update ON app.products FOR UPDATE
 USING(app.product_edit_allowed(tenant_id,id)) WITH CHECK(app.product_edit_allowed(tenant_id,id));
CREATE POLICY variants_update ON app.variants FOR UPDATE
 USING(app.product_edit_allowed(tenant_id,product_id)) WITH CHECK(app.product_edit_allowed(tenant_id,product_id));
DROP POLICY costs_insert ON app.cost_versions;
CREATE POLICY costs_insert ON app.cost_versions FOR INSERT WITH CHECK(
 tenant_id=app.tenant_id() AND created_by=app.actor_id() AND EXISTS(
   SELECT 1 FROM app.variants v WHERE v.tenant_id=cost_versions.tenant_id
   AND v.id=cost_versions.variant_id AND app.product_edit_allowed(v.tenant_id,v.product_id)
 ));
GRANT UPDATE(name,category,sales_unit,attributes,version) ON app.products TO commerce_app;
GRANT UPDATE(price_minor) ON app.variants TO commerce_app;
-- Cost history is append-only; NULL records an explicit return to unknown cost.
