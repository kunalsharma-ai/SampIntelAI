import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  bigint,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * Phase 1 schema. Every table except `tenants` carries `tenant_id` and is protected by row-level security
 * (migration 0001_rls.sql): the API connects as `si_app`, which can only see rows of the tenant set in
 * `app.tenant_id` for the current transaction.
 */
const id = () =>
  uuid('id')
    .primaryKey()
    .default(sql`uuidv7()`);
const tenantId = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'restrict' });
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const tenantStatus = pgEnum('tenant_status', ['active', 'suspended']);
export const userStatus = pgEnum('user_status', ['active', 'disabled']);

export const tenants = pgTable('tenants', {
  id: id(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  status: tenantStatus('status').notNull().default('active'),
  createdAt: createdAt(),
});

export const users = pgTable(
  'users',
  {
    id: id(),
    tenantId: tenantId(),
    email: text('email').notNull(),
    name: text('name').notNull(),
    passwordHash: text('password_hash').notNull(),
    roles: text('roles').array().notNull(),
    status: userStatus('status').notNull().default('active'),
    /** AES-256-GCM sealed TOTP secret; null until enrolment starts. */
    totpSecret: text('totp_secret'),
    mfaEnabled: boolean('mfa_enabled').notNull().default(false),
    /** Last accepted TOTP time step, so a code can be used once. */
    totpLastStep: bigint('totp_last_step', { mode: 'number' }),
    failedSignIns: integer('failed_sign_ins').notNull().default(0),
    lockedUntil: timestamp('locked_until', { withTimezone: true }),
    lastSignInAt: timestamp('last_sign_in_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('users_tenant_email').on(t.tenantId, t.email), index('users_tenant').on(t.tenantId)],
);

export const sessions = pgTable(
  'sessions',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** password: MFA still owed; full: signed in. */
    stage: text('stage').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    userAgent: text('user_agent'),
    ip: text('ip'),
    createdAt: createdAt(),
  },
  (t) => [index('sessions_user').on(t.tenantId, t.userId)],
);

/** Append-only (UPDATE and DELETE revoked from si_app in 0001_rls.sql). */
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: id(),
    tenantId: tenantId(),
    at: timestamp('at', { withTimezone: true }).notNull().defaultNow(),
    actorId: uuid('actor_id'),
    actorEmail: text('actor_email'),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    reason: text('reason'),
    correlationId: text('correlation_id'),
    details: jsonb('details').notNull().default({}),
  },
  (t) => [index('audit_tenant_at').on(t.tenantId, t.at.desc(), t.id.desc())],
);

export const settings = pgTable(
  'settings',
  {
    id: id(),
    tenantId: tenantId(),
    key: text('key').notNull(),
    value: jsonb('value').notNull(),
    version: integer('version').notNull().default(1),
    updatedBy: uuid('updated_by'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('settings_tenant_key').on(t.tenantId, t.key)],
);

export const notifications = pgTable(
  'notifications',
  {
    id: id(),
    tenantId: tenantId(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    severity: text('severity').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    link: text('link'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('notifications_user').on(t.tenantId, t.userId, t.createdAt.desc())],
);

/* ---------------------------------------------------------------------------------------------------------------
 * Phase 6: authorized synthetic QA (spec §9). Everything below is synthetic and kept apart from any human data.
 * Migration 0003_qa_rls.sql adds tenant isolation and makes the event, usage and security logs append-only.
 * ------------------------------------------------------------------------------------------------------------- */

const ts = (name: string) => timestamp(name, { withTimezone: true });

export const authorizationStatus = pgEnum('authorization_status', ['pending', 'approved', 'rejected', 'revoked']);

/** Survey-owner authorizations. The person who requests one can never be the person who approves it. */
export const projectAuthorizations = pgTable(
  'project_authorizations',
  {
    id: id(),
    tenantId: tenantId(),
    status: authorizationStatus('status').notNull().default('pending'),
    surveyOwner: text('survey_owner').notNull(),
    ownerContact: text('owner_contact').notNull(),
    evidenceRef: text('evidence_ref').notNull(),
    purpose: text('purpose').notNull(),
    environments: text('environments').array().notNull(),
    allowedHosts: text('allowed_hosts').array().notNull(),
    maxSessions: integer('max_sessions').notNull(),
    windows: jsonb('windows').notNull(),
    timezone: text('timezone').notNull(),
    startsAt: ts('starts_at').notNull(),
    expiresAt: ts('expires_at').notNull(),
    classification: text('classification').notNull().default('synthetic_qa'),
    exportQuestionContent: boolean('export_question_content').notNull().default(false),
    requestedBy: uuid('requested_by').notNull(),
    requestedByEmail: text('requested_by_email').notNull(),
    decidedBy: uuid('decided_by'),
    decidedByEmail: text('decided_by_email'),
    decidedAt: ts('decided_at'),
    decisionReason: text('decision_reason'),
    revokedBy: uuid('revoked_by'),
    revokedAt: ts('revoked_at'),
    revokeReason: text('revoke_reason'),
    createdAt: createdAt(),
  },
  (t) => [index('authorizations_tenant').on(t.tenantId, t.createdAt.desc())],
);

export const aiProjects = pgTable(
  'ai_projects',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    name: text('name').notNull(),
    samptrekProjectRef: text('samptrek_project_ref'),
    authorizationId: uuid('authorization_id')
      .notNull()
      .references(() => projectAuthorizations.id, { onDelete: 'restrict' }),
    environment: text('environment').notNull(),
    status: text('status').notNull().default('active'),
    gateUrl: text('gate_url'),
    clientUrl: text('client_url').notNull(),
    expectedLoiMinutes: integer('expected_loi_minutes'),
    expectedIrPercent: integer('expected_ir_percent'),
    createdBy: uuid('created_by'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ai_projects_code').on(t.tenantId, t.code),
    index('ai_projects_ref').on(t.tenantId, t.samptrekProjectRef),
  ],
);

/** Fictional profiles. No real person, no real panel identity. */
export const syntheticProfiles = pgTable(
  'synthetic_profiles',
  {
    id: id(),
    tenantId: tenantId(),
    code: text('code').notNull(),
    label: text('label').notNull(),
    age: integer('age').notNull(),
    gender: text('gender').notNull(),
    country: text('country').notNull(),
    language: text('language').notNull(),
    attributes: jsonb('attributes').notNull().default({}),
    builtin: boolean('builtin').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('profiles_code').on(t.tenantId, t.code)],
);

export const qaScenarios = pgTable(
  'qa_scenarios',
  {
    id: id(),
    tenantId: tenantId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => aiProjects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    profileId: uuid('profile_id')
      .notNull()
      .references(() => syntheticProfiles.id, { onDelete: 'restrict' }),
    objective: text('objective').notNull(),
    language: text('language').notNull(),
    timing: text('timing').notNull(),
    answerStrategy: text('answer_strategy').notNull(),
    assertions: jsonb('assertions').notNull().default({}),
    overrides: jsonb('overrides').notNull().default({}),
    archivedAt: ts('archived_at'),
    createdAt: createdAt(),
  },
  (t) => [index('scenarios_project').on(t.tenantId, t.projectId)],
);

/** Survey versions as the runner discovered them, so regression runs can compare question sets. */
export const surveyVersions = pgTable(
  'survey_versions',
  {
    id: id(),
    tenantId: tenantId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => aiProjects.id, { onDelete: 'cascade' }),
    stage: text('stage').notNull(),
    url: text('url').notNull(),
    fingerprint: text('fingerprint').notNull(),
    questionIds: text('question_ids').array().notNull(),
    firstSeenAt: createdAt(),
    lastSeenAt: ts('last_seen_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('survey_versions_key').on(t.tenantId, t.projectId, t.stage, t.url, t.fingerprint)],
);

export const executionJobs = pgTable(
  'execution_jobs',
  {
    id: id(),
    tenantId: tenantId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => aiProjects.id, { onDelete: 'cascade' }),
    authorizationId: uuid('authorization_id').notNull(),
    status: text('status').notNull().default('queued'),
    scenarioIds: uuid('scenario_ids').array().notNull(),
    sessionsPerScenario: integer('sessions_per_scenario').notNull(),
    totalSessions: integer('total_sessions').notNull(),
    doneSessions: integer('done_sessions').notNull().default(0),
    intervalSeconds: integer('interval_seconds').notNull().default(0),
    scheduledAt: ts('scheduled_at').notNull().defaultNow(),
    nextRunAt: ts('next_run_at').notNull().defaultNow(),
    stopReason: text('stop_reason'),
    waitingFor: text('waiting_for'),
    createdBy: uuid('created_by'),
    createdByEmail: text('created_by_email'),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
    createdAt: createdAt(),
  },
  (t) => [
    index('jobs_due').on(t.tenantId, t.status, t.nextRunAt),
    index('jobs_project').on(t.tenantId, t.projectId, t.createdAt.desc()),
  ],
);

/** Append-only. */
export const executionEvents = pgTable(
  'execution_events',
  {
    id: id(),
    tenantId: tenantId(),
    jobId: uuid('job_id').notNull(),
    sessionId: uuid('session_id'),
    kind: text('kind').notNull(),
    detail: jsonb('detail').notNull().default({}),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('job_events').on(t.tenantId, t.jobId, t.at)],
);

export const syntheticSessions = pgTable(
  'synthetic_sessions',
  {
    id: id(),
    tenantId: tenantId(),
    projectId: uuid('project_id')
      .notNull()
      .references(() => aiProjects.id, { onDelete: 'cascade' }),
    jobId: uuid('job_id').notNull(),
    scenarioId: uuid('scenario_id').notNull(),
    profileId: uuid('profile_id').notNull(),
    seq: integer('seq').notNull(),
    classification: text('classification').notNull().default('synthetic_qa'),
    environment: text('environment').notNull(),
    language: text('language').notNull(),
    outcome: text('outcome').notNull(),
    stopReason: text('stop_reason'),
    lastStage: text('last_stage').notNull(),
    surveyUrls: jsonb('survey_urls').notNull(),
    redirectUrl: text('redirect_url'),
    /** Seconds on the runner's clock. The FIXTURE driver reports sandbox seconds, labelled as such. */
    loiSeconds: integer('loi_seconds').notNull(),
    clock: text('clock').notNull(),
    questionCount: integer('question_count').notNull(),
    assertionsPassed: integer('assertions_passed').notNull(),
    assertionsFailed: integer('assertions_failed').notNull(),
    qualityScore: integer('quality_score').notNull(),
    reviewStatus: text('review_status').notNull().default('open'),
    reviewNote: text('review_note'),
    reviewedBy: text('reviewed_by'),
    reviewedAt: ts('reviewed_at'),
    startedAt: ts('started_at').notNull(),
    endedAt: ts('ended_at').notNull(),
  },
  (t) => [
    uniqueIndex('sessions_job_seq').on(t.tenantId, t.jobId, t.seq),
    index('sessions_project').on(t.tenantId, t.projectId, t.startedAt.desc()),
  ],
);

/** Question-level synthetic records: what was shown and what the fictional profile answered. */
export const surveyQuestionRecords = pgTable(
  'survey_question_records',
  {
    id: id(),
    tenantId: tenantId(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => syntheticSessions.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    stage: text('stage').notNull(),
    questionId: text('question_id').notNull(),
    questionText: text('question_text').notNull(),
    inputKind: text('input_kind').notNull(),
    detectedType: text('detected_type').notNull(),
    topic: text('topic'),
    language: text('language').notNull(),
    answer: jsonb('answer'),
    answeredBy: text('answered_by').notNull(),
    validation: text('validation').notNull(),
    flags: text('flags').array().notNull(),
    seconds: integer('seconds').notNull(),
  },
  (t) => [index('questions_session').on(t.tenantId, t.sessionId, t.seq)],
);

export const validationResults = pgTable(
  'validation_results',
  {
    id: id(),
    tenantId: tenantId(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => syntheticSessions.id, { onDelete: 'cascade' }),
    assertion: text('assertion').notNull(),
    passed: boolean('passed').notNull(),
    expected: text('expected'),
    actual: text('actual'),
  },
  (t) => [index('validations_session').on(t.tenantId, t.sessionId)],
);

export const redirectResults = pgTable(
  'redirect_results',
  {
    id: id(),
    tenantId: tenantId(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => syntheticSessions.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    host: text('host').notNull(),
    allowed: boolean('allowed').notNull(),
    outcome: text('outcome'),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('redirects_session').on(t.tenantId, t.sessionId)],
);

/** Actual, permitted network metadata of the runner. No rotation, no disguise, no reputation work. */
export const ipRiskRecords = pgTable(
  'ip_risk_records',
  {
    id: id(),
    tenantId: tenantId(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => syntheticSessions.id, { onDelete: 'cascade' }),
    projectId: uuid('project_id').notNull(),
    ip: text('ip').notNull(),
    source: text('source').notNull(),
    geo: text('geo'),
    isp: text('isp'),
    riskScore: integer('risk_score'),
    riskProvider: text('risk_provider'),
    duplicateCount: integer('duplicate_count').notNull(),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('ip_project').on(t.tenantId, t.projectId, t.at.desc())],
);

export const qualityAssessments = pgTable(
  'quality_assessments',
  {
    id: id(),
    tenantId: tenantId(),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => syntheticSessions.id, { onDelete: 'cascade' }),
    score: integer('score').notNull(),
    findings: jsonb('findings').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('quality_session').on(t.tenantId, t.sessionId)],
);

/** Append-only security log: challenges, unexpected navigation, refusals, prompt-injection attempts, stops. */
export const securityEvents = pgTable(
  'security_events',
  {
    id: id(),
    tenantId: tenantId(),
    projectId: uuid('project_id'),
    jobId: uuid('job_id'),
    sessionId: uuid('session_id'),
    kind: text('kind').notNull(),
    severity: text('severity').notNull(),
    detail: jsonb('detail').notNull().default({}),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('security_tenant_at').on(t.tenantId, t.at.desc())],
);

export const providerConfigurations = pgTable(
  'provider_configurations',
  {
    id: id(),
    tenantId: tenantId(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    sealedKey: text('sealed_key'),
    enabled: boolean('enabled').notNull().default(false),
    timeoutMs: integer('timeout_ms').notNull(),
    maxOutputTokens: integer('max_output_tokens').notNull(),
    /** Micro-dollars per million tokens, entered by the tenant. */
    priceInputMicros: bigint('price_input_micros', { mode: 'number' }).notNull(),
    priceOutputMicros: bigint('price_output_micros', { mode: 'number' }).notNull(),
    updatedBy: uuid('updated_by'),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('providers_tenant').on(t.tenantId, t.provider)],
);

/** Append-only. */
export const aiUsageRecords = pgTable(
  'ai_usage_records',
  {
    id: id(),
    tenantId: tenantId(),
    projectId: uuid('project_id'),
    jobId: uuid('job_id'),
    sessionId: uuid('session_id'),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    modelVersion: text('model_version'),
    purpose: text('purpose').notNull(),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    costMicros: bigint('cost_micros', { mode: 'number' }).notNull(),
    latencyMs: integer('latency_ms').notNull(),
    status: text('status').notNull(),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [
    index('usage_tenant_at').on(t.tenantId, t.at.desc()),
    index('usage_project_at').on(t.tenantId, t.projectId, t.at),
  ],
);

export const apiBudgetLimits = pgTable(
  'api_budget_limits',
  {
    id: id(),
    tenantId: tenantId(),
    scope: text('scope').notNull(),
    projectId: uuid('project_id').references(() => aiProjects.id, { onDelete: 'cascade' }),
    period: text('period').notNull(),
    limitMicros: bigint('limit_micros', { mode: 'number' }).notNull(),
    updatedBy: uuid('updated_by'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('budgets_tenant_key')
      .on(t.tenantId, t.period)
      .where(sql`project_id is null`),
    uniqueIndex('budgets_project_key')
      .on(t.tenantId, t.projectId, t.period)
      .where(sql`project_id is not null`),
  ],
);

/** Scoped service tokens for other applications (Supply360). Only a SHA-256 of the secret is stored. */
export const integrationClients = pgTable('integration_clients', {
  id: id(),
  tenantId: tenantId(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull(),
  scopes: text('scopes').array().notNull(),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  lastUsedAt: ts('last_used_at'),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
});

export const reportExports = pgTable(
  'report_exports',
  {
    id: id(),
    tenantId: tenantId(),
    kind: text('kind').notNull(),
    projectId: uuid('project_id'),
    rows: integer('rows').notNull(),
    questionContent: boolean('question_content').notNull(),
    createdBy: uuid('created_by'),
    createdByEmail: text('created_by_email'),
    createdAt: createdAt(),
  },
  (t) => [index('exports_tenant').on(t.tenantId, t.createdAt.desc())],
);
