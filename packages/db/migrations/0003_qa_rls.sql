-- Phase 6 tenant isolation for synthetic QA. Event, usage and security logs are append-only for the app.
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON project_authorizations, ai_projects, synthetic_profiles, qa_scenarios, survey_versions, execution_jobs, synthetic_sessions, survey_question_records, validation_results, redirect_results, ip_risk_records, quality_assessments, provider_configurations, api_budget_limits, integration_clients, report_exports TO si_app;
--> statement-breakpoint
-- Scenarios, budgets and profiles can be removed; everything that records what happened cannot.
--> statement-breakpoint
GRANT DELETE ON qa_scenarios, api_budget_limits, synthetic_profiles TO si_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON execution_events, security_events, ai_usage_records TO si_app;
--> statement-breakpoint
ALTER TABLE project_authorizations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE project_authorizations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON project_authorizations USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
ALTER TABLE ai_projects ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ai_projects FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON ai_projects USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
ALTER TABLE synthetic_profiles ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE synthetic_profiles FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON synthetic_profiles USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
ALTER TABLE qa_scenarios ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE qa_scenarios FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON qa_scenarios USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
ALTER TABLE survey_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE survey_versions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON survey_versions USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
ALTER TABLE execution_jobs ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE execution_jobs FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON execution_jobs USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
ALTER TABLE synthetic_sessions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE synthetic_sessions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON synthetic_sessions USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
ALTER TABLE survey_question_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE survey_question_records FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON survey_question_records USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
ALTER TABLE validation_results ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE validation_results FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON validation_results USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
ALTER TABLE redirect_results ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE redirect_results FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON redirect_results USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
ALTER TABLE ip_risk_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ip_risk_records FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON ip_risk_records USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
ALTER TABLE quality_assessments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE quality_assessments FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON quality_assessments USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
ALTER TABLE provider_configurations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE provider_configurations FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON provider_configurations USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
ALTER TABLE api_budget_limits ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api_budget_limits FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON api_budget_limits USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
ALTER TABLE integration_clients ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE integration_clients FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON integration_clients USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
ALTER TABLE report_exports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE report_exports FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON report_exports USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
ALTER TABLE execution_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE execution_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON execution_events USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE security_events FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON security_events USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
--> statement-breakpoint
ALTER TABLE ai_usage_records ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE ai_usage_records FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON ai_usage_records USING (tenant_id = app_tenant_id()) WITH CHECK (tenant_id = app_tenant_id());
