-- Tenant isolation (ADR-005). The API connects as a login role that is a member of si_app.
-- si_app is not a table owner, so row-level security always applies to it.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'si_app') THEN
    CREATE ROLE si_app NOLOGIN;
  END IF;
END $$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO si_app;--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_tenant_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;--> statement-breakpoint

-- Tenants: the app may look a tenant up by slug at sign-in, never change one.
GRANT SELECT ON tenants TO si_app;--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE ON users, sessions, settings, notifications TO si_app;--> statement-breakpoint
-- The audit log is append-only for the app.
GRANT SELECT, INSERT ON audit_logs TO si_app;--> statement-breakpoint

ALTER TABLE users ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE users FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON users USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());--> statement-breakpoint
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON sessions USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());--> statement-breakpoint
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON audit_logs USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());--> statement-breakpoint
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE settings FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON settings USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());--> statement-breakpoint
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON notifications USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
