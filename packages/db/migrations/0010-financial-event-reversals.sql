ALTER TABLE app.financial_events
  ADD COLUMN reverses_event_id uuid;

ALTER TABLE app.financial_events
  ADD CONSTRAINT financial_events_shop_event_unique UNIQUE(tenant_id,shop_id,id),
  ADD CONSTRAINT financial_events_reversal_fk
    FOREIGN KEY(tenant_id,shop_id,reverses_event_id)
    REFERENCES app.financial_events(tenant_id,shop_id,id),
  ADD CONSTRAINT financial_events_not_self_reversing
    CHECK(reverses_event_id IS NULL OR reverses_event_id<>id);

ALTER TABLE app.financial_events
  DROP CONSTRAINT financial_events_source_scope_check,
  ADD CONSTRAINT financial_events_source_scope_check
    CHECK(source_scope IN ('outside_imported_net_receipt','event_reversal')),
  ADD CONSTRAINT financial_events_reversal_scope_check CHECK(
    (source_scope='outside_imported_net_receipt' AND reverses_event_id IS NULL)
    OR (source_scope='event_reversal' AND reverses_event_id IS NOT NULL)
  );

CREATE UNIQUE INDEX financial_events_one_reversal_idx
  ON app.financial_events(tenant_id,shop_id,reverses_event_id)
  WHERE reverses_event_id IS NOT NULL;

