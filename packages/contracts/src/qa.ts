import { z } from 'zod';

/**
 * Authorized synthetic QA (spec §9). Every record here is synthetic: fictional profiles answering approved test
 * surveys. Nothing in this file describes a real respondent, and no synthetic outcome may be counted as human sample.
 */
export const SYNTHETIC_CLASSIFICATION = 'synthetic_qa' as const;

/** The in-process sandbox survey host. It is the only host the FIXTURE driver serves. */
export const QA_FIXTURE_HOST = 'qa-fixture.sampintel.invalid';

export const QaEnvironment = z.enum(['sandbox', 'test', 'live']);
export type QaEnvironment = z.infer<typeof QaEnvironment>;
export const ENVIRONMENT_LABELS: Record<QaEnvironment, string> = {
  sandbox: 'Sandbox fixtures',
  test: 'Approved test environment',
  live: 'Live (owner-authorized)',
};

export const QA_LANGUAGES = ['en', 'de', 'fr', 'es', 'hi'] as const;
export const QaLanguage = z.enum(QA_LANGUAGES);
export type QaLanguage = z.infer<typeof QaLanguage>;
export const LANGUAGE_LABELS: Record<QaLanguage, string> = {
  en: 'English',
  de: 'German',
  fr: 'French',
  es: 'Spanish',
  hi: 'Hindi',
};

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM, 24-hour');
export const ExecutionWindow = z
  .object({
    days: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    start: hhmm,
    end: z.union([hhmm, z.literal('24:00')]),
  })
  .refine((w) => w.start < w.end, { message: 'A window must end after it starts', path: ['end'] });
export type ExecutionWindow = z.infer<typeof ExecutionWindow>;

const hostname = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/,
    'A host name such as qa.example.com',
  );

const DAY = 86_400_000;
export const AuthorizationRequest = z
  .object({
    surveyOwner: z.string().trim().min(2).max(120),
    /** Name and role of the person at the survey owner who gave the authorization. */
    ownerContact: z.string().trim().min(2).max(120),
    /** Where the signed authorization lives, such as a contract or ticket reference. */
    evidenceRef: z.string().trim().min(3).max(200),
    purpose: z.string().trim().min(10).max(500),
    environments: z.array(QaEnvironment).min(1).max(3),
    allowedHosts: z.array(hostname).min(1).max(20),
    maxSessions: z.number().int().min(1).max(10_000),
    windows: z.array(ExecutionWindow).min(1).max(14),
    timezone: z.string().min(1).max(64),
    startsAt: z.iso.datetime({ offset: true }),
    expiresAt: z.iso.datetime({ offset: true }),
    classification: z.literal(SYNTHETIC_CLASSIFICATION),
    /** Whether question wording may appear in exports. Off unless the owner allowed it. */
    exportQuestionContent: z.boolean().default(false),
  })
  .refine((a) => Date.parse(a.expiresAt) > Date.parse(a.startsAt), {
    message: 'The authorization must expire after it starts',
    path: ['expiresAt'],
  })
  .refine((a) => Date.parse(a.expiresAt) - Date.parse(a.startsAt) <= 366 * DAY, {
    message: 'An authorization can last at most a year',
    path: ['expiresAt'],
  });
export type AuthorizationRequest = z.infer<typeof AuthorizationRequest>;

export const AuthorizationDecision = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().min(3).max(500),
});
export const AuthorizationRevoke = z.object({ reason: z.string().trim().min(3).max(500) });

export const AUTHORIZATION_STATES = ['pending', 'approved', 'rejected', 'revoked', 'expired'] as const;
export type AuthorizationState = (typeof AUTHORIZATION_STATES)[number];

const code = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9-]{3,32}$/, 'Letters, digits and dashes, 3 to 32');

export const QaProjectCreate = z.object({
  code,
  name: z.string().trim().min(3).max(120),
  /** The SampTrek project this QA belongs to, typed by hand. It links the summary shown in Supply360. */
  samptrekProjectRef: code.optional(),
  authorizationId: z.uuid(),
  environment: QaEnvironment,
  gateUrl: z
    .url({ protocol: /^https$/ })
    .max(500)
    .optional(),
  clientUrl: z.url({ protocol: /^https$/ }).max(500),
  expectedLoiMinutes: z.number().int().min(1).max(120).optional(),
  expectedIrPercent: z.number().int().min(1).max(100).optional(),
});
export type QaProjectCreate = z.infer<typeof QaProjectCreate>;
/** A new survey version, for example after the client updated the test link. Re-checked against the authorization. */
export const QaProjectUrls = z.object({
  gateUrl: z
    .url({ protocol: /^https$/ })
    .max(500)
    .nullable()
    .optional(),
  clientUrl: z.url({ protocol: /^https$/ }).max(500),
});
export const QaProjectStatus = z.object({ status: z.enum(['active', 'paused', 'closed']) });

export const SyntheticProfileCreate = z.object({
  label: z.string().trim().min(3).max(80),
  age: z.number().int().min(10).max(99),
  gender: z.enum(['female', 'male', 'non_binary']),
  country: z.string().regex(/^[A-Z]{2}$/),
  language: QaLanguage,
  attributes: z.record(
    z.string().max(40),
    z.union([z.string().max(120), z.number(), z.array(z.string().max(60)).max(10)]),
  ),
});
export type SyntheticProfileCreate = z.infer<typeof SyntheticProfileCreate>;

export const OBJECTIVES = ['complete_path', 'terminate_path', 'any'] as const;
export const Objective = z.enum(OBJECTIVES);
export const OBJECTIVE_LABELS: Record<(typeof OBJECTIVES)[number], string> = {
  complete_path: 'Complete path',
  terminate_path: 'Terminate path',
  any: 'Explore (no expected outcome)',
};

/** Bounded QA timing scenarios for timeout and latency tests. Never human imitation or detection avoidance. */
export const TIMINGS = ['nominal', 'slow_pages', 'timeout'] as const;
export const Timing = z.enum(TIMINGS);
export const TIMING_LABELS: Record<(typeof TIMINGS)[number], string> = {
  nominal: 'Nominal: steady pace',
  slow_pages: 'Slow pages: 20 s added page latency',
  timeout: 'Timeout: one page past the 60 s page limit',
};

export const SYNTHETIC_OUTCOMES = [
  'complete',
  'terminate',
  'quota_full',
  'security_stop',
  'navigation_stop',
  'timeout',
  'error',
] as const;
export const SyntheticOutcome = z.enum(SYNTHETIC_OUTCOMES);
export type SyntheticOutcome = z.infer<typeof SyntheticOutcome>;
export const SYNTHETIC_OUTCOME_LABELS: Record<SyntheticOutcome, string> = {
  complete: 'Complete',
  terminate: 'Terminate',
  quota_full: 'Quota full',
  security_stop: 'Stopped: security challenge',
  navigation_stop: 'Stopped: unexpected navigation',
  timeout: 'Timeout',
  error: 'Error',
};

const answer = z.union([z.string().max(500), z.number(), z.array(z.string().max(60)).max(20)]);
export const ScenarioCreate = z.object({
  projectId: z.uuid(),
  name: z.string().trim().min(3).max(120),
  profileId: z.uuid(),
  objective: Objective,
  language: QaLanguage,
  timing: Timing,
  answerStrategy: z.enum(['rules', 'model']),
  assertions: z
    .object({
      expectOutcome: SyntheticOutcome.optional(),
      maxLoiSeconds: z.number().int().min(10).max(7200).optional(),
      requiredQuestions: z.array(z.string().max(40)).max(30).optional(),
    })
    .default({}),
  /** Fixed answers by question id, for deterministic test cases (for example an out-of-range age). */
  overrides: z.record(z.string().max(40), answer).default({}),
});
export type ScenarioCreate = z.infer<typeof ScenarioCreate>;

export const JobCreate = z.object({
  projectId: z.uuid(),
  scenarioIds: z.array(z.uuid()).min(1).max(20),
  sessionsPerScenario: z.number().int().min(1).max(50),
  scheduledAt: z.iso.datetime({ offset: true }).optional(),
  /** Seconds between two sessions of this job (Interval Controller). Bounded, never randomised. */
  intervalSeconds: z.number().int().min(0).max(3600).default(0),
});
export type JobCreate = z.infer<typeof JobCreate>;

export const JOB_STOP_LABELS: Record<string, string> = {
  emergency_stop: 'Emergency stop',
  authorization_revoked: 'Authorization revoked',
  authorization_expired: 'Authorization expired',
  authorization_not_approved: 'Authorization not approved',
  environment_not_authorized: 'Environment not in the authorization',
  endpoint_not_allowed: 'Survey host not in the authorization',
  session_limit: 'Authorization session cap reached',
  budget_limit: 'Model budget reached',
  project_paused: 'QA project paused',
  project_closed: 'QA project closed',
  security_challenge: 'Security challenge met',
  unexpected_navigation: 'Unexpected navigation',
  driver_unavailable: 'No approved driver for this host',
  cancelled: 'Cancelled',
};

export const SessionReview = z.object({
  status: z.enum(['reviewed_ok', 'reviewed_issue']),
  note: z.string().trim().min(3).max(500),
});

/**
 * How SampIntel talks to a model. Most providers (free and paid) speak the OpenAI chat format, so
 * `openai_compatible` plus a base URL covers them; Claude and Gemini use their own APIs.
 */
export const PROVIDER_KINDS = ['fixture', 'anthropic', 'openai', 'gemini', 'openai_compatible'] as const;
export const ProviderKind = z.enum(PROVIDER_KINDS);
export type ProviderKind = z.infer<typeof ProviderKind>;
export const PROVIDER_KIND_LABELS: Record<ProviderKind, string> = {
  fixture: 'FIXTURE (deterministic, no network)',
  anthropic: 'Claude API (Anthropic)',
  openai: 'OpenAI API',
  gemini: 'Gemini API (Google)',
  openai_compatible: 'OpenAI-compatible API',
};

/** A tenant's name for one AI connection, such as "groq" or "claude-prod". The fixture connection is always "fixture". */
export const ConnectionId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{1,39}$/, 'Use 2 to 40 lowercase letters, digits or dashes');
export type ConnectionId = z.infer<typeof ConnectionId>;

export const AuthStyle = z.enum(['bearer', 'api-key']);
export type AuthStyle = z.infer<typeof AuthStyle>;

const httpsUrl = z
  .url({ protocol: /^https$/, error: 'Use an https:// address' })
  .max(300)
  .refine((u) => !new URL(u).username && !new URL(u).password, 'Put the key in the API key field, not in the address');

export const ProviderConfig = z.object({
  kind: ProviderKind,
  label: z.string().trim().min(2).max(60),
  /** Required for openai_compatible; optional override for the others. https only, public hosts only. */
  baseUrl: httpsUrl.optional(),
  /** How the key is sent to an OpenAI-compatible API: Authorization Bearer (most) or an api-key header (Azure). */
  authStyle: AuthStyle.default('bearer'),
  model: z.string().trim().min(1).max(120),
  /** Sent once and sealed at rest; never returned. Omit to keep the stored key. */
  apiKey: z.string().trim().min(8).max(1000).optional(),
  enabled: z.boolean(),
  timeoutMs: z.number().int().min(1000).max(120_000),
  maxOutputTokens: z.number().int().min(16).max(16_000),
  /** Prices are what your contract says, entered by you; SampIntel never assumes a price. Use 0 for a free tier. */
  priceInputPerMTokUsd: z.number().min(0).max(1000),
  priceOutputPerMTokUsd: z.number().min(0).max(1000),
});
export type ProviderConfig = z.infer<typeof ProviderConfig>;

/** Ask a provider which models a key can use, before or after saving the connection. */
export const ModelListRequest = z.object({
  kind: ProviderKind.exclude(['fixture']),
  baseUrl: httpsUrl.optional(),
  authStyle: AuthStyle.default('bearer'),
  apiKey: z.string().trim().min(8).max(1000).optional(),
  /** Use the key already stored for this saved connection when no key is typed. */
  connection: ConnectionId.optional(),
});
export type ModelListRequest = z.infer<typeof ModelListRequest>;

export interface AiPreset {
  id: string;
  label: string;
  kind: Exclude<ProviderKind, 'fixture'>;
  baseUrl?: string;
  authStyle?: AuthStyle;
  /** Only where the model id is stable and documented; otherwise the person picks from "Load models". */
  model?: string;
  maxOutputTokens?: number;
  freeTier: boolean;
  keyPage: string;
  note?: string;
}

/**
 * Ready-made starting points for the "Add AI" screen. Every field stays editable, and "Custom" covers any other
 * OpenAI-compatible service. A free tier is the provider's offer and can change; check its page.
 */
export const AI_PRESETS: AiPreset[] = [
  {
    id: 'claude',
    label: 'Claude (Anthropic)',
    kind: 'anthropic',
    model: 'claude-opus-5-5',
    maxOutputTokens: 2000,
    freeTier: false,
    keyPage: 'https://console.anthropic.com/settings/keys',
  },
  { id: 'openai', label: 'OpenAI', kind: 'openai', freeTier: false, keyPage: 'https://platform.openai.com/api-keys' },
  {
    id: 'gemini',
    label: 'Gemini (Google)',
    kind: 'gemini',
    freeTier: true,
    keyPage: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'groq',
    label: 'Groq',
    kind: 'openai_compatible',
    baseUrl: 'https://api.groq.com/openai/v1',
    freeTier: true,
    keyPage: 'https://console.groq.com/keys',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    kind: 'openai_compatible',
    baseUrl: 'https://openrouter.ai/api/v1',
    freeTier: true,
    keyPage: 'https://openrouter.ai/settings/keys',
    note: 'Model ids ending in :free cost nothing',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    kind: 'openai_compatible',
    baseUrl: 'https://api.mistral.ai/v1',
    freeTier: true,
    keyPage: 'https://console.mistral.ai/api-keys',
  },
  {
    id: 'cerebras',
    label: 'Cerebras',
    kind: 'openai_compatible',
    baseUrl: 'https://api.cerebras.ai/v1',
    freeTier: true,
    keyPage: 'https://cloud.cerebras.ai',
  },
  {
    id: 'huggingface',
    label: 'Hugging Face',
    kind: 'openai_compatible',
    baseUrl: 'https://router.huggingface.co/v1',
    freeTier: true,
    keyPage: 'https://huggingface.co/settings/tokens',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    kind: 'openai_compatible',
    baseUrl: 'https://api.deepseek.com/v1',
    freeTier: false,
    keyPage: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    kind: 'openai_compatible',
    baseUrl: 'https://api.x.ai/v1',
    freeTier: false,
    keyPage: 'https://console.x.ai',
  },
  {
    id: 'together',
    label: 'Together AI',
    kind: 'openai_compatible',
    baseUrl: 'https://api.together.xyz/v1',
    freeTier: false,
    keyPage: 'https://api.together.ai/settings/api-keys',
  },
  {
    id: 'fireworks',
    label: 'Fireworks AI',
    kind: 'openai_compatible',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    freeTier: false,
    keyPage: 'https://fireworks.ai/account/api-keys',
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    kind: 'openai_compatible',
    baseUrl: 'https://api.perplexity.ai',
    freeTier: false,
    keyPage: 'https://www.perplexity.ai/settings/api',
  },
  {
    id: 'azure',
    label: 'Azure OpenAI',
    kind: 'openai_compatible',
    baseUrl: 'https://YOUR-RESOURCE.openai.azure.com/openai/v1',
    authStyle: 'api-key',
    freeTier: false,
    keyPage: 'https://portal.azure.com',
    note: 'Replace YOUR-RESOURCE; the model is your deployment name',
  },
  {
    id: 'custom',
    label: 'Any other AI (OpenAI-compatible)',
    kind: 'openai_compatible',
    freeTier: false,
    keyPage: '',
    note: "Paste the base URL from the provider's API docs, usually ending in /v1",
  },
];

export const BudgetLimit = z
  .object({
    scope: z.enum(['tenant', 'project']),
    projectId: z.uuid().optional(),
    period: z.enum(['day', 'month']),
    limitUsd: z.number().positive().max(1_000_000),
  })
  .refine((b) => (b.scope === 'project') === !!b.projectId, {
    message: 'A project budget needs a project, a tenant budget must not have one',
    path: ['projectId'],
  });
export type BudgetLimit = z.infer<typeof BudgetLimit>;

export const QaKillSwitch = z.object({ on: z.boolean(), reason: z.string().trim().min(3).max(300) });

export const INTEGRATION_SCOPES = ['qa_summary.read'] as const;
export const IntegrationTokenCreate = z.object({
  name: z.string().trim().min(3).max(80),
  scopes: z.array(z.enum(INTEGRATION_SCOPES)).min(1),
  expiresInDays: z.number().int().min(1).max(365),
});

export const EXPORT_KINDS = ['sessions', 'questions'] as const;

export const FINDING_LABELS: Record<string, string> = {
  straightlining: 'Same answer on every matrix row',
  repetition: 'Open answers repeat each other',
  inconsistent_age: 'Age differs between gate and client survey',
  ranking_invalid: 'Ranking is not a complete order',
  validation_missing: 'Survey accepted an out-of-range answer',
  validation_fired: 'Survey rejected an invalid answer as expected',
  localization_missing: 'Question not shown in the requested language',
  type_mismatch: 'Question type differs from its input',
  prompt_injection_suspected: 'Survey text tried to instruct the model',
  fast_vs_expected: 'Much shorter than the expected LOI (context, not a rejection)',
  model_output_invalid: 'Model answer failed its schema, rules used instead',
};
