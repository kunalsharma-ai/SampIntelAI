import { Inject, Injectable } from '@nestjs/common';
import {
  QA_FIXTURE_HOST,
  type JobCreate,
  type QaProjectCreate,
  type ScenarioCreate,
  type SyntheticProfileCreate,
} from '@si/contracts';
import {
  aiProjects,
  executionEvents,
  executionJobs,
  ipRiskRecords,
  projectAuthorizations,
  qaScenarios,
  qualityAssessments,
  redirectResults,
  securityEvents,
  settings,
  surveyQuestionRecords,
  surveyVersions,
  syntheticProfiles,
  syntheticSessions,
  validationResults,
  withTenant,
  type Db,
  type Tx,
} from '@si/db';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { actorOf, AuditService } from '../audit/audit.service.js';
import type { RequestContext } from '../common/context.js';
import { problem } from '../common/problem.js';
import { DB } from '../db/db.module.js';
import { stateOf } from './authorizations.js';
import { FIXTURE_SURVEYS, fixtureUrl } from './fixture-surveys.js';
import { PROFILE_LIBRARY } from './profiles.js';
import { KILL_KEY } from './worker.js';

const host = (u: string) => new URL(u).hostname.toLowerCase();
const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

export function quantile(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round(sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo));
}

@Injectable()
export class QaService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  private t<T>(ctx: { tenantId: string }, fn: (tx: Tx) => Promise<T>) {
    return withTenant(this.db, ctx.tenantId, fn);
  }

  /* ---------------------------------------------------------------- projects */

  async usableAuthorization(tx: Tx, id: string) {
    const [a] = await tx.select().from(projectAuthorizations).where(eq(projectAuthorizations.id, id));
    if (!a) throw problem.badRequest('authorization_unknown', 'No such authorization');
    const s = stateOf(a);
    if (s !== 'approved')
      throw problem.conflict('authorization_not_usable', `The authorization is ${s}. QA needs an approved, unexpired one.`);
    return a;
  }

  createProject(ctx: RequestContext, b: QaProjectCreate) {
    return this.t(ctx, async (tx) => {
      const a = await this.usableAuthorization(tx, b.authorizationId);
      if (!a.environments.includes(b.environment))
        throw problem.badRequest('environment_not_authorized', `The authorization does not cover ${b.environment}`);
      for (const u of [b.gateUrl, b.clientUrl].filter(Boolean) as string[]) {
        if (!a.allowedHosts.includes(host(u)))
          throw problem.badRequest('endpoint_not_allowed', `${host(u)} is not an allowed host in this authorization`);
        if (b.environment === 'sandbox' && host(u) !== QA_FIXTURE_HOST)
          throw problem.badRequest('sandbox_only_fixtures', `Sandbox projects run only against ${QA_FIXTURE_HOST}`);
      }
      const [dupe] = await tx.select({ id: aiProjects.id }).from(aiProjects).where(eq(aiProjects.code, b.code));
      if (dupe) throw problem.conflict('code_taken', `${b.code} already exists`);
      const [row] = await tx
        .insert(aiProjects)
        .values({ tenantId: ctx.tenantId, ...b, gateUrl: b.gateUrl ?? null, createdBy: ctx.userId })
        .returning();
      await this.audit.write(tx, actorOf(ctx), {
        action: 'qa_project.created',
        targetType: 'qa_project',
        targetId: row!.id,
        details: { code: b.code, environment: b.environment, authorizationId: b.authorizationId },
      });
      return row!;
    });
  }

  projects(ctx: RequestContext) {
    return this.t(ctx, async (tx) => {
      const rows = await tx
        .select({
          p: aiProjects,
          authState: projectAuthorizations.status,
          authExpires: projectAuthorizations.expiresAt,
          owner: projectAuthorizations.surveyOwner,
          sessions: sql<number>`(select count(*)::int from synthetic_sessions s where s.project_id = ${aiProjects.id})`,
          scenarios: sql<number>`(select count(*)::int from qa_scenarios c where c.project_id = ${aiProjects.id} and c.archived_at is null)`,
        })
        .from(aiProjects)
        .innerJoin(projectAuthorizations, eq(projectAuthorizations.id, aiProjects.authorizationId))
        .orderBy(desc(aiProjects.createdAt));
      return rows.map((r) => ({
        ...r.p,
        createdAt: iso(r.p.createdAt),
        authorization: { state: stateOf({ status: r.authState, expiresAt: r.authExpires }), surveyOwner: r.owner, expiresAt: iso(r.authExpires) },
        sessions: r.sessions,
        scenarios: r.scenarios,
      }));
    });
  }

  setUrls(ctx: RequestContext, id: string, b: { gateUrl?: string | null; clientUrl: string }) {
    return this.t(ctx, async (tx) => {
      const [p] = await tx.select().from(aiProjects).where(eq(aiProjects.id, id));
      if (!p) throw problem.notFound('No such QA project');
      const a = await this.usableAuthorization(tx, p.authorizationId);
      const gateUrl = b.gateUrl === undefined ? p.gateUrl : b.gateUrl;
      for (const u of [gateUrl, b.clientUrl].filter(Boolean) as string[]) {
        if (!a.allowedHosts.includes(host(u)))
          throw problem.badRequest('endpoint_not_allowed', `${host(u)} is not an allowed host in this authorization`);
        if (p.environment === 'sandbox' && host(u) !== QA_FIXTURE_HOST)
          throw problem.badRequest('sandbox_only_fixtures', `Sandbox projects run only against ${QA_FIXTURE_HOST}`);
      }
      const [row] = await tx.update(aiProjects).set({ gateUrl, clientUrl: b.clientUrl }).where(eq(aiProjects.id, id)).returning();
      await this.audit.write(tx, actorOf(ctx), {
        action: 'qa_project.urls',
        targetType: 'qa_project',
        targetId: id,
        details: { before: { gateUrl: p.gateUrl, clientUrl: p.clientUrl }, after: { gateUrl, clientUrl: b.clientUrl } },
      });
      return row!;
    });
  }

  setProjectStatus(ctx: RequestContext, id: string, status: 'active' | 'paused' | 'closed') {
    return this.t(ctx, async (tx) => {
      const [row] = await tx.update(aiProjects).set({ status }).where(eq(aiProjects.id, id)).returning();
      if (!row) throw problem.notFound('No such QA project');
      await this.audit.write(tx, actorOf(ctx), { action: 'qa_project.status', targetType: 'qa_project', targetId: id, details: { status } });
      return row;
    });
  }

  /** The surveys of one stage: which projects point at them, what versions the runner has seen, and the fixtures. */
  surveys(ctx: RequestContext, stage: 'gate' | 'client') {
    return this.t(ctx, async (tx) => {
      const projects = await tx.select().from(aiProjects).orderBy(asc(aiProjects.code));
      const versions = await tx
        .select()
        .from(surveyVersions)
        .where(eq(surveyVersions.stage, stage))
        .orderBy(desc(surveyVersions.lastSeenAt));
      return {
        stage,
        projects: projects
          .filter((p) => (stage === 'gate' ? p.gateUrl : p.clientUrl))
          .map((p) => ({ id: p.id, code: p.code, name: p.name, url: stage === 'gate' ? p.gateUrl : p.clientUrl, status: p.status })),
        versions: versions.map((v) => ({ ...v, firstSeenAt: iso(v.firstSeenAt), lastSeenAt: iso(v.lastSeenAt) })),
        fixtures: FIXTURE_SURVEYS.filter((s) => s.stage === stage).map((s) => ({
          url: fixtureUrl(s.path),
          title: s.title,
          questions: s.questions.map((q) => ({ id: q.id, input: q.input, text: q.text.en, languages: Object.keys(q.text) })),
        })),
      };
    });
  }

  /* ---------------------------------------------------------------- profiles and scenarios */

  async ensureLibrary(tx: Tx, tenantId: string) {
    await tx
      .insert(syntheticProfiles)
      .values(PROFILE_LIBRARY.map((p) => ({ tenantId, ...p, attributes: p.attributes as Record<string, unknown>, builtin: true })))
      .onConflictDoNothing();
  }

  profiles(ctx: RequestContext) {
    return this.t(ctx, async (tx) => {
      await this.ensureLibrary(tx, ctx.tenantId);
      return tx.select().from(syntheticProfiles).orderBy(asc(syntheticProfiles.code));
    });
  }

  createProfile(ctx: RequestContext, b: SyntheticProfileCreate) {
    return this.t(ctx, async (tx) => {
      const [n] = await tx.select({ n: sql<number>`count(*)::int` }).from(syntheticProfiles).where(eq(syntheticProfiles.builtin, false));
      const code = `FP-C${String((n?.n ?? 0) + 1).padStart(2, '0')}`;
      const [row] = await tx
        .insert(syntheticProfiles)
        .values({ tenantId: ctx.tenantId, code, ...b, label: `Fictional profile ${code}: ${b.label}` })
        .returning();
      await this.audit.write(tx, actorOf(ctx), { action: 'profile.created', targetType: 'synthetic_profile', targetId: row!.id });
      return row!;
    });
  }

  scenarios(ctx: RequestContext, projectId?: string) {
    return this.t(ctx, async (tx) => {
      const rows = await tx
        .select({ s: qaScenarios, profileCode: syntheticProfiles.code, profileLabel: syntheticProfiles.label })
        .from(qaScenarios)
        .innerJoin(syntheticProfiles, eq(syntheticProfiles.id, qaScenarios.profileId))
        .where(and(isNull(qaScenarios.archivedAt), projectId ? eq(qaScenarios.projectId, projectId) : undefined))
        .orderBy(asc(qaScenarios.createdAt));
      return rows.map((r) => ({ ...r.s, createdAt: iso(r.s.createdAt), profileCode: r.profileCode, profileLabel: r.profileLabel }));
    });
  }

  createScenario(ctx: RequestContext, b: ScenarioCreate) {
    return this.t(ctx, async (tx) => {
      const [p] = await tx.select().from(aiProjects).where(eq(aiProjects.id, b.projectId));
      if (!p) throw problem.badRequest('project_unknown', 'No such QA project');
      const [pr] = await tx.select().from(syntheticProfiles).where(eq(syntheticProfiles.id, b.profileId));
      if (!pr) throw problem.badRequest('profile_unknown', 'No such fictional profile');
      const [row] = await tx.insert(qaScenarios).values({ tenantId: ctx.tenantId, ...b }).returning();
      await this.audit.write(tx, actorOf(ctx), { action: 'scenario.created', targetType: 'scenario', targetId: row!.id, details: { projectId: b.projectId, objective: b.objective } });
      return row!;
    });
  }

  archiveScenario(ctx: RequestContext, id: string) {
    return this.t(ctx, async (tx) => {
      const [row] = await tx.update(qaScenarios).set({ archivedAt: new Date() }).where(eq(qaScenarios.id, id)).returning();
      if (!row) throw problem.notFound('No such scenario');
      await this.audit.write(tx, actorOf(ctx), { action: 'scenario.archived', targetType: 'scenario', targetId: id });
      return { ok: true };
    });
  }

  /* ---------------------------------------------------------------- jobs */

  createJob(ctx: RequestContext, b: JobCreate) {
    return this.t(ctx, async (tx) => {
      const [p] = await tx.select().from(aiProjects).where(eq(aiProjects.id, b.projectId));
      if (!p) throw problem.badRequest('project_unknown', 'No such QA project');
      if (p.status !== 'active') throw problem.conflict('project_not_active', `The QA project is ${p.status}`);
      const a = await this.usableAuthorization(tx, p.authorizationId);
      const ids = [...new Set(b.scenarioIds)];
      const sc = await tx
        .select({ id: qaScenarios.id })
        .from(qaScenarios)
        .where(and(inArray(qaScenarios.id, ids), eq(qaScenarios.projectId, p.id), isNull(qaScenarios.archivedAt)));
      if (sc.length !== ids.length) throw problem.badRequest('scenario_unknown', 'Every scenario must belong to this project');
      const [[kill], [used]] = await Promise.all([
        tx.select().from(settings).where(eq(settings.key, KILL_KEY)),
        tx
          .select({ n: sql<number>`count(*)::int` })
          .from(syntheticSessions)
          .innerJoin(aiProjects, eq(aiProjects.id, syntheticSessions.projectId))
          .where(eq(aiProjects.authorizationId, a.id)),
      ]);
      if ((kill?.value as { on?: boolean } | undefined)?.on)
        throw problem.conflict('emergency_stop', 'The emergency stop is on. Turn it off before queueing QA.');
      const total = ids.length * b.sessionsPerScenario;
      const left = a.maxSessions - (used?.n ?? 0);
      if (total > left)
        throw problem.conflict('session_limit', `This job needs ${total} sessions; the authorization has ${left} left`);
      const at = b.scheduledAt ? new Date(b.scheduledAt) : new Date();
      if (at > a.expiresAt) throw problem.badRequest('after_expiry', 'The job is scheduled after the authorization expires');
      const [row] = await tx
        .insert(executionJobs)
        .values({
          tenantId: ctx.tenantId,
          projectId: p.id,
          authorizationId: a.id,
          scenarioIds: ids,
          sessionsPerScenario: b.sessionsPerScenario,
          totalSessions: total,
          intervalSeconds: b.intervalSeconds,
          scheduledAt: at,
          nextRunAt: at,
          createdBy: ctx.userId,
          createdByEmail: ctx.email,
        })
        .returning();
      await tx.insert(executionEvents).values({ tenantId: ctx.tenantId, jobId: row!.id, kind: 'job_queued', detail: { total, by: ctx.email } });
      await this.audit.write(tx, actorOf(ctx), { action: 'qa_job.queued', targetType: 'qa_job', targetId: row!.id, details: { projectId: p.id, total } });
      return row!;
    });
  }

  jobs(ctx: RequestContext, projectId?: string) {
    return this.t(ctx, async (tx) => {
      const rows = await tx
        .select({ j: executionJobs, code: aiProjects.code, name: aiProjects.name })
        .from(executionJobs)
        .innerJoin(aiProjects, eq(aiProjects.id, executionJobs.projectId))
        .where(projectId ? eq(executionJobs.projectId, projectId) : undefined)
        .orderBy(desc(executionJobs.createdAt))
        .limit(200);
      return rows.map((r) => ({
        ...r.j,
        projectCode: r.code,
        projectName: r.name,
        scheduledAt: iso(r.j.scheduledAt),
        nextRunAt: iso(r.j.nextRunAt),
        startedAt: iso(r.j.startedAt),
        finishedAt: iso(r.j.finishedAt),
        createdAt: iso(r.j.createdAt),
      }));
    });
  }

  job(ctx: RequestContext, id: string) {
    return this.t(ctx, async (tx) => {
      const [j] = await tx.select().from(executionJobs).where(eq(executionJobs.id, id));
      if (!j) throw problem.notFound('No such job');
      const events = await tx.select().from(executionEvents).where(eq(executionEvents.jobId, id)).orderBy(asc(executionEvents.at)).limit(500);
      return { ...j, events: events.map((e) => ({ ...e, at: iso(e.at) })) };
    });
  }

  cancelJob(ctx: RequestContext, id: string) {
    return this.t(ctx, async (tx) => {
      const [row] = await tx
        .update(executionJobs)
        .set({ status: 'cancelled', stopReason: 'cancelled', finishedAt: new Date() })
        .where(and(eq(executionJobs.id, id), inArray(executionJobs.status, ['queued', 'running'])))
        .returning();
      if (!row) throw problem.conflict('not_cancellable', 'Only a queued or running job can be cancelled');
      await tx.insert(executionEvents).values({ tenantId: ctx.tenantId, jobId: id, kind: 'job_cancelled', detail: { by: ctx.email } });
      await this.audit.write(tx, actorOf(ctx), { action: 'qa_job.cancelled', targetType: 'qa_job', targetId: id });
      return row;
    });
  }

  killSwitch(ctx: RequestContext) {
    return this.t(ctx, async (tx) => {
      const [k] = await tx.select().from(settings).where(eq(settings.key, KILL_KEY));
      return (k?.value as { on: boolean; reason: string; by: string; at: string } | undefined) ?? { on: false, reason: null, by: null, at: null };
    });
  }

  setKillSwitch(ctx: RequestContext, on: boolean, reason: string) {
    return this.t(ctx, async (tx) => {
      const value = { on, reason, by: ctx.email, at: new Date().toISOString() };
      await tx
        .insert(settings)
        .values({ tenantId: ctx.tenantId, key: KILL_KEY, value, updatedBy: ctx.userId })
        .onConflictDoUpdate({ target: [settings.tenantId, settings.key], set: { value, updatedBy: ctx.userId, updatedAt: new Date(), version: sql`${settings.version} + 1` } });
      let stopped = 0;
      if (on) {
        const rows = await tx
          .update(executionJobs)
          .set({ status: 'stopped', stopReason: 'emergency_stop', finishedAt: new Date() })
          .where(inArray(executionJobs.status, ['queued', 'running']))
          .returning({ id: executionJobs.id });
        stopped = rows.length;
        for (const r of rows)
          await tx.insert(executionEvents).values({ tenantId: ctx.tenantId, jobId: r.id, kind: 'job_stopped', detail: { reason: 'emergency_stop' } });
      }
      await tx.insert(securityEvents).values({ tenantId: ctx.tenantId, kind: on ? 'emergency_stop' : 'emergency_stop_cleared', severity: on ? 'high' : 'medium', detail: { reason, by: ctx.email, jobsStopped: stopped } });
      await this.audit.write(tx, actorOf(ctx), { action: on ? 'qa.emergency_stop.on' : 'qa.emergency_stop.off', targetType: 'qa', reason, details: { jobsStopped: stopped } });
      return { ...value, jobsStopped: stopped };
    });
  }

  /* ---------------------------------------------------------------- results */

  sessions(ctx: RequestContext, q: { projectId?: string; jobId?: string; outcome?: string; review?: string }) {
    return this.t(ctx, async (tx) => {
      const rows = await tx
        .select({ s: syntheticSessions, scenario: qaScenarios.name, profile: syntheticProfiles.code, code: aiProjects.code })
        .from(syntheticSessions)
        .innerJoin(qaScenarios, eq(qaScenarios.id, syntheticSessions.scenarioId))
        .innerJoin(syntheticProfiles, eq(syntheticProfiles.id, syntheticSessions.profileId))
        .innerJoin(aiProjects, eq(aiProjects.id, syntheticSessions.projectId))
        .where(
          and(
            q.projectId ? eq(syntheticSessions.projectId, q.projectId) : undefined,
            q.jobId ? eq(syntheticSessions.jobId, q.jobId) : undefined,
            q.outcome ? eq(syntheticSessions.outcome, q.outcome) : undefined,
            q.review ? eq(syntheticSessions.reviewStatus, q.review) : undefined,
          ),
        )
        .orderBy(desc(syntheticSessions.startedAt), desc(syntheticSessions.seq))
        .limit(500);
      return rows.map((r) => ({
        ...r.s,
        startedAt: iso(r.s.startedAt),
        endedAt: iso(r.s.endedAt),
        reviewedAt: iso(r.s.reviewedAt),
        scenarioName: r.scenario,
        profileCode: r.profile,
        projectCode: r.code,
      }));
    });
  }

  session(ctx: RequestContext, id: string) {
    return this.t(ctx, async (tx) => {
      const [s] = await tx.select().from(syntheticSessions).where(eq(syntheticSessions.id, id));
      if (!s) throw problem.notFound('No such synthetic session');
      const [questions, validations, redirects, ip, [quality], security, [scenario], [profile]] = await Promise.all([
        tx.select().from(surveyQuestionRecords).where(eq(surveyQuestionRecords.sessionId, id)).orderBy(asc(surveyQuestionRecords.seq)),
        tx.select().from(validationResults).where(eq(validationResults.sessionId, id)),
        tx.select().from(redirectResults).where(eq(redirectResults.sessionId, id)),
        tx.select().from(ipRiskRecords).where(eq(ipRiskRecords.sessionId, id)),
        tx.select().from(qualityAssessments).where(eq(qualityAssessments.sessionId, id)),
        tx.select().from(securityEvents).where(eq(securityEvents.sessionId, id)),
        tx.select().from(qaScenarios).where(eq(qaScenarios.id, s.scenarioId)),
        tx.select().from(syntheticProfiles).where(eq(syntheticProfiles.id, s.profileId)),
      ]);
      return {
        ...s,
        startedAt: iso(s.startedAt),
        endedAt: iso(s.endedAt),
        reviewedAt: iso(s.reviewedAt),
        scenario,
        profile,
        questions,
        validations,
        redirects: redirects.map((r) => ({ ...r, at: iso(r.at) })),
        ip: ip.map((r) => ({ ...r, at: iso(r.at) })),
        quality: quality ? { score: quality.score, findings: quality.findings } : null,
        security: security.map((e) => ({ ...e, at: iso(e.at) })),
      };
    });
  }

  review(ctx: RequestContext, id: string, status: string, note: string) {
    return this.t(ctx, async (tx) => {
      const [row] = await tx
        .update(syntheticSessions)
        .set({ reviewStatus: status, reviewNote: note, reviewedBy: ctx.email, reviewedAt: new Date() })
        .where(eq(syntheticSessions.id, id))
        .returning();
      if (!row) throw problem.notFound('No such synthetic session');
      await this.audit.write(tx, actorOf(ctx), { action: 'session.reviewed', targetType: 'synthetic_session', targetId: id, reason: note, details: { status } });
      return { id, reviewStatus: status };
    });
  }

  /** Synthetic outcomes, path IR and LOI. Labelled synthetic everywhere; none of it is human IR or LOI. */
  stats(ctx: RequestContext, projectId?: string) {
    return this.t(ctx, async (tx) => {
      const projects = await tx.select().from(aiProjects).where(projectId ? eq(aiProjects.id, projectId) : undefined).orderBy(asc(aiProjects.code));
      const rows = await tx
        .select({
          projectId: syntheticSessions.projectId,
          outcome: syntheticSessions.outcome,
          loi: syntheticSessions.loiSeconds,
          passed: syntheticSessions.assertionsPassed,
          failed: syntheticSessions.assertionsFailed,
          score: syntheticSessions.qualityScore,
          review: syntheticSessions.reviewStatus,
        })
        .from(syntheticSessions)
        .where(projectId ? eq(syntheticSessions.projectId, projectId) : undefined);
      return projects.map((p) => {
        const mine = rows.filter((r) => r.projectId === p.id);
        const outcomes: Record<string, number> = {};
        for (const r of mine) outcomes[r.outcome] = (outcomes[r.outcome] ?? 0) + 1;
        const c = outcomes.complete ?? 0;
        const t = outcomes.terminate ?? 0;
        const lois = mine.filter((r) => r.outcome === 'complete').map((r) => r.loi).sort((a, b) => a - b);
        const passed = mine.reduce((n, r) => n + r.passed, 0);
        const failed = mine.reduce((n, r) => n + r.failed, 0);
        const bucket = 60;
        const hist = new Map<number, number>();
        for (const l of lois) hist.set(Math.floor(l / bucket) * bucket, (hist.get(Math.floor(l / bucket) * bucket) ?? 0) + 1);
        return {
          projectId: p.id,
          code: p.code,
          name: p.name,
          classification: 'synthetic_qa',
          sessions: mine.length,
          outcomes,
          syntheticIrPercent: c + t ? Math.round((c / (c + t)) * 100) : null,
          expectedIrPercent: p.expectedIrPercent,
          loi: {
            clock: 'sandbox',
            n: lois.length,
            p25: quantile(lois, 0.25),
            median: quantile(lois, 0.5),
            p75: quantile(lois, 0.75),
            histogram: [...hist.entries()].sort((a, b) => a[0] - b[0]).map(([from, n]) => ({ from, n })),
            bucketSeconds: bucket,
          },
          expectedLoiMinutes: p.expectedLoiMinutes,
          assertions: { passed, failed, passRate: passed + failed ? Math.round((passed / (passed + failed)) * 100) : null },
          averageQuality: mine.length ? Math.round(mine.reduce((n, r) => n + r.score, 0) / mine.length) : null,
          openReviews: mine.filter((r) => r.review === 'open' && (r.failed > 0 || r.score < 100)).length,
        };
      });
    });
  }

  /** Question audit: every question the runner met, with what happened on it. */
  questions(ctx: RequestContext, projectId?: string, stage?: string) {
    return this.t(ctx, async (tx) => {
      const rows = await tx
        .select({
          stage: surveyQuestionRecords.stage,
          questionId: surveyQuestionRecords.questionId,
          text: sql<string>`min(${surveyQuestionRecords.questionText})`,
          inputKind: sql<string>`min(${surveyQuestionRecords.inputKind})`,
          detectedType: sql<string>`min(${surveyQuestionRecords.detectedType})`,
          shown: sql<number>`count(*)::int`,
          rejected: sql<number>`count(*) filter (where ${surveyQuestionRecords.validation} like 'rejected:%')::int`,
          timedOut: sql<number>`count(*) filter (where ${surveyQuestionRecords.validation} like 'not_answered:%')::int`,
          byModel: sql<number>`count(*) filter (where ${surveyQuestionRecords.answeredBy} = 'model')::int`,
          byOverride: sql<number>`count(*) filter (where ${surveyQuestionRecords.answeredBy} = 'override')::int`,
          languages: sql<string[]>`array_agg(distinct ${surveyQuestionRecords.language})`,
          flags: sql<string[]>`coalesce(array_agg(distinct f) filter (where f is not null), '{}')`,
        })
        .from(surveyQuestionRecords)
        .innerJoin(syntheticSessions, eq(syntheticSessions.id, surveyQuestionRecords.sessionId))
        .leftJoin(sql`lateral unnest(${surveyQuestionRecords.flags}) as f`, sql`true`)
        .where(
          and(
            projectId ? eq(syntheticSessions.projectId, projectId) : undefined,
            stage ? eq(surveyQuestionRecords.stage, stage) : undefined,
          ),
        )
        .groupBy(surveyQuestionRecords.stage, surveyQuestionRecords.questionId)
        .orderBy(asc(surveyQuestionRecords.stage), asc(surveyQuestionRecords.questionId));
      return rows;
    });
  }

  quality(ctx: RequestContext, projectId?: string) {
    return this.t(ctx, async (tx) => {
      const rows = await tx
        .select({ id: syntheticSessions.id, seq: syntheticSessions.seq, code: aiProjects.code, score: qualityAssessments.score, findings: qualityAssessments.findings, review: syntheticSessions.reviewStatus, outcome: syntheticSessions.outcome, jobId: syntheticSessions.jobId, startedAt: syntheticSessions.startedAt })
        .from(qualityAssessments)
        .innerJoin(syntheticSessions, eq(syntheticSessions.id, qualityAssessments.sessionId))
        .innerJoin(aiProjects, eq(aiProjects.id, syntheticSessions.projectId))
        .where(projectId ? eq(syntheticSessions.projectId, projectId) : undefined)
        .orderBy(desc(syntheticSessions.startedAt))
        .limit(500);
      const byKind: Record<string, number> = {};
      for (const r of rows) for (const f of r.findings as { kind: string }[]) byKind[f.kind] = (byKind[f.kind] ?? 0) + 1;
      return { byKind, sessions: rows.map((r) => ({ ...r, startedAt: iso(r.startedAt) })) };
    });
  }

  /** Regression comparison between two jobs of one project, scenario by scenario. */
  regression(ctx: RequestContext, a: string, b: string) {
    return this.t(ctx, async (tx) => {
      const jobs = await tx.select().from(executionJobs).where(inArray(executionJobs.id, [a, b]));
      const ja = jobs.find((j) => j.id === a);
      const jb = jobs.find((j) => j.id === b);
      if (!ja || !jb) throw problem.notFound('Both jobs must exist');
      if (ja.projectId !== jb.projectId) throw problem.badRequest('different_projects', 'Compare two jobs of the same QA project');
      const sessions = await tx
        .select({ id: syntheticSessions.id, jobId: syntheticSessions.jobId, scenarioId: syntheticSessions.scenarioId, outcome: syntheticSessions.outcome, loi: syntheticSessions.loiSeconds, failed: syntheticSessions.assertionsFailed, score: syntheticSessions.qualityScore, urls: syntheticSessions.surveyUrls })
        .from(syntheticSessions)
        .where(inArray(syntheticSessions.jobId, [a, b]));
      const qs = sessions.length
        ? await tx
            .select({ sessionId: surveyQuestionRecords.sessionId, q: surveyQuestionRecords.questionId, stage: surveyQuestionRecords.stage })
            .from(surveyQuestionRecords)
            .where(inArray(surveyQuestionRecords.sessionId, sessions.map((s) => s.id)))
        : [];
      const scenarioIds = [...new Set(sessions.map((s) => s.scenarioId))];
      const names = scenarioIds.length ? await tx.select({ id: qaScenarios.id, name: qaScenarios.name }).from(qaScenarios).where(inArray(qaScenarios.id, scenarioIds)) : [];
      const side = (jobId: string, scenarioId: string) => {
        const ss = sessions.filter((s) => s.jobId === jobId && s.scenarioId === scenarioId);
        if (!ss.length) return null;
        const outcomes: Record<string, number> = {};
        for (const s of ss) outcomes[s.outcome] = (outcomes[s.outcome] ?? 0) + 1;
        const ids = new Set(ss.map((s) => s.id));
        return {
          sessions: ss.length,
          outcomes,
          main: Object.entries(outcomes).sort((x, y) => y[1] - x[1])[0]![0],
          avgLoi: Math.round(ss.reduce((n, s) => n + s.loi, 0) / ss.length),
          failedAssertions: ss.reduce((n, s) => n + s.failed, 0),
          avgQuality: Math.round(ss.reduce((n, s) => n + s.score, 0) / ss.length),
          questions: [...new Set(qs.filter((q) => ids.has(q.sessionId)).map((q) => `${q.stage}:${q.q}`))].sort(),
        };
      };
      const rows = scenarioIds.map((id) => {
        const A = side(a, id);
        const B = side(b, id);
        const qa = new Set(A?.questions ?? []);
        const qb = new Set(B?.questions ?? []);
        return {
          scenarioId: id,
          scenario: names.find((n) => n.id === id)?.name ?? id,
          a: A,
          b: B,
          outcomeChanged: !!A && !!B && A.main !== B.main,
          questionsAdded: [...qb].filter((q) => !qa.has(q)),
          questionsRemoved: [...qa].filter((q) => !qb.has(q)),
        };
      });
      const urlsOf = (id: string) => [...new Set(sessions.filter((s) => s.jobId === id).map((s) => JSON.stringify(s.urls)))].map((u) => JSON.parse(u));
      return { a: { id: a, urls: urlsOf(a), createdAt: iso(ja.createdAt) }, b: { id: b, urls: urlsOf(b), createdAt: iso(jb.createdAt) }, rows, changed: rows.filter((r) => r.outcomeChanged || r.questionsAdded.length || r.questionsRemoved.length).length };
    });
  }

  ipRecords(ctx: RequestContext, projectId?: string) {
    return this.t(ctx, async (tx) => {
      const rows = await tx
        .select({ r: ipRiskRecords, code: aiProjects.code, seq: syntheticSessions.seq })
        .from(ipRiskRecords)
        .innerJoin(aiProjects, eq(aiProjects.id, ipRiskRecords.projectId))
        .innerJoin(syntheticSessions, eq(syntheticSessions.id, ipRiskRecords.sessionId))
        .where(projectId ? eq(ipRiskRecords.projectId, projectId) : undefined)
        .orderBy(desc(ipRiskRecords.at))
        .limit(500);
      return rows.map((x) => ({ ...x.r, at: iso(x.r.at), projectCode: x.code, sessionSeq: x.seq }));
    });
  }

  securityEvents(ctx: RequestContext) {
    return this.t(ctx, async (tx) => {
      const rows = await tx.select().from(securityEvents).orderBy(desc(securityEvents.at)).limit(300);
      return rows.map((r) => ({ ...r, at: iso(r.at) }));
    });
  }
}
