-- CON-TTS-01a: tenant/shop-scoped TikTok seller authorization metadata.
-- Provider tokens are encrypted by the application before entering PostgreSQL
-- and are never exposed through the app schema or SELECT policies.
CREATE TABLE app.marketplace_connections (
  tenant_id uuid NOT NULL REFERENCES app.tenants(id),
  id uuid NOT NULL,
  shop_id uuid NOT NULL,
  provider text NOT NULL CHECK(provider IN ('tiktok_shop')),
  connector_environment text NOT NULL CHECK(connector_environment IN ('development','production')),
  status text NOT NULL CHECK(status IN ('authorized','validated','action_required','revoked')),
  provider_open_id text NOT NULL CHECK(length(provider_open_id) BETWEEN 1 AND 200),
  provider_shop_id text,
  provider_shop_cipher text,
  provider_shop_name text,
  granted_scopes text[] NOT NULL DEFAULT '{}',
  token_expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  connected_by uuid NOT NULL REFERENCES private.users(id),
  last_validated_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,id),
  UNIQUE(tenant_id,shop_id,provider),
  FOREIGN KEY(tenant_id,shop_id) REFERENCES app.shops(tenant_id,id),
  CONSTRAINT marketplace_connection_shop_fields CHECK(
    (status='authorized' AND provider_shop_id IS NULL AND provider_shop_cipher IS NULL AND provider_shop_name IS NULL AND last_validated_at IS NULL)
    OR (status IN ('validated','action_required','revoked'))
  )
);
CREATE INDEX marketplace_connections_shop_idx ON app.marketplace_connections(tenant_id,shop_id,provider,status);

CREATE TABLE private.marketplace_connection_credentials (
  tenant_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  access_token_ciphertext text NOT NULL CHECK(length(access_token_ciphertext) BETWEEN 40 AND 12000),
  refresh_token_ciphertext text NOT NULL CHECK(length(refresh_token_ciphertext) BETWEEN 40 AND 12000),
  encryption_key_version text NOT NULL CHECK(length(encryption_key_version) BETWEEN 1 AND 30),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,connection_id),
  FOREIGN KEY(tenant_id,connection_id) REFERENCES app.marketplace_connections(tenant_id,id) ON DELETE CASCADE
);

ALTER TABLE app.marketplace_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY marketplace_connections_read ON app.marketplace_connections FOR SELECT TO commerce_app USING(
  tenant_id=app.tenant_id() AND app.member_role(tenant_id) IN ('owner','operator','auditor') AND app.shop_allowed(tenant_id,shop_id)
);

CREATE FUNCTION app.complete_marketplace_authorization(
  selected_id uuid,selected_shop uuid,selected_provider text,selected_environment text,selected_open_id text,selected_scopes text[],
  selected_token_expires_at timestamptz,selected_refresh_expires_at timestamptz,access_ciphertext text,refresh_ciphertext text,key_version text
) RETURNS TABLE(id uuid,status text,version integer) LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE saved_connection_id uuid;saved_connection_version integer;
BEGIN
  IF app.tenant_id() IS NULL OR app.actor_id() IS NULL OR app.member_role(app.tenant_id())<>'owner'
    OR selected_id IS NULL OR selected_provider<>'tiktok_shop' OR selected_environment NOT IN ('development','production')
    OR length(selected_open_id) NOT BETWEEN 1 AND 200 OR cardinality(selected_scopes)>100
    OR length(access_ciphertext) NOT BETWEEN 40 AND 12000 OR length(refresh_ciphertext) NOT BETWEEN 40 AND 12000
    OR length(key_version) NOT BETWEEN 1 AND 30 OR NOT app.shop_allowed(app.tenant_id(),selected_shop)
    OR NOT EXISTS(SELECT 1 FROM app.shops s WHERE s.tenant_id=app.tenant_id() AND s.id=selected_shop AND s.channel='tiktok')
  THEN RAISE EXCEPTION 'MARKETPLACE_AUTHORIZATION_INVALID'; END IF;

  INSERT INTO app.marketplace_connections(tenant_id,id,shop_id,provider,connector_environment,status,provider_open_id,granted_scopes,
    token_expires_at,refresh_token_expires_at,connected_by)
  VALUES(app.tenant_id(),selected_id,selected_shop,selected_provider,selected_environment,'authorized',selected_open_id,selected_scopes,
    selected_token_expires_at,selected_refresh_expires_at,app.actor_id())
  ON CONFLICT(tenant_id,shop_id,provider) DO UPDATE SET
    connector_environment=excluded.connector_environment,status='authorized',provider_open_id=excluded.provider_open_id,
    provider_shop_id=NULL,provider_shop_cipher=NULL,provider_shop_name=NULL,granted_scopes=excluded.granted_scopes,
    token_expires_at=excluded.token_expires_at,refresh_token_expires_at=excluded.refresh_token_expires_at,
    connected_by=app.actor_id(),last_validated_at=NULL,version=app.marketplace_connections.version+1,updated_at=clock_timestamp()
  RETURNING app.marketplace_connections.id,app.marketplace_connections.version INTO saved_connection_id,saved_connection_version;

  INSERT INTO private.marketplace_connection_credentials(tenant_id,connection_id,access_token_ciphertext,refresh_token_ciphertext,encryption_key_version)
  VALUES(app.tenant_id(),saved_connection_id,access_ciphertext,refresh_ciphertext,key_version)
  ON CONFLICT(tenant_id,connection_id) DO UPDATE SET access_token_ciphertext=excluded.access_token_ciphertext,
    refresh_token_ciphertext=excluded.refresh_token_ciphertext,encryption_key_version=excluded.encryption_key_version,updated_at=clock_timestamp();

  INSERT INTO app.audit_events(tenant_id,id,actor_id,action,entity_id,details)
  VALUES(app.tenant_id(),gen_random_uuid(),app.actor_id(),'marketplace.tiktok.authorized',saved_connection_id,
    jsonb_build_object('shopId',selected_shop,'environment',selected_environment,'scopeCount',cardinality(selected_scopes),'version',saved_connection_version));
  RETURN QUERY SELECT saved_connection_id,'authorized'::text,saved_connection_version;
END $$;

REVOKE ALL ON app.marketplace_connections FROM PUBLIC;
REVOKE ALL ON private.marketplace_connection_credentials FROM PUBLIC;
REVOKE ALL ON FUNCTION app.complete_marketplace_authorization(uuid,uuid,text,text,text,text[],timestamptz,timestamptz,text,text,text) FROM PUBLIC;
GRANT SELECT ON app.marketplace_connections TO commerce_app;
GRANT EXECUTE ON FUNCTION app.complete_marketplace_authorization(uuid,uuid,text,text,text,text[],timestamptz,timestamptz,text,text,text) TO commerce_app;
