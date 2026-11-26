import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { EXPORT_KINDS, IntegrationTokenCreate, SYNTHETIC_CLASSIFICATION } from '@si/contracts';
import {
  aiProjects,
  integrationClients,
  ipRiskRecords,
  projectAuthorizations,
  qualityAssessments,
  redirectResults,
  reportExports,
  surveyQuestionRecords,
  syntheticSessions,
  withTenant,
  type Db,
} from '@si/db';
import { and, asc, desc, eq, inArray, isNull, max, sql } from 'drizzle-orm';
import type { Request, Response } from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { actorOf, AuditService } from '../audit/audit.service.js';
import type { RequestContext } from '../common/context.js';
import { Ctx, Public, RequirePermissions } from '../common/decorators.js';
import { problem } from '../common/problem.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { DB } from '../db/db.module.js';

/** A cell a spreadsheet would read as a formula is prefixed with a quote (OWASP CSV injection guidance). */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
export const csv = (header: string[], rows: unknown[][]) =>
  [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

const WITHHELD = '[withheld: the authorization does not allow question content in exports]';

/** Excel reporting (module 15): separate synthetic exports, one row per session or per question. */
@Controller('qa/exports')
export class ExportsController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermissions('reports.read')
  list(@Ctx() ctx: RequestContext) {
    return withTenant(this.db, ctx.tenantId, async (tx) => {
      const rows = await tx
        .select({ e: reportExports, code: aiProjects.code })
        .from(reportExports)
        .leftJoin(aiProjects, eq(aiProjects.id, reportExports.projectId))
        .orderBy(desc(reportExports.createdAt))
        .limit(100);
      return rows.map((r) => ({ ...r.e, createdAt: r.e.createdAt.toISOString(), projectCode: r.code }));
    });
  }

  @Get(':kind')
  @RequirePermissions('reports.export')
  async export(
    @Ctx() ctx: RequestContext,
    @Param('kind') rawKind: string,
    @Query('projectId') rawProject: string,
    @Res() res: Response,
  ) {
    const kind = new ZodPipe(z.enum(EXPORT_KINDS)).transform(rawKind.replace(/\.csv$/, ''));
    const projectId = new ZodPipe(z.uuid()).transform(rawProject);
    const body = await withTenant(this.db, ctx.tenantId, async (tx) => {
      const [p] = await tx
        .select({ p: aiProjects, content: projectAuthorizations.exportQuestionContent })
        .from(aiProjects)
        .innerJoin(projectAuthorizations, eq(projectAuthorizations.id, aiProjects.authorizationId))
        .where(eq(aiProjects.id, projectId));
      if (!p) throw problem.notFound('No such QA project');
      const sessions = await tx
        .select({ s: syntheticSessions, risk: ipRiskRecords.riskScore, dup: ipRiskRecords.duplicateCount, score: qualityAssessments.score, findings: qualityAssessments.findings })
        .from(syntheticSessions)
        .leftJoin(ipRiskRecords, eq(ipRiskRecords.sessionId, syntheticSessions.id))
        .leftJoin(qualityAssessments, eq(qualityAssessments.sessionId, syntheticSessions.id))
        .where(eq(syntheticSessions.projectId, projectId))
        .orderBy(asc(syntheticSessions.startedAt), asc(syntheticSessions.seq));
      let out: string;
      let rows: number;
      if (kind === 'sessions') {
        out = csv(
          ['project_id', 'project_code', 'session_id', 'classification', 'environment', 'last_stage', 'language', 'started_at', 'ended_at', 'loi_seconds', 'loi_clock', 'ip_risk_score', 'duplicate_ip_observations', 'quality_score', 'quality_findings', 'redirect_url', 'outcome', 'assertions_passed', 'assertions_failed', 'review_status'],
          sessions.map(({ s, risk, dup, score, findings }) => [
            p.p.id, p.p.code, s.id, s.classification, s.environment, s.lastStage, s.language, s.startedAt.toISOString(), s.endedAt.toISOString(), s.loiSeconds, s.clock, risk ?? '', dup ?? '', score ?? '', ((findings as { kind: string }[] | null) ?? []).map((f) => f.kind).join(' '), s.redirectUrl ?? '', s.outcome, s.assertionsPassed, s.assertionsFailed, s.reviewStatus,
          ]),
        );
        rows = sessions.length;
      } else {
        const ids = sessions.map((x) => x.s.id);
        const qs = ids.length
          ? await tx.select().from(surveyQuestionRecords).where(inArray(surveyQuestionRecords.sessionId, ids)).orderBy(asc(surveyQuestionRecords.sessionId), asc(surveyQuestionRecords.seq))
          : [];
        const byId = new Map(sessions.map((x) => [x.s.id, x]));
        out = csv(
          ['project_id', 'session_id', 'classification', 'survey_stage', 'question_id', 'question_text', 'question_type', 'answer', 'answered_by', 'language', 'validation', 'flags', 'seconds', 'session_outcome', 'qa_assertions_failed'],
          qs.map((r) => {
            const s = byId.get(r.sessionId)!.s;
            return [p.p.id, r.sessionId, SYNTHETIC_CLASSIFICATION, r.stage, r.questionId, p.content ? r.questionText : WITHHELD, r.detectedType, r.answer, r.answeredBy, r.language, r.validation, r.flags.join(' '), r.seconds, s.outcome, s.assertionsFailed];
          }),
        );
        rows = qs.length;
      }
      await tx.insert(reportExports).values({ tenantId: ctx.tenantId, kind, projectId, rows, questionContent: kind === 'questions' && p.content, createdBy: ctx.userId, createdByEmail: ctx.email });
      await this.audit.write(tx, actorOf(ctx), { action: 'export.created', targetType: 'qa_project', targetId: projectId, details: { kind, rows } });
      return { out, code: p.p.code };
    });
    res.setHeader('content-type', 'text/csv; charset=utf-8');
    res.setHeader('content-disposition', `attachment; filename="SYNTHETIC-${body.code}-${kind}.csv"`);
    res.setHeader('cache-control', 'no-store');
    res.send(body.out);
  }
}

const TOKEN = /^sik\.([0-9a-f-]{36})\.([0-9a-f-]{36})\.([A-Za-z0-9_-]{43})$/;
const hash = (s: string) => createHash('sha256').update(s).digest('hex');

/**
 * Scoped service access for Supply360 (spec §9: "cross-application access through scoped API/SSO, not shared
 * database credentials"). It returns aggregates of synthetic QA only, never question content or anything human.
 */
@Controller('integration')
export class IntegrationController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  @Get('tokens')
  @RequirePermissions('integrations.read')
  tokens(@Ctx() ctx: RequestContext) {
    return withTenant(this.db, ctx.tenantId, async (tx) => {
      const rows = await tx.select().from(integrationClients).orderBy(desc(integrationClients.createdAt));
      return rows.map(({ tokenHash: _h, ...r }) => ({
        ...r,
        expiresAt: r.expiresAt.toISOString(),
        revokedAt: r.revokedAt?.toISOString() ?? null,
        lastUsedAt: r.lastUsedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }

  @Post('tokens')
  @HttpCode(201)
  @RequirePermissions('integrations.manage')
  create(@Ctx() ctx: RequestContext, @Body(new ZodPipe(IntegrationTokenCreate)) b: z.infer<typeof IntegrationTokenCreate>) {
    return withTenant(this.db, ctx.tenantId, async (tx) => {
      const secret = randomBytes(32).toString('base64url');
      const [row] = await tx
        .insert(integrationClients)
        .values({ tenantId: ctx.tenantId, name: b.name, tokenHash: hash(secret), scopes: b.scopes, expiresAt: new Date(Date.now() + b.expiresInDays * 86_400_000), createdBy: ctx.userId })
        .returning();
      await this.audit.write(tx, actorOf(ctx), { action: 'integration_token.created', targetType: 'integration_client', targetId: row!.id, details: { name: b.name, scopes: b.scopes } });
      return { id: row!.id, token: `sik.${ctx.tenantId}.${row!.id}.${secret}`, expiresAt: row!.expiresAt.toISOString(), note: 'Shown once. Store it in the other application now.' };
    });
  }

  @Delete('tokens/:id')
  @RequirePermissions('integrations.manage')
  revoke(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.db, ctx.tenantId, async (tx) => {
      const [row] = await tx.update(integrationClients).set({ revokedAt: new Date() }).where(and(eq(integrationClients.id, id), isNull(integrationClients.revokedAt))).returning();
      if (!row) throw problem.notFound('No active token with that id');
      await this.audit.write(tx, actorOf(ctx), { action: 'integration_token.revoked', targetType: 'integration_client', targetId: id });
      return { ok: true };
    });
  }

  @Public()
  @Get('qa-summary')
  async summary(@Req() req: Request, @Query('projectRef') rawRef: string) {
    const m = TOKEN.exec((req.get('authorization') ?? '').replace(/^Bearer\s+/i, ''));
    if (!m) throw problem.unauthorized('invalid_token', 'A SampIntel service token is required');
    const [, tenantId, clientId, secret] = m;
    const ref = new ZodPipe(z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{3,32}$/)).transform(rawRef);
    return withTenant(this.db, tenantId!, async (tx) => {
      const [c] = await tx.select().from(integrationClients).where(eq(integrationClients.id, clientId!));
      const ok = c && timingSafeEqual(Buffer.from(c.tokenHash), Buffer.from(hash(secret!)));
      if (!c || !ok || c.revokedAt || c.expiresAt <= new Date() || !c.scopes.includes('qa_summary.read'))
        throw problem.unauthorized('invalid_token', 'The token is unknown, revoked, expired or lacks qa_summary.read');
      await tx.update(integrationClients).set({ lastUsedAt: new Date() }).where(eq(integrationClients.id, c.id));
      const projects = await tx.select().from(aiProjects).where(eq(aiProjects.samptrekProjectRef, ref));
      const ids = projects.map((p) => p.id);
      const outcomes = ids.length
        ? await tx
            .select({ outcome: syntheticSessions.outcome, n: sql<number>`count(*)::int`, passed: sql<number>`sum(${syntheticSessions.assertionsPassed})::int`, failed: sql<number>`sum(${syntheticSessions.assertionsFailed})::int`, last: max(syntheticSessions.endedAt) })
            .from(syntheticSessions)
            .where(inArray(syntheticSessions.projectId, ids))
            .groupBy(syntheticSessions.outcome)
        : [];
      const [redirectsBlocked] = ids.length
        ? await tx
            .select({ n: sql<number>`count(*)::int` })
            .from(redirectResults)
            .innerJoin(syntheticSessions, eq(syntheticSessions.id, redirectResults.sessionId))
            .where(and(inArray(syntheticSessions.projectId, ids), eq(redirectResults.allowed, false)))
        : [{ n: 0 }];
      const last = outcomes.map((o) => o.last).filter(Boolean).sort((a, b) => +b! - +a!)[0];
      return {
        classification: SYNTHETIC_CLASSIFICATION,
        notice: 'Synthetic QA only. Never count these in human quotas, IR, rewards, invoices or sample delivery.',
        projectRef: ref,
        projects: projects.map((p) => ({ code: p.code, name: p.name, status: p.status, environment: p.environment })),
        sessions: outcomes.reduce((n, o) => n + o.n, 0),
        outcomes: Object.fromEntries(outcomes.map((o) => [o.outcome, o.n])),
        assertions: { passed: outcomes.reduce((n, o) => n + (o.passed ?? 0), 0), failed: outcomes.reduce((n, o) => n + (o.failed ?? 0), 0) },
        blockedRedirects: redirectsBlocked?.n ?? 0,
        lastSessionAt: last ? new Date(last).toISOString() : null,
      };
    });
  }
}
