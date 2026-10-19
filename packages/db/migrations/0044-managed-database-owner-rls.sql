-- Runtime roles never own application tables and remain subject to RLS.
-- The managed database owner is used only for migration and synthetic staging
-- seed work, then its credential is removed before web/worker processes start.
-- FORCE would also apply policies inside owner-executed SECURITY DEFINER helper
-- functions, recursively invoking membership policies on managed PostgreSQL.
DO $$
DECLARE target record;
BEGIN
  FOR target IN
    SELECT n.nspname AS schema_name, c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'app'
      AND c.relkind = 'r'
      AND c.relrowsecurity
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I NO FORCE ROW LEVEL SECURITY',
      target.schema_name,
      target.table_name
    );
  END LOOP;
END $$;
