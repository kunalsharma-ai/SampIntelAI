import { ROLE_LABELS, Role } from '@si/contracts';
import { QA_FIXTURE_HOST } from '@si/contracts';
import {
  aiProjects,
  createDb,
  createPool,
  notifications,
  projectAuthorizations,
  providerConfigurations,
  qaScenarios,
  syntheticProfiles,
  tenants,
  users,
} from '@si/db';
import { fixtureUrl } from '../qa/fixture-surveys.js';
import { PROFILE_LIBRARY } from '../qa/profiles.js';
import { eq } from 'drizzle-orm';
import { AuthService } from '../auth/auth.service.js';
import { provisionTenant } from './provision.js';

/**
 * DEMO tenant for local previews only: slug `demo`, one fictional account per role at `@demo.example.invalid`.
 * Never run against production. Refuses unless NODE_ENV is development or test.
 */
const url = process.env.DATABASE_ADMIN_URL;
const password = process.env.SI_DEMO_PASSWORD;
if (!url || !password) throw new Error('DATABASE_ADMIN_URL and SI_DEMO_PASSWORD are required');
if (!['development', 'test'].includes(process.env.NODE_ENV ?? 'development'))
  throw new Error('Demo seed is for local use only');

const { tenantId } = await provisionTenant(url, {
  slug: 'demo',
  name: 'DEMO workspace',
  admin: { email: 'tenant_admin@demo.example.invalid', name: 'DEMO Tenant Admin', password },
});
const pool = createPool(url, 1);
const db = createDb(pool);
const hash = await AuthService.hashPassword(password);
for (const r of Role.options.filter((r) => r !== 'tenant_admin')) {
  await db.insert(users).values({
    tenantId,
    email: `${r}@demo.example.invalid`,
    name: `DEMO ${ROLE_LABELS[r]}`,
    roles: [r],
    passwordHash: hash,
  });
}
await db.insert(notifications).values({
  tenantId,
  kind: 'system',
  severity: 'info',
  title: 'DEMO workspace',
  body: 'This workspace holds fictional accounts only. No source system is connected.',
});

// DEMO synthetic QA set-up: one approved and one pending survey-owner authorization, one sandbox QA project and its
// scenarios. Every name says DEMO; every host is the in-process sandbox. Nothing here describes a real person.
const people = await db.select({ id: users.id, email: users.email }).from(users).where(eq(users.tenantId, tenantId));
const who = (r: string) => people.find((p) => p.email.startsWith(`${r}@`))!;
const ops = who('ai_operations_manager');
const head = who('supply_head');
const DAY = 86_400_000;
const always = [{ days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '24:00' }];
const base = {
  tenantId,
  environments: ['sandbox'],
  allowedHosts: [QA_FIXTURE_HOST],
  windows: always,
  timezone: 'Asia/Kolkata',
  startsAt: new Date(Date.now() - DAY),
  requestedBy: ops.id,
  requestedByEmail: ops.email,
};
const [approved] = await db
  .insert(projectAuthorizations)
  .values({
    ...base,
    status: 'approved',
    surveyOwner: 'DEMO Survey Owner Ltd',
    ownerContact: 'DEMO Head of Research',
    evidenceRef: 'DEMO-SOW-2026-114',
    purpose: 'Test the grocery screener and tracker logic, redirects and version changes on sandbox fixtures',
    maxSessions: 500,
    expiresAt: new Date(Date.now() + 60 * DAY),
    decidedBy: head.id,
    decidedByEmail: head.email,
    decidedAt: new Date(),
    decisionReason: 'DEMO: signed SOW checked',
  })
  .returning();
await db.insert(projectAuthorizations).values({
  ...base,
  surveyOwner: 'DEMO Retail Insights GmbH',
  ownerContact: 'DEMO Research Director',
  evidenceRef: 'DEMO-TICKET-8812',
  purpose: 'Localization QA of the German questionnaire on sandbox fixtures',
  maxSessions: 100,
  expiresAt: new Date(Date.now() + 30 * DAY),
});
const profiles = await db
  .insert(syntheticProfiles)
  .values(PROFILE_LIBRARY.map((p) => ({ tenantId, ...p, attributes: p.attributes as Record<string, unknown>, builtin: true })))
  .returning();
const pid = (c: string) => profiles.find((p) => p.code === c)!.id;
const [project] = await db
  .insert(aiProjects)
  .values({
    tenantId,
    code: 'QA-GROCERY',
    name: 'DEMO Grocery tracker QA',
    samptrekProjectRef: 'PRX10001',
    authorizationId: approved!.id,
    environment: 'sandbox',
    gateUrl: fixtureUrl('grocery-gate/v1'),
    clientUrl: fixtureUrl('grocery-client/v1'),
    expectedLoiMinutes: 12,
    expectedIrPercent: 40,
    createdBy: ops.id,
  })
  .returning();
await db.insert(qaScenarios).values(
  (
    [
      ['Qualifier completes', 'FP-01', 'complete_path', {}, {}],
      ['Under age terminates at the gate', 'FP-05', 'terminate_path', {}, {}],
      ['Rarely shops terminates', 'FP-07', 'terminate_path', {}, {}],
      ['55+ meets a full quota', 'FP-06', 'any', { expectOutcome: 'quota_full' }, {}],
      ['45 to 54 completes', 'FP-08', 'complete_path', {}, {}],
      ['Age range check fires', 'FP-02', 'complete_path', {}, { G2: 150 }],
    ] as const
  ).map(([name, code, objective, assertions, overrides]) => ({
    tenantId,
    projectId: project!.id,
    name,
    profileId: pid(code),
    objective,
    language: 'en',
    timing: 'nominal',
    answerStrategy: 'rules',
    assertions,
    overrides,
  })),
);
await db.insert(providerConfigurations).values({
  tenantId,
  provider: 'fixture',
  model: 'fixture-answerer',
  enabled: false,
  timeoutMs: 5000,
  maxOutputTokens: 200,
  priceInputMicros: 0,
  priceOutputMicros: 0,
});
const [t] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
console.log(`DEMO tenant ${t?.slug} seeded with ${Role.options.length} accounts.`);
await pool.end();
