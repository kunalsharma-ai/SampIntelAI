import { QA_FIXTURE_HOST, type Role } from '@si/contracts';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD, signIn, startHarness, tenant, type Harness } from './harness.js';

let h: Harness;
const csrf = { 'x-si-csrf': '1' };
type Agent = Awaited<ReturnType<typeof signIn>>['agent'];
let admin: Agent;
let ops: Agent;
let head: Agent;
let analyst: Agent;
let beta: Agent;

const fx = (path: string) => `https://${QA_FIXTURE_HOST}/s/${path}`;
const ALWAYS = [{ days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '24:00' }];
const authBody = (o: Record<string, unknown> = {}) => ({
  surveyOwner: 'DEMO Survey Owner Ltd',
  ownerContact: 'DEMO Head of Research',
  evidenceRef: 'DEMO-SOW-2026-114',
  purpose: 'Test survey logic, redirects and regressions on the sandbox fixtures',
  environments: ['sandbox'],
  allowedHosts: [QA_FIXTURE_HOST],
  maxSessions: 200,
  windows: ALWAYS,
  timezone: 'UTC',
  startsAt: new Date(Date.now() - 3600_000).toISOString(),
  expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
  classification: 'synthetic_qa',
  ...o,
});

async function user(role: Role, slug = 'alpha') {
  const email = `${role}@${slug}.example.invalid`;
  const a = slug === 'alpha' ? admin : beta;
  const r = await a.post('/api/v1/users').set(csrf).send({ name: `Test ${role}`, email, password: PASSWORD, roles: [role] });
  if (r.status !== 201 && r.status !== 200) throw new Error(`user ${r.status} ${JSON.stringify(r.body)}`);
  return (await signIn(h, slug, email)).agent;
}

async function approvedAuth(o: Record<string, unknown> = {}) {
  const r = await ops.post('/api/v1/authorizations').set(csrf).send(authBody(o));
  expect(r.status).toBe(201);
  const d = await head.post(`/api/v1/authorizations/${r.body.id}/decision`).set(csrf).send({ decision: 'approve', reason: 'Signed SOW on file' });
  expect(d.status).toBe(200);
  return r.body.id as string;
}

async function project(code: string, authorizationId: string, client = 'grocery-client/v1', gate: string | null = 'grocery-gate/v1', extra = {}) {
  const r = await ops
    .post('/api/v1/qa/projects')
    .set(csrf)
    .send({ code, name: `Test ${code}`, authorizationId, environment: 'sandbox', clientUrl: fx(client), ...(gate ? { gateUrl: fx(gate) } : {}), samptrekProjectRef: 'PRX10001', expectedLoiMinutes: 10, ...extra });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}

let profiles: { id: string; code: string }[];
const prof = (c: string) => profiles.find((p) => p.code === c)!.id;
async function scenario(projectId: string, name: string, profileCode: string, o: Record<string, unknown> = {}) {
  const r = await ops
    .post('/api/v1/qa/scenarios')
    .set(csrf)
    .send({ projectId, name, profileId: prof(profileCode), objective: 'complete_path', language: 'en', timing: 'nominal', answerStrategy: 'rules', ...o });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}
async function job(projectId: string, scenarioIds: string[], sessionsPerScenario = 1, extra = {}) {
  const r = await ops.post('/api/v1/qa/jobs').set(csrf).send({ projectId, scenarioIds, sessionsPerScenario, ...extra });
  return r;
}
const tick = async () => (await ops.post('/api/v1/qa/tick').set(csrf)).body;
const jobRow = async (id: string) => (await ops.get(`/api/v1/qa/jobs/${id}`)).body;

beforeAll(async () => {
  h = await startHarness();
  await tenant(h, 'alpha');
  await tenant(h, 'beta');
  admin = (await signIn(h, 'alpha', 'admin@alpha.example.invalid')).agent;
  beta = (await signIn(h, 'beta', 'admin@beta.example.invalid')).agent;
  ops = await user('ai_operations_manager');
  head = await user('supply_head');
  analyst = await user('quality_analyst');
  profiles = (await ops.get('/api/v1/qa/profiles')).body;
}, 60_000);
afterAll(async () => h?.close());

describe('authorization centre', () => {
  it('ships a fictional profile library', () => {
    expect(profiles.map((p) => p.code)).toEqual(['FP-01', 'FP-02', 'FP-03', 'FP-04', 'FP-05', 'FP-06', 'FP-07', 'FP-08']);
  });

  it('the QA operator can record a request but not approve it; a supply head approves', async () => {
    const r = await ops.post('/api/v1/authorizations').set(csrf).send(authBody());
    expect(r.status).toBe(201);
    expect(r.body.state).toBe('pending');
    const self = await ops.post(`/api/v1/authorizations/${r.body.id}/decision`).set(csrf).send({ decision: 'approve', reason: 'mine' });
    expect(self.status).toBe(403);
    const ok = await head.post(`/api/v1/authorizations/${r.body.id}/decision`).set(csrf).send({ decision: 'approve', reason: 'SOW on file' });
    expect(ok.body.state).toBe('approved');
    expect(ok.body.decidedByEmail).toBe('supply_head@alpha.example.invalid');
    const again = await head.post(`/api/v1/authorizations/${r.body.id}/decision`).set(csrf).send({ decision: 'reject', reason: 'late' });
    expect(again.status).toBe(409);
  });

  it('separation of duties holds even for an admin who holds every permission', async () => {
    const r = await admin.post('/api/v1/authorizations').set(csrf).send(authBody());
    const d = await admin.post(`/api/v1/authorizations/${r.body.id}/decision`).set(csrf).send({ decision: 'approve', reason: 'self' });
    expect(d.status).toBe(403);
    expect(d.body.code).toBe('separation_of_duties');
  });

  it('validates scope: expiry after start, at most a year, host names, the synthetic classification', async () => {
    const bad = [
      authBody({ expiresAt: new Date(Date.now() - 7200_000).toISOString() }),
      authBody({ expiresAt: new Date(Date.now() + 400 * 86_400_000).toISOString() }),
      authBody({ allowedHosts: ['https://x.example.com/path'] }),
      authBody({ classification: 'human' }),
    ];
    for (const b of bad) expect((await ops.post('/api/v1/authorizations').set(csrf).send(b)).status).toBe(400);
  });

  it('a pending authorization cannot back a QA project', async () => {
    const r = await ops.post('/api/v1/authorizations').set(csrf).send(authBody());
    const p = await ops.post('/api/v1/qa/projects').set(csrf).send({ code: 'QA-PENDING', name: 'Pending', authorizationId: r.body.id, environment: 'sandbox', clientUrl: fx('grocery-client/v1') });
    expect(p.status).toBe(409);
    expect(p.body.code).toBe('authorization_not_usable');
  });
});

describe('QA projects', () => {
  it('only allowed hosts and, in sandbox, only the fixture host', async () => {
    const a = await approvedAuth();
    const other = await ops.post('/api/v1/qa/projects').set(csrf).send({ code: 'QA-X1', name: 'Xyz', authorizationId: a, environment: 'sandbox', clientUrl: 'https://client.example.com/s/1' });
    expect(other.body.code).toBe('endpoint_not_allowed');
    const env = await ops.post('/api/v1/qa/projects').set(csrf).send({ code: 'QA-X2', name: 'Xyz', authorizationId: a, environment: 'live', clientUrl: fx('grocery-client/v1') });
    expect(env.body.code).toBe('environment_not_authorized');
    const a2 = await approvedAuth({ allowedHosts: [QA_FIXTURE_HOST, 'client.example.com'] });
    const sb = await ops.post('/api/v1/qa/projects').set(csrf).send({ code: 'QA-X3', name: 'Xyz', authorizationId: a2, environment: 'sandbox', clientUrl: 'https://client.example.com/s/1' });
    expect(sb.body.code).toBe('sandbox_only_fixtures');
  });
});

describe('execution, results and regression', () => {
  let pid: string;
  let jobA: string;
  let jobB: string;
  let scen: string[];

  it('runs a job: every session is recorded with its actual outcome, questions, assertions, IP and quality', async () => {
    const a = await approvedAuth();
    pid = await project('QA-GROCERY', a);
    scen = [
      await scenario(pid, 'Qualifier completes', 'FP-01', { assertions: { requiredQuestions: ['C5'] } }),
      await scenario(pid, 'Under age terminates', 'FP-05', { objective: 'terminate_path' }),
      await scenario(pid, '45 to 54 completes', 'FP-08'),
      await scenario(pid, 'Under age, wrong expectation', 'FP-05'),
    ];
    const j = await job(pid, scen, 2);
    expect(j.status).toBe(201);
    jobA = j.body.id;
    const t = await tick();
    expect(t.sessions).toBe(8);
    const row = await jobRow(jobA);
    expect(row.status).toBe('finished');
    expect(row.events.map((e: { kind: string }) => e.kind)).toContain('session_finished');

    const sessions = (await ops.get(`/api/v1/qa/sessions?jobId=${jobA}`)).body;
    expect(sessions).toHaveLength(8);
    expect(sessions.every((s: { classification: string }) => s.classification === 'synthetic_qa')).toBe(true);
    const by = (name: string) => sessions.filter((s: { scenarioName: string }) => s.scenarioName === name);
    expect(by('Qualifier completes').map((s: { outcome: string }) => s.outcome)).toEqual(['complete', 'complete']);
    expect(by('Under age terminates')[0].assertionsFailed).toBe(0);
    expect(by('Under age, wrong expectation')[0].assertionsFailed).toBe(1);

    const detail = (await ops.get(`/api/v1/qa/sessions/${by('Qualifier completes')[0].id}`)).body;
    expect(detail.questions.map((q: { questionId: string }) => q.questionId)).toContain('C5');
    expect(detail.validations.every((v: { passed: boolean }) => v.passed)).toBe(true);
    expect(detail.ip[0]).toMatchObject({ ip: '192.0.2.10', source: 'fixture_sandbox', riskScore: null });
    expect(detail.redirects[0]).toMatchObject({ allowed: true, outcome: 'complete' });
    expect(detail.clock).toBe('sandbox');
  });

  it('reports synthetic IR, LOI, question audit and quality, all labelled synthetic', async () => {
    const [s] = (await ops.get(`/api/v1/qa/stats?projectId=${pid}`)).body;
    expect(s.classification).toBe('synthetic_qa');
    expect(s.outcomes).toEqual({ complete: 4, terminate: 4 });
    expect(s.syntheticIrPercent).toBe(50);
    expect(s.loi.n).toBe(4);
    expect(s.loi.clock).toBe('sandbox');
    const q = (await ops.get(`/api/v1/qa/questions?projectId=${pid}&stage=gate`)).body;
    expect(q.find((r: { questionId: string }) => r.questionId === 'G2').shown).toBe(8);
    const quality = (await analyst.get(`/api/v1/qa/quality?projectId=${pid}`)).body;
    expect(quality.sessions).toHaveLength(8);
  });

  it('a quality analyst reviews a session; the QA operator cannot see IP records without permission', async () => {
    const [s] = (await analyst.get(`/api/v1/qa/sessions?projectId=${pid}`)).body;
    const r = await analyst.post(`/api/v1/qa/sessions/${s.id}/review`).set(csrf).send({ status: 'reviewed_ok', note: 'Expected path' });
    expect(r.status).toBe(200);
    expect((await head.get(`/api/v1/qa/ip-records?projectId=${pid}`)).status).toBe(403);
    expect((await analyst.get(`/api/v1/qa/ip-records?projectId=${pid}`)).body).toHaveLength(8);
  });

  it('compares two survey versions scenario by scenario', async () => {
    const u = await ops.patch(`/api/v1/qa/projects/${pid}/urls`).set(csrf).send({ clientUrl: fx('grocery-client/v2') });
    expect(u.status).toBe(200);
    const j = await job(pid, scen, 1);
    jobB = j.body.id;
    await tick();
    const r = (await ops.get(`/api/v1/qa/regression?a=${jobA}&b=${jobB}`)).body;
    const row = r.rows.find((x: { scenario: string }) => x.scenario === '45 to 54 completes');
    expect(row.a.main).toBe('complete');
    expect(row.b.main).toBe('quota_full');
    expect(row.outcomeChanged).toBe(true);
    const q = r.rows.find((x: { scenario: string }) => x.scenario === 'Qualifier completes');
    expect(q.questionsAdded).toEqual(['client:C8']);
    const sec = (await ops.get('/api/v1/qa/security-events')).body;
    expect(sec.map((e: { kind: string }) => e.kind)).toContain('prompt_injection_suspected');
  });

  it('exports separate synthetic CSVs, withholding question wording unless the owner allowed it', async () => {
    const s = await ops.get(`/api/v1/qa/exports/sessions.csv?projectId=${pid}`);
    expect(s.status).toBe(200);
    expect(s.headers['content-disposition']).toContain('SYNTHETIC-QA-GROCERY-sessions.csv');
    const lines = s.text.trim().split('\r\n');
    expect(lines[0]).toContain('classification');
    expect(lines.slice(1).every((l) => l.includes(',synthetic_qa,'))).toBe(true);
    const q = await ops.get(`/api/v1/qa/exports/questions?projectId=${pid}`);
    expect(q.text).toContain('[withheld: the authorization does not allow question content in exports]');
    expect(q.text).not.toContain('How old are you?');
    const hist = (await ops.get('/api/v1/qa/exports')).body;
    expect(hist.length).toBeGreaterThanOrEqual(2);
  });
});

describe('stop rules at the worker', () => {
  it('refuses a job past the session cap, and stops when the cap is reached', async () => {
    const a = await approvedAuth({ maxSessions: 3 });
    const p = await project('QA-CAP', a);
    const s = await scenario(p, 'cap one', 'FP-01');
    const big = await job(p, [s], 4);
    expect(big.status).toBe(409);
    expect(big.body.code).toBe('session_limit');
    const j1 = await job(p, [s], 2);
    const j2 = await job(p, [s], 1);
    const j3 = await job(p, [s], 1);
    await tick();
    expect((await jobRow(j1.body.id)).status).toBe('finished');
    expect((await jobRow(j2.body.id)).status).toBe('finished');
    expect(await jobRow(j3.body.id)).toMatchObject({ status: 'stopped', stopReason: 'session_limit' });
  });

  it('stops on a security challenge and on unexpected navigation', async () => {
    const a = await approvedAuth();
    const p1 = await project('QA-CAPTCHA', a, 'captcha-check/v1', null);
    const j1 = await job(p1, [await scenario(p1, 'captcha', 'FP-01')], 3);
    const p2 = await project('QA-REDIR', a, 'redirect-check/v1', null);
    const j2 = await job(p2, [await scenario(p2, 'redirect', 'FP-01')], 3);
    await tick();
    expect(await jobRow(j1.body.id)).toMatchObject({ status: 'stopped', stopReason: 'security_challenge', doneSessions: 1 });
    expect(await jobRow(j2.body.id)).toMatchObject({ status: 'stopped', stopReason: 'unexpected_navigation', doneSessions: 1 });
  });

  it('waits outside the execution window instead of running', async () => {
    const now = new Date();
    const day = (now.getUTCDay() + 3) % 7;
    const a = await approvedAuth({ windows: [{ days: [day], start: '00:00', end: '24:00' }] });
    const p = await project('QA-WINDOW', a);
    const j = await job(p, [await scenario(p, 'window', 'FP-01')], 1);
    await tick();
    expect(await jobRow(j.body.id)).toMatchObject({ status: 'queued', waitingFor: 'outside_execution_window', doneSessions: 0 });
  });

  it('revoking an authorization stops its jobs at once and blocks new ones', async () => {
    const a = await approvedAuth();
    const p = await project('QA-REVOKE', a);
    const s = await scenario(p, 'revoke', 'FP-01');
    const j = await job(p, [s], 1, { scheduledAt: new Date(Date.now() + 3600_000).toISOString() });
    const r = await ops.post(`/api/v1/authorizations/${a}/revoke`).set(csrf).send({ reason: 'Owner withdrew consent' });
    expect(r.body).toMatchObject({ state: 'revoked', jobsStopped: 1 });
    expect(await jobRow(j.body.id)).toMatchObject({ status: 'stopped', stopReason: 'authorization_revoked' });
    expect((await job(p, [s], 1)).body.code).toBe('authorization_not_usable');
  });

  it('the emergency stop halts every queued job and refuses new ones until cleared', async () => {
    const a = await approvedAuth();
    const p = await project('QA-KILL', a);
    const s = await scenario(p, 'kill', 'FP-01');
    const j = await job(p, [s], 1, { scheduledAt: new Date(Date.now() + 3600_000).toISOString() });
    const k = await head.put('/api/v1/qa/kill-switch').set(csrf).send({ on: true, reason: 'Drill' });
    expect(k.body.jobsStopped).toBeGreaterThanOrEqual(1);
    expect(await jobRow(j.body.id)).toMatchObject({ status: 'stopped', stopReason: 'emergency_stop' });
    expect((await job(p, [s], 1)).body.code).toBe('emergency_stop');
    await head.put('/api/v1/qa/kill-switch').set(csrf).send({ on: false, reason: 'Drill over' });
    expect((await job(p, [s], 1)).status).toBe(201);
    await tick();
  });
});

describe('model gateway and budgets', () => {
  it('refuses to turn on a live provider without a key, and never returns a key', async () => {
    const off = await ops.put('/api/v1/ai/providers/anthropic').set(csrf).send({ model: 'test-model', enabled: true, timeoutMs: 15000, maxOutputTokens: 300, priceInputPerMTokUsd: 3, priceOutputPerMTokUsd: 15 });
    expect(off.body.code).toBe('key_required');
    await ops.put('/api/v1/ai/providers/anthropic').set(csrf).send({ model: 'test-model', apiKey: 'sk-test-not-a-real-key', enabled: false, timeoutMs: 15000, maxOutputTokens: 300, priceInputPerMTokUsd: 3, priceOutputPerMTokUsd: 15 });
    const list = await ops.get('/api/v1/ai/providers');
    expect(JSON.stringify(list.body)).not.toContain('sk-test');
    expect(list.body.find((p: { provider: string }) => p.provider === 'anthropic').hasKey).toBe(true);
  });

  it('answers open questions through the FIXTURE provider, records usage, and stops the job at the budget', async () => {
    await ops.put('/api/v1/ai/providers/fixture').set(csrf).send({ model: 'fixture-answerer', enabled: true, timeoutMs: 5000, maxOutputTokens: 200, priceInputPerMTokUsd: 100, priceOutputPerMTokUsd: 400 });
    const a = await approvedAuth();
    const p = await project('QA-MODEL', a);
    const s = await scenario(p, 'model', 'FP-01', { answerStrategy: 'model' });
    const j1 = await job(p, [s], 1);
    await tick();
    expect((await jobRow(j1.body.id)).status).toBe('finished');
    const usage = (await ops.get('/api/v1/ai/usage')).body;
    expect(usage.recent.filter((u: { status: string }) => u.status === 'ok')).toHaveLength(2);
    expect(usage.recent[0].modelVersion).toBe('fixture-answerer@fixture-1');
    const det = (await ops.get(`/api/v1/qa/sessions?jobId=${j1.body.id}`)).body[0];
    const qs = (await ops.get(`/api/v1/qa/sessions/${det.id}`)).body.questions;
    expect(qs.filter((q: { answeredBy: string }) => q.answeredBy === 'model')).toHaveLength(2);

    const spent = usage.totals.reduce((n: number, t: { costUsd: number }) => n + t.costUsd, 0);
    const b = await ops.put('/api/v1/ai/budgets').set(csrf).send({ scope: 'project', projectId: p, period: 'day', limitUsd: spent + 0.0001 });
    expect(b.status).toBe(200);
    const j2 = await job(p, [s], 3);
    await tick();
    expect(await jobRow(j2.body.id)).toMatchObject({ status: 'stopped', stopReason: 'budget_limit' });
    const after = (await ops.get('/api/v1/ai/usage')).body;
    expect(after.recent.some((u: { status: string }) => u.status === 'refused_budget')).toBe(true);
    const budgets = (await ops.get('/api/v1/ai/budgets')).body;
    expect(budgets[0]).toMatchObject({ scope: 'project', period: 'day' });
    await ops.put('/api/v1/ai/providers/fixture').set(csrf).send({ model: 'fixture-answerer', enabled: false, timeoutMs: 5000, maxOutputTokens: 200, priceInputPerMTokUsd: 100, priceOutputPerMTokUsd: 400 });
  });
});

describe('Supply360 link and isolation', () => {
  let token: string;
  it('issues a scoped token once and serves a synthetic-only summary for a SampTrek project', async () => {
    const t = await admin.post('/api/v1/integration/tokens').set(csrf).send({ name: 'Supply360', scopes: ['qa_summary.read'], expiresInDays: 30 });
    expect(t.status).toBe(201);
    token = t.body.token;
    const list = (await admin.get('/api/v1/integration/tokens')).body;
    expect(JSON.stringify(list)).not.toContain(token.split('.')[3]);
    const s = await h.http.get('/api/v1/integration/qa-summary?projectRef=PRX10001').set('authorization', `Bearer ${token}`);
    expect(s.status).toBe(200);
    expect(s.body.classification).toBe('synthetic_qa');
    expect(s.body.sessions).toBeGreaterThan(0);
    expect(s.body.projects.map((p: { code: string }) => p.code)).toContain('QA-GROCERY');
    expect(JSON.stringify(s.body)).not.toMatch(/How old|questionText|FP-0/);
  });

  it('refuses a missing, forged or revoked token', async () => {
    expect((await h.http.get('/api/v1/integration/qa-summary?projectRef=PRX10001')).status).toBe(401);
    const forged = token.slice(0, -4) + 'AAAA';
    expect((await h.http.get('/api/v1/integration/qa-summary?projectRef=PRX10001').set('authorization', `Bearer ${forged}`)).status).toBe(401);
    const id = token.split('.')[2];
    await admin.delete(`/api/v1/integration/tokens/${id}`).set(csrf);
    expect((await h.http.get('/api/v1/integration/qa-summary?projectRef=PRX10001').set('authorization', `Bearer ${token}`)).status).toBe(401);
  });

  it('another tenant sees none of it', async () => {
    expect((await beta.get('/api/v1/qa/projects')).body).toEqual([]);
    expect((await beta.get('/api/v1/authorizations')).body).toEqual([]);
    expect((await beta.get('/api/v1/qa/sessions')).body).toEqual([]);
  });

  it('the app role cannot rewrite execution, usage or security logs', async () => {
    const c = new pg.Client({ connectionString: h.appUrl });
    await c.connect();
    for (const t of ['execution_events', 'ai_usage_records', 'security_events']) {
      await expect(c.query(`update ${t} set tenant_id = tenant_id`)).rejects.toThrow(/permission denied/);
      await expect(c.query(`delete from ${t}`)).rejects.toThrow(/permission denied/);
    }
    await c.end();
  });

  it('every consequential step is audited', async () => {
    const actions = (await admin.get('/api/v1/audit?limit=200')).body.items.map((i: { action: string }) => i.action);
    for (const a of ['authorization.requested', 'authorization.approved', 'authorization.revoked', 'qa_project.created', 'qa_job.queued', 'qa.emergency_stop.on', 'budget.set', 'export.created', 'integration_token.created'])
      expect(actions).toContain(a);
  });
});
