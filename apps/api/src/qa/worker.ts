import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from '@nestjs/common';
import {
  aiProjects,
  executionEvents,
  executionJobs,
  ipRiskRecords,
  notifications,
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
  tenants,
  validationResults,
  withTenant,
  type Db,
  type Tx,
} from '@si/db';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { ENV, type Env } from '../config.js';
import { DB } from '../db/db.module.js';
import { inWindow, stateOf } from './authorizations.js';
import { FixtureDriver, type Answer, type SurveyDriver } from './fixture-surveys.js';
import { ModelGateway, ModelUnavailable } from './gateway.js';
import { BudgetStop, runSession, type ScenarioView } from './runner.js';
import { workerDuration, workerLastSuccess, workerRuns } from '../metrics.js';

type Job = typeof executionJobs.$inferSelect;
type Auth = typeof projectAuthorizations.$inferSelect;
type Project = typeof aiProjects.$inferSelect;

export const KILL_KEY = 'qa_kill_switch';
/** Documentation range (RFC 5737): the FIXTURE driver never opens a network connection, so it has no real egress. */
export const FIXTURE_EGRESS = '192.0.2.10';

export type Gate = { stop: string } | { wait: string } | { ok: true };

const hostOf = (u: string | null | undefined) => {
  try {
    return u ? new URL(u).hostname.toLowerCase() : null;
  } catch {
    return '';
  }
};

/**
 * Every rule is checked before every session, at the worker, whatever the UI showed: emergency stop, project state,
 * authorization state, expiry, start, environment, allowed hosts, session cap and execution window.
 */
export async function gateFor(tx: Tx, job: Job, project: Project, auth: Auth, now = new Date()): Promise<Gate> {
  const [kill] = await tx.select().from(settings).where(eq(settings.key, KILL_KEY)).limit(1);
  if ((kill?.value as { on?: boolean } | undefined)?.on) return { stop: 'emergency_stop' };
  if (project.status === 'closed') return { stop: 'project_closed' };
  if (project.status === 'paused') return { stop: 'project_paused' };
  const state = stateOf(auth, now);
  if (state === 'revoked') return { stop: 'authorization_revoked' };
  if (state === 'expired') return { stop: 'authorization_expired' };
  if (state !== 'approved') return { stop: 'authorization_not_approved' };
  if (!auth.environments.includes(project.environment)) return { stop: 'environment_not_authorized' };
  for (const u of [project.gateUrl, project.clientUrl])
    if (u && !auth.allowedHosts.includes(hostOf(u)!)) return { stop: 'endpoint_not_allowed' };
  const [used] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(syntheticSessions)
    .innerJoin(aiProjects, eq(aiProjects.id, syntheticSessions.projectId))
    .where(eq(aiProjects.authorizationId, auth.id));
  if ((used?.n ?? 0) >= auth.maxSessions) return { stop: 'session_limit' };
  if (auth.startsAt > now) return { wait: 'authorization_not_started' };
  if (!inWindow(auth.windows as { days: number[]; start: string; end: string }[], auth.timezone, now))
    return { wait: 'outside_execution_window' };
  return { ok: true };
}

@Injectable()
export class QaWorker implements OnModuleInit, OnApplicationShutdown {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly log = new Logger('QaWorker');
  readonly drivers: SurveyDriver[] = [new FixtureDriver()];

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly gateway: ModelGateway,
  ) {}

  onModuleInit() {
    if (this.env.NODE_ENV !== 'test' && this.env.QA_TICK_SECONDS > 0)
      this.timer = setInterval(() => void this.tick().catch((e) => this.log.error(e)), this.env.QA_TICK_SECONDS * 1000);
  }
  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  /** One pass over every active tenant. Jobs are locked with SKIP LOCKED, so several workers can run at once. */
  async tick(now = new Date(), onlyTenant?: string) {
    if (this.running && !onlyTenant) return { sessions: 0, jobs: 0 };
    this.running = true;
    const stop = workerDuration.startTimer();
    try {
      const ts = onlyTenant
        ? [{ id: onlyTenant }]
        : await this.db.select({ id: tenants.id }).from(tenants).where(eq(tenants.status, 'active'));
      let sessions = 0;
      let jobs = 0;
      for (const t of ts) {
        const r = await withTenant(this.db, t.id, (tx) => this.tenantTick(tx, t.id, now));
        sessions += r.sessions;
        jobs += r.jobs;
      }
      workerRuns.inc({ result: 'ok' });
      workerLastSuccess.setToCurrentTime();
      return { sessions, jobs };
    } catch (e) {
      workerRuns.inc({ result: 'failed' });
      throw e;
    } finally {
      stop();
      if (!onlyTenant) this.running = false;
    }
  }

  private async tenantTick(tx: Tx, tenantId: string, now: Date) {
    const due = await tx
      .select()
      .from(executionJobs)
      .where(and(inArray(executionJobs.status, ['queued', 'running']), lte(executionJobs.nextRunAt, now)))
      .orderBy(asc(executionJobs.nextRunAt))
      .limit(5)
      .for('update', { skipLocked: true });
    let sessions = 0;
    for (const job of due) sessions += await this.process(tx, tenantId, job, now);
    return { sessions, jobs: due.length };
  }

  private async stop(tx: Tx, tenantId: string, job: Job, reason: string) {
    await tx
      .update(executionJobs)
      .set({ status: 'stopped', stopReason: reason, finishedAt: new Date(), waitingFor: null })
      .where(eq(executionJobs.id, job.id));
    await tx.insert(executionEvents).values({ tenantId, jobId: job.id, kind: 'job_stopped', detail: { reason } });
    await tx.insert(notifications).values({
      tenantId,
      kind: 'qa_job',
      severity: 'warning',
      title: 'QA job stopped',
      body: `A synthetic QA job stopped: ${reason.replaceAll('_', ' ')}.`,
      link: '/executions',
    });
  }

  private async process(tx: Tx, tenantId: string, job: Job, now: Date): Promise<number> {
    const [project] = await tx.select().from(aiProjects).where(eq(aiProjects.id, job.projectId));
    const [auth] = await tx.select().from(projectAuthorizations).where(eq(projectAuthorizations.id, job.authorizationId));
    if (!project || !auth) {
      await this.stop(tx, tenantId, job, 'authorization_not_approved');
      return 0;
    }
    const scenarios = await tx.select().from(qaScenarios).where(inArray(qaScenarios.id, job.scenarioIds));
    const profiles = await tx
      .select()
      .from(syntheticProfiles)
      .where(inArray(syntheticProfiles.id, scenarios.map((s) => s.profileId)));
    let done = job.doneSessions;
    let ran = 0;
    const batch = job.intervalSeconds > 0 ? 1 : 10;
    for (let k = 0; k < batch && done < job.totalSessions; k++) {
      const g = await gateFor(tx, job, project, auth, now);
      if ('stop' in g) {
        if (g.stop === 'emergency_stop')
          await tx.insert(securityEvents).values({ tenantId, projectId: project.id, jobId: job.id, kind: 'emergency_stop', severity: 'high', detail: {} });
        await this.stop(tx, tenantId, job, g.stop);
        return ran;
      }
      if ('wait' in g) {
        await tx
          .update(executionJobs)
          .set({ waitingFor: g.wait, nextRunAt: new Date(now.getTime() + 5 * 60_000), status: done ? 'running' : 'queued' })
          .where(eq(executionJobs.id, job.id));
        return ran;
      }
      const sc = scenarios.find((s) => s.id === job.scenarioIds[Math.floor(done / job.sessionsPerScenario)]);
      const pr = sc && profiles.find((p) => p.id === sc.profileId);
      if (!sc || !pr) {
        await this.stop(tx, tenantId, job, 'cancelled');
        return ran;
      }
      const sessionId = randomUUID();
      const view: ScenarioView = {
        id: sc.id,
        objective: sc.objective as ScenarioView['objective'],
        language: sc.language as ScenarioView['language'],
        timing: sc.timing as ScenarioView['timing'],
        answerStrategy: sc.answerStrategy as ScenarioView['answerStrategy'],
        assertions: sc.assertions as ScenarioView['assertions'],
        overrides: sc.overrides as Record<string, Answer>,
      };
      const profile = { age: pr.age, gender: pr.gender, country: pr.country, language: pr.language, attributes: pr.attributes as Record<string, unknown> };
      const startedAt = new Date();
      let result;
      try {
        result = await runSession({
          drivers: this.drivers,
          urls: { gate: project.gateUrl, client: project.clientUrl },
          allowedHosts: auth.allowedHosts,
          scenario: view,
          profile,
          seed: `${sc.id}:${done % job.sessionsPerScenario}`,
          expectedLoiMinutes: project.expectedLoiMinutes,
          model: (q, p) => this.gateway.answer(tx, { tenantId, projectId: project.id, jobId: job.id, sessionId }, q, p),
        });
      } catch (e) {
        if (e instanceof BudgetStop) {
          await tx.insert(securityEvents).values({ tenantId, projectId: project.id, jobId: job.id, kind: 'budget_stop', severity: 'medium', detail: {} });
          await this.stop(tx, tenantId, job, 'budget_limit');
          return ran;
        }
        if (e instanceof ModelUnavailable) {
          await tx.insert(executionEvents).values({ tenantId, jobId: job.id, kind: 'model_unavailable', detail: { reason: e.reason } });
          await tx.update(executionJobs).set({ status: 'failed', stopReason: `model_${e.reason}`, finishedAt: new Date() }).where(eq(executionJobs.id, job.id));
          return ran;
        }
        throw e;
      }
      done += 1;
      ran += 1;
      const endedAt = new Date();
      await tx.insert(syntheticSessions).values({
        id: sessionId,
        tenantId,
        projectId: project.id,
        jobId: job.id,
        scenarioId: sc.id,
        profileId: pr.id,
        seq: done,
        environment: project.environment,
        language: sc.language,
        outcome: result.outcome,
        stopReason: result.stopReason,
        lastStage: result.lastStage,
        surveyUrls: { gate: project.gateUrl, client: project.clientUrl },
        redirectUrl: result.redirect?.url ?? null,
        loiSeconds: result.loiSeconds,
        clock: this.drivers[0]!.name === 'fixture' ? 'sandbox' : 'wall',
        questionCount: new Set(result.records.map((r) => `${r.stage}:${r.questionId}`)).size,
        assertionsPassed: result.validations.filter((v) => v.passed).length,
        assertionsFailed: result.validations.filter((v) => !v.passed).length,
        qualityScore: result.score,
        startedAt,
        endedAt,
      });
      if (result.records.length)
        await tx.insert(surveyQuestionRecords).values(
          result.records.map((r) => ({ tenantId, sessionId, ...r, answer: r.answer as never })),
        );
      if (result.validations.length)
        await tx.insert(validationResults).values(result.validations.map((v) => ({ tenantId, sessionId, ...v })));
      if (result.redirect) await tx.insert(redirectResults).values({ tenantId, sessionId, ...result.redirect });
      const [dup] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(ipRiskRecords)
        .where(and(eq(ipRiskRecords.projectId, project.id), eq(ipRiskRecords.ip, FIXTURE_EGRESS)));
      await tx.insert(ipRiskRecords).values({
        tenantId,
        sessionId,
        projectId: project.id,
        ip: FIXTURE_EGRESS,
        source: 'fixture_sandbox',
        geo: 'Sandbox, no network egress',
        isp: null,
        riskScore: null,
        riskProvider: null,
        duplicateCount: dup?.n ?? 0,
      });
      await tx.insert(qualityAssessments).values({ tenantId, sessionId, score: result.score, findings: result.findings });
      for (const s of result.security)
        await tx.insert(securityEvents).values({ tenantId, projectId: project.id, jobId: job.id, sessionId, ...s });
      for (const v of result.versions)
        await tx
          .insert(surveyVersions)
          .values({ tenantId, projectId: project.id, ...v })
          .onConflictDoUpdate({
            target: [surveyVersions.tenantId, surveyVersions.projectId, surveyVersions.stage, surveyVersions.url, surveyVersions.fingerprint],
            set: { lastSeenAt: new Date() },
          });
      await tx.insert(executionEvents).values({
        tenantId,
        jobId: job.id,
        sessionId,
        kind: 'session_finished',
        detail: { outcome: result.outcome, seq: done, failed: result.validations.filter((v) => !v.passed).length },
      });
      await tx
        .update(executionJobs)
        .set({
          doneSessions: done,
          status: done >= job.totalSessions ? 'finished' : 'running',
          startedAt: job.startedAt ?? startedAt,
          finishedAt: done >= job.totalSessions ? new Date() : null,
          waitingFor: null,
          nextRunAt: new Date(now.getTime() + job.intervalSeconds * 1000),
        })
        .where(eq(executionJobs.id, job.id));
      // Spec §9: stop on a security challenge or unexpected navigation, and on a host no driver may open.
      if (result.stopReason === 'security_challenge' || result.stopReason === 'unexpected_navigation' || result.stopReason === 'endpoint_not_allowed' || result.stopReason === 'driver_unavailable') {
        await this.stop(tx, tenantId, job, result.stopReason);
        return ran;
      }
    }
    return ran;
  }
}

