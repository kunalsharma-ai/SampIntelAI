ALTER TABLE "provider_configurations" ADD COLUMN "kind" text DEFAULT 'fixture' NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_configurations" ADD COLUMN "label" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_configurations" ADD COLUMN "base_url" text;--> statement-breakpoint
ALTER TABLE "provider_configurations" ADD COLUMN "auth_style" text DEFAULT 'bearer' NOT NULL;--> statement-breakpoint
-- Existing rows were keyed by the API they speak, so their kind is their id.
UPDATE "provider_configurations" SET "kind" = "provider" WHERE "provider" IN ('fixture', 'anthropic', 'openai', 'gemini');--> statement-breakpoint
UPDATE "provider_configurations" SET "label" = CASE "provider" WHEN 'fixture' THEN 'FIXTURE' WHEN 'anthropic' THEN 'Claude (Anthropic)' WHEN 'openai' THEN 'OpenAI' WHEN 'gemini' THEN 'Gemini (Google)' ELSE "provider" END WHERE "label" = '';--> statement-breakpoint
ALTER TABLE "provider_configurations" ADD CONSTRAINT "provider_kind_known" CHECK ("kind" IN ('fixture', 'anthropic', 'openai', 'gemini', 'openai_compatible'));--> statement-breakpoint
ALTER TABLE "provider_configurations" ADD CONSTRAINT "provider_auth_style_known" CHECK ("auth_style" IN ('bearer', 'api-key'));--> statement-breakpoint
ALTER TABLE "provider_configurations" ADD CONSTRAINT "provider_base_url_https" CHECK ("base_url" IS NULL OR "base_url" LIKE 'https://%');--> statement-breakpoint
-- Tenants can now remove a connection they added.
GRANT DELETE ON provider_configurations TO si_app;
