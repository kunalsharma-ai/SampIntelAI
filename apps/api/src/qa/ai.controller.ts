import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { BudgetLimit, ConnectionId, ModelListRequest, ProviderConfig } from '@si/contracts';
import { aiProjects, aiUsageRecords, apiBudgetLimits, providerConfigurations, withTenant, type Db } from '@si/db';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { actorOf, AuditService } from '../audit/audit.service.js';
import type { RequestContext } from '../common/context.js';
import { Ctx, RequirePermissions } from '../common/decorators.js';
import { problem } from '../common/problem.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { DB } from '../db/db.module.js';
import { assertHttpsAddress, EgressRefused } from './egress.js';
import { ModelGateway } from './gateway.js';
import { listModels, ModelUnavailable } from './providers.js';

const usd = (micros: number) => Math.round(micros) / 1_000_000;
const FIXTURE_DEFAULT = {
  provider: 'fixture',
  kind: 'fixture',
  label: 'FIXTURE',
  baseUrl: null,
  authStyle: 'bearer',
  model: 'fixture-answerer',
  sealedKey: null,
  enabled: false,
  timeoutMs: 15_000,
  maxOutputTokens: 300,
  priceInputMicros: 0,
  priceOutputMicros: 0,
  updatedAt: null as Date | null,
};

const ADDRESS_PROBLEMS: Record<string, string> = {
  address_invalid: 'That address is not a valid URL',
  https_required: 'Use an https:// address',
  credentials_in_address: 'Put the key in the API key field, not in the address',
  host_not_public: 'Only public internet addresses can be used, not local or private ones',
};

function checkAddress(url: string | undefined) {
  if (!url) return;
  try {
    assertHttpsAddress(url);
  } catch (e) {
    if (e instanceof EgressRefused)
      throw problem.badRequest(`address_${e.reason}`, ADDRESS_PROBLEMS[e.reason] ?? 'Address refused');
    throw e;
  }
}

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
      const rows = await tx.select().from(providerConfigurations).orderBy(providerConfigurations.updatedAt);
      const all = rows.some((r) => r.provider === 'fixture')
        ? rows
        : [{ ...FIXTURE_DEFAULT, configured: false }, ...rows];
      return all
        .map((r) => ({
          id: r.provider,
          kind: r.kind,
          label: r.label || r.provider,
          baseUrl: r.baseUrl,
          authStyle: r.authStyle,
          configured: !('configured' in r),
          model: r.model,
          hasKey: !!r.sealedKey,
          enabled: r.enabled,
          timeoutMs: r.timeoutMs,
          maxOutputTokens: r.maxOutputTokens,
          priceInputPerMTokUsd: usd(r.priceInputMicros),
          priceOutputPerMTokUsd: usd(r.priceOutputMicros),
          live: r.kind !== 'fixture',
          updatedAt: r.updatedAt?.toISOString() ?? null,
        }))
        .sort((x, y) => Number(y.id === 'fixture') - Number(x.id === 'fixture'));
    });
  }

  @Put('providers/:id')
  @RequirePermissions('providers.manage')
  setProvider(
    @Ctx() ctx: RequestContext,
    @Param('id') raw: string,
    @Body(new ZodPipe(ProviderConfig)) b: ProviderConfig,
  ) {
    const id = new ZodPipe(ConnectionId).transform(raw);
    if ((id === 'fixture') !== (b.kind === 'fixture'))
      throw problem.badRequest('fixture_reserved', 'The name "fixture" is kept for the built-in FIXTURE answerer');
    if (b.kind === 'openai_compatible' && !b.baseUrl)
      throw problem.badRequest(
        'base_url_required',
        "Add the base URL from the provider's API docs, for example https://api.groq.com/openai/v1",
      );
    const baseUrl = b.kind === 'fixture' ? null : (b.baseUrl?.replace(/\/+$/, '') ?? null);
    checkAddress(baseUrl ?? undefined);
    return withTenant(this.db, ctx.tenantId, async (tx) => {
      const [existing] = await tx.select().from(providerConfigurations).where(eq(providerConfigurations.provider, id));
      // A stored key only ever goes to the API and address it was entered for.
      const moved =
        !!existing &&
        (existing.kind !== b.kind || (existing.baseUrl ?? null) !== baseUrl || existing.authStyle !== b.authStyle);
      if (moved && existing.sealedKey && !b.apiKey)
        throw problem.badRequest('key_reentry_required', 'The API type or address changed, so enter the key again');
      const sealedKey =
        b.kind === 'fixture'
          ? null
          : b.apiKey
            ? this.gateway.seal(id, ctx.tenantId, b.apiKey)
            : (existing?.sealedKey ?? null);
      if (b.enabled && b.kind !== 'fixture' && !sealedKey)
        throw problem.badRequest('key_required', 'Add an API key before turning this provider on');
      if (b.enabled)
        // One provider answers at a time, so spend and model versions stay attributable.
        await tx.update(providerConfigurations).set({ enabled: false }).where(eq(providerConfigurations.enabled, true));
      const values = {
        kind: b.kind,
        label: b.label,
        baseUrl,
        authStyle: b.authStyle,
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
        .values({ tenantId: ctx.tenantId, provider: id, ...values })
        .onConflictDoUpdate({
          target: [providerConfigurations.tenantId, providerConfigurations.provider],
          set: values,
        });
      await this.audit.write(tx, actorOf(ctx), {
        action: existing ? 'provider.configured' : 'provider.added',
        targetType: 'provider',
        targetId: id,
        details: {
          kind: b.kind,
          label: b.label,
          baseUrl,
          model: b.model,
          enabled: b.enabled,
          keyChanged: !!b.apiKey,
          timeoutMs: b.timeoutMs,
        },
      });
      return { id, enabled: b.enabled, hasKey: !!sealedKey };
    });
  }

  @Delete('providers/:id')
  @RequirePermissions('providers.manage')
  removeProvider(@Ctx() ctx: RequestContext, @Param('id') raw: string) {
    const id = new ZodPipe(ConnectionId).transform(raw);
    if (id === 'fixture')
      throw problem.badRequest(
        'fixture_reserved',
        'The built-in FIXTURE answerer cannot be removed; turn it off instead',
      );
    return withTenant(this.db, ctx.tenantId, async (tx) => {
      const [row] = await tx.delete(providerConfigurations).where(eq(providerConfigurations.provider, id)).returning();
      if (!row) throw problem.notFound('No such AI connection');
      // Usage records keep the connection id, so past spend stays attributable after removal.
      await this.audit.write(tx, actorOf(ctx), {
        action: 'provider.removed',
        targetType: 'provider',
        targetId: id,
        details: { kind: row.kind, label: row.label, wasEnabled: row.enabled },
      });
      return { ok: true };
    });
  }

  /** Sends one small fictional question through the saved connection. Metered and budget-checked like any call. */
  @Post('providers/:id/test')
  @HttpCode(200)
  @RequirePermissions('providers.manage')
  testProvider(@Ctx() ctx: RequestContext, @Param('id') raw: string) {
    const id = new ZodPipe(ConnectionId).transform(raw);
    return withTenant(this.db, ctx.tenantId, async (tx) => {
      const [row] = await tx.select().from(providerConfigurations).where(eq(providerConfigurations.provider, id));
      if (!row) throw problem.notFound('Save this connection before testing it');
      const r = await this.gateway.test(tx, ctx.tenantId, row);
      await this.audit.write(tx, actorOf(ctx), {
        action: 'provider.tested',
        targetType: 'provider',
        targetId: id,
        details: { ok: r.ok, reason: r.reason },
      });
      return r;
    });
  }

  /** Lists the models a key can use, so a person picks one rather than typing an id. */
  @Post('models')
  @HttpCode(200)
  @RequirePermissions('providers.manage')
  models(@Ctx() ctx: RequestContext, @Body(new ZodPipe(ModelListRequest)) b: ModelListRequest) {
    if (b.kind === 'openai_compatible' && !b.baseUrl)
      throw problem.badRequest('base_url_required', 'Add the base URL first');
    const baseUrl = b.baseUrl?.replace(/\/+$/, '') ?? null;
    checkAddress(baseUrl ?? undefined);
    return withTenant(this.db, ctx.tenantId, async (tx) => {
      let apiKey = b.apiKey ?? null;
      if (!apiKey && b.connection) {
        const [row] = await tx
          .select()
          .from(providerConfigurations)
          .where(eq(providerConfigurations.provider, b.connection));
        // The stored key is only used for the same API and address it was saved with.
        if (row?.sealedKey && row.kind === b.kind && (row.baseUrl ?? null) === baseUrl && row.authStyle === b.authStyle)
          apiKey = this.gateway.connection(row).apiKey;
      }
      if (!apiKey) throw problem.badRequest('key_required', 'Enter the API key to load the model list');
      try {
        const models = await listModels({
          kind: b.kind,
          baseUrl,
          authStyle: b.authStyle,
          model: '',
          apiKey,
          timeoutMs: 15_000,
          maxOutputTokens: 16,
        });
        return { ok: true, models, reason: null, detail: null };
      } catch (e) {
        if (e instanceof ModelUnavailable) return { ok: false, models: [], reason: e.reason, detail: e.detail ?? null };
        throw e;
      }
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
        recent: recent.map((r) => ({
          ...r.u,
          at: r.u.at.toISOString(),
          costUsd: usd(r.u.costMicros),
          projectCode: r.code,
        })),
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
      const all = await tx
        .select({ b: apiBudgetLimits, code: aiProjects.code })
        .from(apiBudgetLimits)
        .leftJoin(aiProjects, eq(aiProjects.id, apiBudgetLimits.projectId));
      const project = await Promise.all(
        all
          .filter((r) => r.b.projectId)
          .map(async (r) => (await this.gateway.budgets(tx, r.b.projectId)).find((x) => x.id === r.b.id)),
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
        ? await tx
            .update(apiBudgetLimits)
            .set({ limitMicros, updatedBy: ctx.userId })
            .where(eq(apiBudgetLimits.id, existing.id))
            .returning()
        : await tx
            .insert(apiBudgetLimits)
            .values({
              tenantId: ctx.tenantId,
              scope: b.scope,
              projectId: b.projectId ?? null,
              period: b.period,
              limitMicros,
              updatedBy: ctx.userId,
            })
            .returning();
      await this.audit.write(tx, actorOf(ctx), {
        action: 'budget.set',
        targetType: 'budget',
        targetId: row!.id,
        details: {
          scope: b.scope,
          projectId: b.projectId ?? null,
          period: b.period,
          limitUsd: b.limitUsd,
          before: existing ? usd(existing.limitMicros) : null,
        },
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
      await this.audit.write(tx, actorOf(ctx), {
        action: 'budget.removed',
        targetType: 'budget',
        targetId: id,
        details: { limitUsd: usd(row.limitMicros) },
      });
      return { ok: true };
    });
  }
}
