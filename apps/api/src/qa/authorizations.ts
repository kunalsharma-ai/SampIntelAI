import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  AuthorizationDecision,
  AuthorizationRequest,
  AuthorizationRevoke,
  type AuthorizationState,
} from '@si/contracts';
import { aiProjects, executionJobs, notifications, projectAuthorizations, securityEvents, syntheticSessions, withTenant, type Db, type Tx } from '@si/db';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { actorOf, AuditService } from '../audit/audit.service.js';
import type { RequestContext } from '../common/context.js';
import { Ctx, RequirePermissions } from '../common/decorators.js';
import { problem } from '../common/problem.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { DB } from '../db/db.module.js';

type Row = typeof projectAuthorizations.$inferSelect;

export function stateOf(a: Pick<Row, 'status' | 'expiresAt'>, now = new Date()): AuthorizationState {
  if (a.status === 'approved' && a.expiresAt <= now) return 'expired';
  return a.status;
}

/** Is `now` inside one of the approved execution windows, in the authorization's own timezone? */
export function inWindow(windows: { days: number[]; start: string; end: string }[], timezone: string, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const hm = `${get('hour')}:${get('minute')}`;
  return windows.some((w) => w.days.includes(day) && hm >= w.start && hm < w.end);
}

export const view = (a: Row, used = 0) => ({
  id: a.id,
  state: stateOf(a),
  surveyOwner: a.surveyOwner,
  ownerContact: a.ownerContact,
  evidenceRef: a.evidenceRef,
  purpose: a.purpose,
  environments: a.environments,
  allowedHosts: a.allowedHosts,
  maxSessions: a.maxSessions,
  sessionsUsed: used,
  windows: a.windows as { days: number[]; start: string; end: string }[],
  timezone: a.timezone,
  startsAt: a.startsAt.toISOString(),
  expiresAt: a.expiresAt.toISOString(),
  classification: a.classification,
  exportQuestionContent: a.exportQuestionContent,
  requestedByEmail: a.requestedByEmail,
  requestedBy: a.requestedBy,
  decidedByEmail: a.decidedByEmail,
  decidedAt: a.decidedAt?.toISOString() ?? null,
  decisionReason: a.decisionReason,
  revokedAt: a.revokedAt?.toISOString() ?? null,
  revokeReason: a.revokeReason,
  createdAt: a.createdAt.toISOString(),
});

@Injectable()
export class AuthorizationsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
  ) {}

  async sessionsUsed(tx: Tx, ids: string[]) {
    if (!ids.length) return new Map<string, number>();
    const rows = await tx
      .select({ auth: aiProjects.authorizationId, n: sql<number>`count(${syntheticSessions.id})::int` })
      .from(syntheticSessions)
      .innerJoin(aiProjects, eq(aiProjects.id, syntheticSessions.projectId))
      .where(inArray(aiProjects.authorizationId, ids))
      .groupBy(aiProjects.authorizationId);
    return new Map(rows.map((r) => [r.auth, r.n]));
  }

  list(ctx: RequestContext) {
    return withTenant(this.db, ctx.tenantId, async (tx) => {
      const rows = await tx.select().from(projectAuthorizations).orderBy(desc(projectAuthorizations.createdAt)).limit(200);
      const used = await this.sessionsUsed(tx, rows.map((r) => r.id));
      return rows.map((r) => view(r, used.get(r.id) ?? 0));
    });
  }

  request(ctx: RequestContext, body: AuthorizationRequest) {
    return withTenant(this.db, ctx.tenantId, async (tx) => {
      const [row] = await tx
        .insert(projectAuthorizations)
        .values({
          tenantId: ctx.tenantId,
          ...body,
          startsAt: new Date(body.startsAt),
          expiresAt: new Date(body.expiresAt),
          allowedHosts: [...new Set(body.allowedHosts)],
          environments: [...new Set(body.environments)],
          requestedBy: ctx.userId,
          requestedByEmail: ctx.email,
        })
        .returning();
      await this.audit.write(tx, actorOf(ctx), {
        action: 'authorization.requested',
        targetType: 'authorization',
        targetId: row!.id,
        details: { surveyOwner: body.surveyOwner, allowedHosts: body.allowedHosts, maxSessions: body.maxSessions },
      });
      await tx.insert(notifications).values({
        tenantId: ctx.tenantId,
        kind: 'authorization',
        severity: 'info',
        title: 'Authorization waiting for approval',
        body: `${ctx.name} recorded an authorization from ${body.surveyOwner}. Someone else must approve it.`,
        link: '/authorizations',
      });
      return view(row!);
    });
  }

  decide(ctx: RequestContext, id: string, body: z.infer<typeof AuthorizationDecision>) {
    return withTenant(this.db, ctx.tenantId, async (tx) => {
      const [a] = await tx.select().from(projectAuthorizations).where(eq(projectAuthorizations.id, id)).for('update');
      if (!a) throw problem.notFound('No such authorization');
      if (a.status !== 'pending') throw problem.conflict('not_pending', 'Only a pending authorization can be decided');
      // Separation of duties: whoever recorded it cannot approve it, whatever their role.
      if (a.requestedBy === ctx.userId)
        throw problem.forbidden('separation_of_duties', 'The person who recorded an authorization cannot decide it');
      if (body.decision === 'approve' && a.expiresAt <= new Date())
        throw problem.conflict('already_expired', 'This authorization has already expired');
      const [row] = await tx
        .update(projectAuthorizations)
        .set({
          status: body.decision === 'approve' ? 'approved' : 'rejected',
          decidedBy: ctx.userId,
          decidedByEmail: ctx.email,
          decidedAt: new Date(),
          decisionReason: body.reason,
        })
        .where(eq(projectAuthorizations.id, id))
        .returning();
      await this.audit.write(tx, actorOf(ctx), {
        action: `authorization.${body.decision === 'approve' ? 'approved' : 'rejected'}`,
        targetType: 'authorization',
        targetId: id,
        reason: body.reason,
      });
      return view(row!);
    });
  }

  revoke(ctx: RequestContext, id: string, reason: string) {
    return withTenant(this.db, ctx.tenantId, async (tx) => {
      const [a] = await tx.select().from(projectAuthorizations).where(eq(projectAuthorizations.id, id)).for('update');
      if (!a) throw problem.notFound('No such authorization');
      if (a.status !== 'approved' && a.status !== 'pending')
        throw problem.conflict('not_revocable', 'Only a pending or approved authorization can be revoked');
      const [row] = await tx
        .update(projectAuthorizations)
        .set({ status: 'revoked', revokedBy: ctx.userId, revokedAt: new Date(), revokeReason: reason })
        .where(eq(projectAuthorizations.id, id))
        .returning();
      // Stop every job under it now; the worker would refuse them anyway.
      const stopped = await tx
        .update(executionJobs)
        .set({ status: 'stopped', stopReason: 'authorization_revoked', finishedAt: new Date() })
        .where(and(eq(executionJobs.authorizationId, id), inArray(executionJobs.status, ['queued', 'running'])))
        .returning({ id: executionJobs.id });
      await tx.insert(securityEvents).values({
        tenantId: ctx.tenantId,
        kind: 'authorization_revoked',
        severity: 'medium',
        detail: { authorizationId: id, jobsStopped: stopped.length, reason },
      });
      await this.audit.write(tx, actorOf(ctx), {
        action: 'authorization.revoked',
        targetType: 'authorization',
        targetId: id,
        reason,
        details: { jobsStopped: stopped.length },
      });
      return { ...view(row!), jobsStopped: stopped.length };
    });
  }
}

@Controller('authorizations')
export class AuthorizationsController {
  constructor(private readonly svc: AuthorizationsService) {}

  @Get()
  @RequirePermissions('authorizations.read')
  list(@Ctx() ctx: RequestContext) {
    return this.svc.list(ctx);
  }

  @Post()
  @HttpCode(201)
  @RequirePermissions('authorizations.request')
  request(@Ctx() ctx: RequestContext, @Body(new ZodPipe(AuthorizationRequest)) body: AuthorizationRequest) {
    return this.svc.request(ctx, body);
  }

  @Post(':id/decision')
  @HttpCode(200)
  @RequirePermissions('authorizations.manage')
  decide(
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(AuthorizationDecision)) body: z.infer<typeof AuthorizationDecision>,
  ) {
    return this.svc.decide(ctx, id, body);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  @RequirePermissions('authorizations.revoke')
  revoke(
    @Ctx() ctx: RequestContext,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodPipe(AuthorizationRevoke)) body: z.infer<typeof AuthorizationRevoke>,
  ) {
    return this.svc.revoke(ctx, id, body.reason);
  }
}
