CREATE TYPE "public"."authorization_status" AS ENUM('pending', 'approved', 'rejected', 'revoked');--> statement-breakpoint
CREATE TABLE "ai_projects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"samptrek_project_ref" text,
	"authorization_id" uuid NOT NULL,
	"environment" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"gate_url" text,
	"client_url" text NOT NULL,
	"expected_loi_minutes" integer,
	"expected_ir_percent" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_usage_records" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid,
	"job_id" uuid,
	"session_id" uuid,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"model_version" text,
	"purpose" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_micros" bigint NOT NULL,
	"latency_ms" integer NOT NULL,
	"status" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "api_budget_limits" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"project_id" uuid,
	"period" text NOT NULL,
	"limit_micros" bigint NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"session_id" uuid,
	"kind" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"authorization_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"scenario_ids" uuid[] NOT NULL,
	"sessions_per_scenario" integer NOT NULL,
	"total_sessions" integer NOT NULL,
	"done_sessions" integer DEFAULT 0 NOT NULL,
	"interval_seconds" integer DEFAULT 0 NOT NULL,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stop_reason" text,
	"waiting_for" text,
	"created_by" uuid,
	"created_by_email" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integration_clients" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ip_risk_records" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"ip" text NOT NULL,
	"source" text NOT NULL,
	"geo" text,
	"isp" text,
	"risk_score" integer,
	"risk_provider" text,
	"duplicate_count" integer NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_authorizations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"status" "authorization_status" DEFAULT 'pending' NOT NULL,
	"survey_owner" text NOT NULL,
	"owner_contact" text NOT NULL,
	"evidence_ref" text NOT NULL,
	"purpose" text NOT NULL,
	"environments" text[] NOT NULL,
	"allowed_hosts" text[] NOT NULL,
	"max_sessions" integer NOT NULL,
	"windows" jsonb NOT NULL,
	"timezone" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"classification" text DEFAULT 'synthetic_qa' NOT NULL,
	"export_question_content" boolean DEFAULT false NOT NULL,
	"requested_by" uuid NOT NULL,
	"requested_by_email" text NOT NULL,
	"decided_by" uuid,
	"decided_by_email" text,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"revoked_by" uuid,
	"revoked_at" timestamp with time zone,
	"revoke_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_configurations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"sealed_key" text,
	"enabled" boolean DEFAULT false NOT NULL,
	"timeout_ms" integer NOT NULL,
	"max_output_tokens" integer NOT NULL,
	"price_input_micros" bigint NOT NULL,
	"price_output_micros" bigint NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qa_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text NOT NULL,
	"profile_id" uuid NOT NULL,
	"objective" text NOT NULL,
	"language" text NOT NULL,
	"timing" text NOT NULL,
	"answer_strategy" text NOT NULL,
	"assertions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "quality_assessments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"findings" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "redirect_results" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"url" text NOT NULL,
	"host" text NOT NULL,
	"allowed" boolean NOT NULL,
	"outcome" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "report_exports" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"project_id" uuid,
	"rows" integer NOT NULL,
	"question_content" boolean NOT NULL,
	"created_by" uuid,
	"created_by_email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid,
	"job_id" uuid,
	"session_id" uuid,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "survey_question_records" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"stage" text NOT NULL,
	"question_id" text NOT NULL,
	"question_text" text NOT NULL,
	"input_kind" text NOT NULL,
	"detected_type" text NOT NULL,
	"topic" text,
	"language" text NOT NULL,
	"answer" jsonb,
	"answered_by" text NOT NULL,
	"validation" text NOT NULL,
	"flags" text[] NOT NULL,
	"seconds" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "survey_versions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"url" text NOT NULL,
	"fingerprint" text NOT NULL,
	"question_ids" text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "synthetic_profiles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"age" integer NOT NULL,
	"gender" text NOT NULL,
	"country" text NOT NULL,
	"language" text NOT NULL,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"builtin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "synthetic_sessions" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"scenario_id" uuid NOT NULL,
	"profile_id" uuid NOT NULL,
	"seq" integer NOT NULL,
	"classification" text DEFAULT 'synthetic_qa' NOT NULL,
	"environment" text NOT NULL,
	"language" text NOT NULL,
	"outcome" text NOT NULL,
	"stop_reason" text,
	"last_stage" text NOT NULL,
	"survey_urls" jsonb NOT NULL,
	"redirect_url" text,
	"loi_seconds" integer NOT NULL,
	"clock" text NOT NULL,
	"question_count" integer NOT NULL,
	"assertions_passed" integer NOT NULL,
	"assertions_failed" integer NOT NULL,
	"quality_score" integer NOT NULL,
	"review_status" text DEFAULT 'open' NOT NULL,
	"review_note" text,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "validation_results" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"assertion" text NOT NULL,
	"passed" boolean NOT NULL,
	"expected" text,
	"actual" text
);
--> statement-breakpoint
ALTER TABLE "ai_projects" ADD CONSTRAINT "ai_projects_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_projects" ADD CONSTRAINT "ai_projects_authorization_id_project_authorizations_id_fk" FOREIGN KEY ("authorization_id") REFERENCES "public"."project_authorizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_usage_records" ADD CONSTRAINT "ai_usage_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_budget_limits" ADD CONSTRAINT "api_budget_limits_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_budget_limits" ADD CONSTRAINT "api_budget_limits_project_id_ai_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."ai_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_events" ADD CONSTRAINT "execution_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD CONSTRAINT "execution_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_jobs" ADD CONSTRAINT "execution_jobs_project_id_ai_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."ai_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_clients" ADD CONSTRAINT "integration_clients_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ip_risk_records" ADD CONSTRAINT "ip_risk_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ip_risk_records" ADD CONSTRAINT "ip_risk_records_session_id_synthetic_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."synthetic_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_authorizations" ADD CONSTRAINT "project_authorizations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_configurations" ADD CONSTRAINT "provider_configurations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_scenarios" ADD CONSTRAINT "qa_scenarios_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_scenarios" ADD CONSTRAINT "qa_scenarios_project_id_ai_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."ai_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qa_scenarios" ADD CONSTRAINT "qa_scenarios_profile_id_synthetic_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."synthetic_profiles"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_assessments" ADD CONSTRAINT "quality_assessments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quality_assessments" ADD CONSTRAINT "quality_assessments_session_id_synthetic_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."synthetic_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redirect_results" ADD CONSTRAINT "redirect_results_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "redirect_results" ADD CONSTRAINT "redirect_results_session_id_synthetic_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."synthetic_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_question_records" ADD CONSTRAINT "survey_question_records_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_question_records" ADD CONSTRAINT "survey_question_records_session_id_synthetic_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."synthetic_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_versions" ADD CONSTRAINT "survey_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_versions" ADD CONSTRAINT "survey_versions_project_id_ai_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."ai_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synthetic_profiles" ADD CONSTRAINT "synthetic_profiles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synthetic_sessions" ADD CONSTRAINT "synthetic_sessions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "synthetic_sessions" ADD CONSTRAINT "synthetic_sessions_project_id_ai_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."ai_projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_results" ADD CONSTRAINT "validation_results_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_results" ADD CONSTRAINT "validation_results_session_id_synthetic_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."synthetic_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_projects_code" ON "ai_projects" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE INDEX "ai_projects_ref" ON "ai_projects" USING btree ("tenant_id","samptrek_project_ref");--> statement-breakpoint
CREATE INDEX "usage_tenant_at" ON "ai_usage_records" USING btree ("tenant_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "usage_project_at" ON "ai_usage_records" USING btree ("tenant_id","project_id","at");--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_tenant_key" ON "api_budget_limits" USING btree ("tenant_id","period") WHERE project_id is null;--> statement-breakpoint
CREATE UNIQUE INDEX "budgets_project_key" ON "api_budget_limits" USING btree ("tenant_id","project_id","period") WHERE project_id is not null;--> statement-breakpoint
CREATE INDEX "job_events" ON "execution_events" USING btree ("tenant_id","job_id","at");--> statement-breakpoint
CREATE INDEX "jobs_due" ON "execution_jobs" USING btree ("tenant_id","status","next_run_at");--> statement-breakpoint
CREATE INDEX "jobs_project" ON "execution_jobs" USING btree ("tenant_id","project_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "ip_project" ON "ip_risk_records" USING btree ("tenant_id","project_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "authorizations_tenant" ON "project_authorizations" USING btree ("tenant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "providers_tenant" ON "provider_configurations" USING btree ("tenant_id","provider");--> statement-breakpoint
CREATE INDEX "scenarios_project" ON "qa_scenarios" USING btree ("tenant_id","project_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quality_session" ON "quality_assessments" USING btree ("tenant_id","session_id");--> statement-breakpoint
CREATE INDEX "redirects_session" ON "redirect_results" USING btree ("tenant_id","session_id");--> statement-breakpoint
CREATE INDEX "exports_tenant" ON "report_exports" USING btree ("tenant_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "security_tenant_at" ON "security_events" USING btree ("tenant_id","at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "questions_session" ON "survey_question_records" USING btree ("tenant_id","session_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_versions_key" ON "survey_versions" USING btree ("tenant_id","project_id","stage","url","fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "profiles_code" ON "synthetic_profiles" USING btree ("tenant_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_job_seq" ON "synthetic_sessions" USING btree ("tenant_id","job_id","seq");--> statement-breakpoint
CREATE INDEX "sessions_project" ON "synthetic_sessions" USING btree ("tenant_id","project_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "validations_session" ON "validation_results" USING btree ("tenant_id","session_id");