-- EVE-POC-05: purpose-built, receipt-bound read models for Commerce agents.
-- These SECURITY DEFINER functions expose reduced projections only. They do
-- not expose a generic transaction, SQL surface, costs, customer data or raw orders.

CREATE FUNCTION app.assert_agent_read_receipt(
  selected_tenant uuid,selected_request_id uuid,selected_scope text,selected_shop_ids uuid[]
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF selected_tenant IS NULL OR selected_request_id IS NULL
    OR selected_scope NOT IN ('catalog:read','sales:read','inventory:read')
    OR cardinality(selected_shop_ids) NOT BETWEEN 1 AND 20
    OR (SELECT count(DISTINCT shop_id) FROM unnest(selected_shop_ids) AS values_list(shop_id))<>cardinality(selected_shop_ids)
    OR NOT EXISTS(
      SELECT 1 FROM app.agent_service_request_receipts r
      WHERE r.tenant_id=selected_tenant AND r.request_id=selected_request_id
        AND r.required_scope=selected_scope AND r.authenticated_at>clock_timestamp()-interval '5 minutes'
        AND r.shop_ids@>selected_shop_ids AND r.shop_ids<@selected_shop_ids
    )
  THEN RAISE EXCEPTION 'AGENT_RECEIPT_FORBIDDEN'; END IF;
END $$;

CREATE FUNCTION app.read_agent_products(
  selected_tenant uuid,selected_request_id uuid,selected_shop_ids uuid[],selected_search text,selected_category text,
  selected_status text,selected_variant_ids uuid[],selected_limit integer,selected_offset integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  PERFORM app.assert_agent_read_receipt(selected_tenant,selected_request_id,'catalog:read',selected_shop_ids);
  IF length(selected_search)>100 OR (selected_category IS NOT NULL AND length(selected_category)>80)
    OR selected_status NOT IN ('active','archived','all') OR selected_limit NOT BETWEEN 1 AND 101
    OR selected_offset NOT BETWEEN 0 AND 10000 OR cardinality(selected_variant_ids)>100
  THEN RAISE EXCEPTION 'AGENT_QUERY_INVALID'; END IF;
  WITH selected AS (
    SELECT p.id AS product_id,v.id AS variant_id,p.name,v.sku,p.category,p.sales_unit,v.attributes,v.price_minor,v.currency,
      (p.archived_at IS NOT NULL OR v.archived_at IS NOT NULL) AS archived,
      ARRAY(SELECT sp2.shop_id FROM app.shop_products sp2
        WHERE sp2.tenant_id=p.tenant_id AND sp2.product_id=p.id AND sp2.shop_id=ANY(selected_shop_ids)
        ORDER BY sp2.shop_id) AS listed_shop_ids,
      greatest(p.created_at,v.created_at,coalesce(p.archived_at,p.created_at),coalesce(v.archived_at,v.created_at)) AS source_updated_at
    FROM app.products p JOIN app.variants v ON v.tenant_id=p.tenant_id AND v.product_id=p.id
    WHERE p.tenant_id=selected_tenant
      AND EXISTS(SELECT 1 FROM app.shop_products sp WHERE sp.tenant_id=p.tenant_id AND sp.product_id=p.id AND sp.shop_id=ANY(selected_shop_ids))
      AND (selected_variant_ids IS NULL OR v.id=ANY(selected_variant_ids))
      AND (selected_search='' OR p.name ILIKE '%'||selected_search||'%' OR v.sku ILIKE '%'||selected_search||'%')
      AND (selected_category IS NULL OR p.category=selected_category)
      AND (selected_status='all' OR (selected_status='active' AND p.archived_at IS NULL AND v.archived_at IS NULL)
        OR (selected_status='archived' AND (p.archived_at IS NOT NULL OR v.archived_at IS NOT NULL)))
    ORDER BY p.name,v.sku,v.id LIMIT selected_limit OFFSET selected_offset
  )
  SELECT jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object(
    'productId',product_id,'variantId',variant_id,'name',name,'sku',sku,'category',category,'salesUnit',sales_unit,
    'attributes',attributes,'priceMinor',price_minor,'currency',currency,'archived',archived,
    'listedShopIds',listed_shop_ids,'sourceUpdatedAt',source_updated_at
  ) ORDER BY name,sku,variant_id),'[]'::jsonb)) INTO result FROM selected;
  RETURN result;
END $$;

CREATE FUNCTION app.read_agent_sales(
  selected_tenant uuid,selected_request_id uuid,selected_shop_ids uuid[],selected_from date,selected_to date,
  selected_variant_ids uuid[],selected_granularity text,selected_order_states text[],selected_limit integer,selected_offset integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  PERFORM app.assert_agent_read_receipt(selected_tenant,selected_request_id,'sales:read',selected_shop_ids);
  IF selected_from IS NULL OR selected_to IS NULL OR selected_from>selected_to OR selected_to-selected_from>92
    OR selected_granularity NOT IN ('variant','variant_channel','variant_day')
    OR cardinality(selected_order_states) NOT BETWEEN 1 AND 3
    OR EXISTS(SELECT 1 FROM unnest(selected_order_states) state WHERE state NOT IN ('open','completed','cancelled'))
    OR selected_limit NOT BETWEEN 1 AND 101 OR selected_offset NOT BETWEEN 0 AND 10000 OR cardinality(selected_variant_ids)>100
  THEN RAISE EXCEPTION 'AGENT_QUERY_INVALID'; END IF;
  WITH aggregated AS (
    SELECT v.product_id,v.id AS variant_id,v.sku,p.name AS product_name,
      CASE WHEN selected_granularity='variant_channel' THEN o.shop_id ELSE NULL END AS shop_id,
      CASE WHEN selected_granularity='variant_channel' THEN min(s.channel)
        WHEN count(DISTINCT s.channel)=1 THEN min(s.channel) ELSE 'mixed' END AS channel,
      CASE WHEN selected_granularity='variant_day' THEN o.ordered_at::date ELSE selected_from END AS period_from,
      CASE WHEN selected_granularity='variant_day' THEN o.ordered_at::date ELSE selected_to END AS period_to,
      sum(l.quantity)::bigint AS quantity,count(DISTINCT o.id)::bigint AS order_count,
      sum(l.quantity*coalesce(l.unit_price_minor,0))::bigint AS gross_sales_minor,max(o.updated_at) AS source_updated_at
    FROM app.commerce_orders o JOIN app.commerce_order_lines l ON l.tenant_id=o.tenant_id AND l.order_id=o.id
    JOIN app.variants v ON v.tenant_id=l.tenant_id AND v.id=l.variant_id
    JOIN app.products p ON p.tenant_id=v.tenant_id AND p.id=v.product_id
    JOIN app.shops s ON s.tenant_id=o.tenant_id AND s.id=o.shop_id
    WHERE o.tenant_id=selected_tenant AND o.shop_id=ANY(selected_shop_ids)
      AND o.ordered_at>=selected_from::timestamptz AND o.ordered_at<(selected_to+1)::timestamptz
      AND o.order_state=ANY(selected_order_states)
      AND (selected_variant_ids IS NULL OR v.id=ANY(selected_variant_ids))
    GROUP BY v.product_id,v.id,v.sku,p.name,
      CASE WHEN selected_granularity='variant_channel' THEN o.shop_id ELSE NULL END,
      CASE WHEN selected_granularity='variant_day' THEN o.ordered_at::date ELSE selected_from END,
      CASE WHEN selected_granularity='variant_day' THEN o.ordered_at::date ELSE selected_to END
    ORDER BY gross_sales_minor DESC,v.sku,shop_id NULLS FIRST,period_from LIMIT selected_limit OFFSET selected_offset
  )
  SELECT jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object(
    'productId',product_id,'variantId',variant_id,'sku',sku,'productName',product_name,'shopId',shop_id,'channel',channel,
    'period',jsonb_build_object('from',period_from,'to',period_to),'quantity',quantity,'orderCount',order_count,
    'grossSalesMinor',gross_sales_minor,'currency','THB','sourceUpdatedAt',source_updated_at
  ) ORDER BY gross_sales_minor DESC,sku,shop_id NULLS FIRST,period_from),'[]'::jsonb)) INTO result FROM aggregated;
  RETURN result;
END $$;

CREATE FUNCTION app.read_agent_inventory(
  selected_tenant uuid,selected_request_id uuid,selected_shop_ids uuid[],selected_search text,selected_variant_ids uuid[],
  selected_availability text,selected_include_channels boolean,selected_limit integer,selected_offset integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result jsonb;
BEGIN
  PERFORM app.assert_agent_read_receipt(selected_tenant,selected_request_id,'inventory:read',selected_shop_ids);
  IF length(selected_search)>100 OR selected_availability NOT IN ('all','available','low','out','reserved')
    OR selected_limit NOT BETWEEN 1 AND 101 OR selected_offset NOT BETWEEN 0 AND 10000 OR cardinality(selected_variant_ids)>100
  THEN RAISE EXCEPTION 'AGENT_QUERY_INVALID'; END IF;
  WITH base AS (
    SELECT p.id AS product_id,v.id AS variant_id,p.name AS product_name,v.sku,
      coalesce(b.on_hand,0)::int AS on_hand,coalesce(b.reserved,0)::int AS reserved,
      greatest(0,coalesce(b.on_hand,0)-coalesce(b.reserved,0))::int AS available,
      coalesce(dp.safety_stock,dd.safety_stock,0)::int AS safety_stock,
      greatest(0,coalesce(b.on_hand,0)-coalesce(b.reserved,0)-coalesce(dp.safety_stock,dd.safety_stock,0))::int AS distributable,
      coalesce(dp.mode,dd.mode,'shared') AS distribution_mode,coalesce(b.version,0)::int AS balance_version,
      greatest(coalesce(b.updated_at,v.created_at),coalesce(dp.updated_at,dd.updated_at,v.created_at)) AS source_updated_at
    FROM app.variants v JOIN app.products p ON p.tenant_id=v.tenant_id AND p.id=v.product_id
    LEFT JOIN app.inventory_locations loc ON loc.tenant_id=v.tenant_id AND loc.is_default AND loc.active
    LEFT JOIN app.inventory_balances b ON b.tenant_id=v.tenant_id AND b.location_id=loc.id AND b.variant_id=v.id
    LEFT JOIN app.inventory_distribution_defaults dd ON dd.tenant_id=v.tenant_id
    LEFT JOIN app.inventory_distribution_policies dp ON dp.tenant_id=v.tenant_id AND dp.variant_id=v.id
    WHERE v.tenant_id=selected_tenant AND p.archived_at IS NULL AND v.archived_at IS NULL
      AND EXISTS(SELECT 1 FROM app.shop_products sp WHERE sp.tenant_id=p.tenant_id AND sp.product_id=p.id AND sp.shop_id=ANY(selected_shop_ids))
      AND (selected_variant_ids IS NULL OR v.id=ANY(selected_variant_ids))
      AND (selected_search='' OR p.name ILIKE '%'||selected_search||'%' OR v.sku ILIKE '%'||selected_search||'%')
  ),filtered AS (
    SELECT * FROM base WHERE selected_availability='all'
      OR (selected_availability='available' AND available>0)
      OR (selected_availability='low' AND available>0 AND available<=safety_stock)
      OR (selected_availability='out' AND available=0)
      OR (selected_availability='reserved' AND reserved>0)
    ORDER BY product_name,sku,variant_id LIMIT selected_limit OFFSET selected_offset
  ),with_channels AS (
    SELECT f.*,CASE WHEN selected_include_channels THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'shopId',s.id,'channel',s.channel,
        'mapped',EXISTS(
          SELECT 1 FROM app.channel_listing_mappings m
          WHERE m.tenant_id=selected_tenant AND m.variant_id=f.variant_id
            AND m.shop_id=s.id AND m.archived_at IS NULL
        ),
        'configuredQuantity',cp.quantity,'publishedQuantity',NULL,'syncedAt',NULL
      ) ORDER BY s.id)
      FROM app.shops s JOIN app.shop_products sp ON sp.tenant_id=s.tenant_id AND sp.shop_id=s.id AND sp.product_id=f.product_id
      LEFT JOIN app.inventory_channel_policies cp ON cp.tenant_id=s.tenant_id AND cp.variant_id=f.variant_id AND cp.shop_id=s.id
      WHERE s.tenant_id=selected_tenant AND s.id=ANY(selected_shop_ids)
    ),'[]'::jsonb) ELSE '[]'::jsonb END AS channels
    FROM filtered f
  )
  SELECT jsonb_build_object('items',coalesce(jsonb_agg(jsonb_build_object(
    'productId',product_id,'variantId',variant_id,'productName',product_name,'sku',sku,'onHand',on_hand,'reserved',reserved,
    'available',available,'safetyStock',safety_stock,'distributable',distributable,'distributionMode',distribution_mode,
    'balanceVersion',balance_version,'channels',channels,'sourceUpdatedAt',source_updated_at
  ) ORDER BY product_name,sku,variant_id),'[]'::jsonb)) INTO result FROM with_channels;
  RETURN result;
END $$;

REVOKE ALL ON FUNCTION app.assert_agent_read_receipt(uuid,uuid,text,uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.read_agent_products(uuid,uuid,uuid[],text,text,text,uuid[],integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.read_agent_sales(uuid,uuid,uuid[],date,date,uuid[],text,text[],integer,integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.read_agent_inventory(uuid,uuid,uuid[],text,uuid[],text,boolean,integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.read_agent_products(uuid,uuid,uuid[],text,text,text,uuid[],integer,integer) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.read_agent_sales(uuid,uuid,uuid[],date,date,uuid[],text,text[],integer,integer) TO commerce_app;
GRANT EXECUTE ON FUNCTION app.read_agent_inventory(uuid,uuid,uuid[],text,uuid[],text,boolean,integer,integer) TO commerce_app;
