import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Put } from '@nestjs/common';
import { BudgetLimit, Provider, PROVIDERS, ProviderConfig } from '@si/contracts';
import { aiProjects, aiUsageRecords, apiBudgetLimits, providerConfigurations, withTenant, type Db } from '@si/db';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { actorOf, AuditService } from '../audit/audit.service.js';
import type { RequestContext } from '../common/context.js';
import { Ctx, RequirePermissions } from '../common/decorators.js';
import { problem } from '../common/problem.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { DB } from '../db/db.module.js';
import { ModelGateway } from './gateway.js';

const usd = (micros: number) => Math.round(micros) / 1_000_000;
const DEFAULT_MODEL: Record<Provider, string> = {
  fixture: 'fixture-answerer',
  anthropic: '',
  openai: '',
  gemini: '',
};

/** AI API management and budgets (modules 16 and 17). Keys are sealed and never returned. */
@Controller('ai')
export class AiController {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly audit: AuditService,
    private readonly gateway: ModelGateway,
  ) {}

  @Get('providers')
  @RequirePermissions('qa_projects.read')
  providers(@Ctx() ctx: RequestContext) {
    return withTenant(this.db, ctx.tenantId, async (tx) => {
      const rows = await tx.select().from(providerConfigurations);
      return PROVIDERS.map((p) => {
        const r = rows.find((x) => x.provider === p);
        return {
          provider: p,
          configured: !!r,
          model: r?.model ?? DEFAULT_MODEL[p],
          hasKey: !!r?.sealedKey,
          enabled: r?.enabled ?? false,
          timeoutMs: r?.timeoutMs ?? 15_000,
          maxOutputTokens: r?.maxOutputTokens ?? 300,
          priceInputPerMTokUsd: usd(r?.priceInputMicros ?? 0),
          priceOutputPerMTokUsd: usd(r?.priceOutputMicros ?? 0),
          live: p !== 'fixture',
          callable: p === 'fixture',
          updatedAt: r?.updatedAt.toISOString() ?? null,
        };
      });
    });
  }

  @Put('providers/:provider')
  @RequirePermissions('providers.manage')
  setProvider(@Ctx() ctx: RequestContext, @Param('provider') raw: string, @Body(new ZodPipe(ProviderConfig)) b: ProviderConfig) {
    const provider = new ZodPipe(Provider).transform(raw);
    return withTenant(this.db, ctx.tenantId, async (tx) => {
      const [existing] = await tx.select().from(providerConfigurations).where(eq(providerConfigurations.provider, provider));
      const sealedKey = b.apiKey ? this.gateway.seal(provider, ctx.tenantId, b.apiKey) : (existing?.sealedKey ?? null);
      if (b.enabled && provider !== 'fixture' && !sealedKey)
        throw problem.badRequest('key_required', 'Add an API key before turning this provider on');
      if (b.enabled)
        // One provider answers at a time, so spend and model versions stay attributable.
        await tx.update(providerConfigurations).set({ enabled: false }).where(eq(providerConfigurations.enabled, true));
      const values = {
        model: b.model,
        sealedKey,
        enabled: b.enabled,
        timeoutMs: b.timeoutMs,
        maxOutputTokens: b.maxOutputTokens,
        priceInputMicros: Math.round(b.priceInputPerMTokUsd * 1_000_000),
        priceOutputMicros: Math.round(b.priceOutputPerMTokUsd * 1_000_000),
        updatedBy: ctx.userId,
        updatedAt: new Date(),
      };
      await tx
        .insert(providerConfigurations)
        .values({ tenantId: ctx.tenantId, provider, ...values })
        .onConflictDoUpdate({ target: [providerConfigurations.tenantId, providerConfigurations.provider], set: values });
      await this.audit.write(tx, actorOf(ctx), {
        action: 'provider.configured',
        targetType: 'provider',
        targetId: provider,
        details: { model: b.model, enabled: b.enabled, keyChanged: !!b.apiKey, timeoutMs: b.timeoutMs },
      });
      return { provider, enabled: b.enabled, hasKey: !!sealedKey };
    });
  }

  @Get('usage')
  @RequirePermissions('qa_projects.read')
  usage(@Ctx() ctx: RequestContext) {
    return withTenant(this.db, ctx.tenantId, async (tx) => {
      const since = new Date(Date.now() - 30 * 86_400_000);
      const [recent, byDay, totals] = await Promise.all([
        tx
          .select({ u: aiUsageRecords, code: aiProjects.code })
          .from(aiUsageRecords)
          .leftJoin(aiProjects, eq(aiProjects.id, aiUsageRecords.projectId))
          .orderBy(desc(aiUsageRecords.at))
          .limit(100),
        tx
          .select({
            day: sql<string>`to_char(date_trunc('day', ${aiUsageRecords.at}), 'YYYY-MM-DD')`,
            calls: sql<number>`count(*)::int`,
            costMicros: sql<string>`sum(${aiUsageRecords.costMicros})`,
          })
          .from(aiUsageRecords)
          .where(gte(aiUsageRecords.at, since))
          .groupBy(sql`1`)
          .orderBy(sql`1`),
        tx
          .select({
            provider: aiUsageRecords.provider,
            model: aiUsageRecords.model,
            status: aiUsageRecords.status,
            calls: sql<number>`count(*)::int`,
            inputTokens: sql<number>`sum(${aiUsageRecords.inputTokens})::int`,
            outputTokens: sql<number>`sum(${aiUsageRecords.outputTokens})::int`,
            costMicros: sql<string>`sum(${aiUsageRecords.costMicros})`,
          })
          .from(aiUsageRecords)
          .where(gte(aiUsageRecords.at, since))
          .groupBy(aiUsageRecords.provider, aiUsageRecords.model, aiUsageRecords.status),
      ]);
      return {
        recent: recent.map((r) => ({ ...r.u, at: r.u.at.toISOString(), costUsd: usd(r.u.costMicros), projectCode: r.code })),
        byDay: byDay.map((d) => ({ day: d.day, calls: d.calls, costUsd: usd(Number(d.costMicros)) })),
        totals: totals.map((t) => ({ ...t, costUsd: usd(Number(t.costMicros)) })),
      };
    });
  }

  @Get('budgets')
  @RequirePermissions('qa_projects.read')
  budgets(@Ctx() ctx: RequestContext) {
    return withTenant(this.db, ctx.tenantId, async (tx) => {
      const spent = await this.gateway.budgets(tx, null);
      const all = await tx.select({ b: apiBudgetLimits, code: aiProjects.code }).from(apiBudgetLimits).leftJoin(aiProjects, eq(aiProjects.id, apiBudgetLimits.projectId));
      const project = await Promise.all(
        all.filter((r) => r.b.projectId).map(async (r) => (await this.gateway.budgets(tx, r.b.projectId)).find((x) => x.id === r.b.id)),
      );
      return all.map((r) => {
        const s = spent.find((x) => x.id === r.b.id) ?? project.find((x) => x?.id === r.b.id);
        return {
          id: r.b.id,
          scope: r.b.scope,
          projectId: r.b.projectId,
          projectCode: r.code,
          period: r.b.period,
          limitUsd: usd(r.b.limitMicros),
          spentUsd: usd(s?.spentMicros ?? 0),
          percent: r.b.limitMicros ? Math.round(((s?.spentMicros ?? 0) / r.b.limitMicros) * 100) : 0,
          since: s?.from.toISOString() ?? null,
        };
      });
    });
  }

  @Put('budgets')
  @RequirePermissions('budgets.manage')
  setBudget(@Ctx() ctx: RequestContext, @Body(new ZodPipe(BudgetLimit)) b: BudgetLimit) {
    return withTenant(this.db, ctx.tenantId, async (tx) => {
      if (b.projectId) {
        const [p] = await tx.select({ id: aiProjects.id }).from(aiProjects).where(eq(aiProjects.id, b.projectId));
        if (!p) throw problem.badRequest('project_unknown', 'No such QA project');
      }
      const where = and(
        eq(apiBudgetLimits.period, b.period),
        b.projectId ? eq(apiBudgetLimits.projectId, b.projectId) : isNull(apiBudgetLimits.projectId),
      );
      const limitMicros = Math.round(b.limitUsd * 1_000_000);
      const [existing] = await tx.select().from(apiBudgetLimits).where(where);
      const [row] = existing
        ? await tx.update(apiBudgetLimits).set({ limitMicros, updatedBy: ctx.userId }).where(eq(apiBudgetLimits.id, existing.id)).returning()
        : await tx
            .insert(apiBudgetLimits)
            .values({ tenantId: ctx.tenantId, scope: b.scope, projectId: b.projectId ?? null, period: b.period, limitMicros, updatedBy: ctx.userId })
            .returning();
      await this.audit.write(tx, actorOf(ctx), {
        action: 'budget.set',
        targetType: 'budget',
        targetId: row!.id,
        details: { scope: b.scope, projectId: b.projectId ?? null, period: b.period, limitUsd: b.limitUsd, before: existing ? usd(existing.limitMicros) : null },
      });
      return { id: row!.id };
    });
  }

  @Delete('budgets/:id')
  @RequirePermissions('budgets.manage')
  deleteBudget(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return withTenant(this.db, ctx.tenantId, async (tx) => {
      const [row] = await tx.delete(apiBudgetLimits).where(eq(apiBudgetLimits.id, id)).returning();
      if (!row) throw problem.notFound('No such budget');
      await this.audit.write(tx, actorOf(ctx), { action: 'budget.removed', targetType: 'budget', targetId: id, details: { limitUsd: usd(row.limitMicros) } });
      return { ok: true };
    });
  }
}
