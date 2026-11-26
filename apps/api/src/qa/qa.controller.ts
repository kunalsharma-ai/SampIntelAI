import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  JobCreate,
  QaKillSwitch,
  QaProjectCreate,
  QaProjectStatus,
  QaProjectUrls,
  ScenarioCreate,
  SessionReview,
  SyntheticProfileCreate,
} from '@si/contracts';
import { z } from 'zod';
import type { RequestContext } from '../common/context.js';
import { Ctx, RequirePermissions } from '../common/decorators.js';
import { problem } from '../common/problem.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { ENV, type Env } from '../config.js';
import { QaService } from './qa.service.js';
import { QaWorker } from './worker.js';

const uuid = z.uuid().optional();
const q = <T extends z.ZodType>(schema: T, v: unknown): z.infer<T> => new ZodPipe(schema).transform(v);

@Controller('qa')
export class QaController {
  constructor(
    private readonly qa: QaService,
    private readonly worker: QaWorker,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get('projects')
  @RequirePermissions('qa_projects.read')
  projects(@Ctx() ctx: RequestContext) {
    return this.qa.projects(ctx);
  }

  @Post('projects')
  @HttpCode(201)
  @RequirePermissions('qa_projects.manage')
  createProject(@Ctx() ctx: RequestContext, @Body(new ZodPipe(QaProjectCreate)) b: QaProjectCreate) {
    return this.qa.createProject(ctx, b);
  }

  @Patch('projects/:id/status')
  @RequirePermissions('qa_projects.manage')
  status(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(QaProjectStatus)) b: z.infer<typeof QaProjectStatus>) {
    return this.qa.setProjectStatus(ctx, id, b.status);
  }

  @Patch('projects/:id/urls')
  @RequirePermissions('qa_projects.manage')
  urls(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(QaProjectUrls)) b: z.infer<typeof QaProjectUrls>) {
    return this.qa.setUrls(ctx, id, b);
  }

  @Get('surveys')
  @RequirePermissions('qa_projects.read')
  surveys(@Ctx() ctx: RequestContext, @Query('stage') stage: string) {
    return this.qa.surveys(ctx, q(z.enum(['gate', 'client']), stage));
  }

  @Get('profiles')
  @RequirePermissions('qa_projects.read')
  profiles(@Ctx() ctx: RequestContext) {
    return this.qa.profiles(ctx);
  }

  @Post('profiles')
  @HttpCode(201)
  @RequirePermissions('scenarios.manage')
  createProfile(@Ctx() ctx: RequestContext, @Body(new ZodPipe(SyntheticProfileCreate)) b: z.infer<typeof SyntheticProfileCreate>) {
    return this.qa.createProfile(ctx, b);
  }

  @Get('scenarios')
  @RequirePermissions('qa_projects.read')
  scenarios(@Ctx() ctx: RequestContext, @Query('projectId') projectId?: string) {
    return this.qa.scenarios(ctx, q(uuid, projectId));
  }

  @Post('scenarios')
  @HttpCode(201)
  @RequirePermissions('scenarios.manage')
  createScenario(@Ctx() ctx: RequestContext, @Body(new ZodPipe(ScenarioCreate)) b: ScenarioCreate) {
    return this.qa.createScenario(ctx, b);
  }

  @Delete('scenarios/:id')
  @RequirePermissions('scenarios.manage')
  archive(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.qa.archiveScenario(ctx, id);
  }

  @Get('jobs')
  @RequirePermissions('qa_projects.read')
  jobs(@Ctx() ctx: RequestContext, @Query('projectId') projectId?: string) {
    return this.qa.jobs(ctx, q(uuid, projectId));
  }

  @Get('jobs/:id')
  @RequirePermissions('qa_projects.read')
  job(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.qa.job(ctx, id);
  }

  @Post('jobs')
  @HttpCode(201)
  @RequirePermissions('executions.run')
  createJob(@Ctx() ctx: RequestContext, @Body(new ZodPipe(JobCreate)) b: JobCreate) {
    return this.qa.createJob(ctx, b);
  }

  @Post('jobs/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('executions.run')
  cancel(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.qa.cancelJob(ctx, id);
  }

  @Get('kill-switch')
  @RequirePermissions('qa_projects.read')
  kill(@Ctx() ctx: RequestContext) {
    return this.qa.killSwitch(ctx);
  }

  @Put('kill-switch')
  @RequirePermissions('executions.emergency_stop')
  setKill(@Ctx() ctx: RequestContext, @Body(new ZodPipe(QaKillSwitch)) b: z.infer<typeof QaKillSwitch>) {
    return this.qa.setKillSwitch(ctx, b.on, b.reason);
  }

  /** Runs one worker pass for this tenant now. Local and test use only; production relies on the scheduler. */
  @Post('tick')
  @HttpCode(200)
  @RequirePermissions('executions.run')
  tick(@Ctx() ctx: RequestContext) {
    if (this.env.NODE_ENV === 'production') throw problem.forbidden('not_in_production', 'Use the scheduler in production');
    return this.worker.tick(new Date(), ctx.tenantId);
  }

  @Get('sessions')
  @RequirePermissions('results.read')
  sessions(
    @Ctx() ctx: RequestContext,
    @Query('projectId') projectId?: string,
    @Query('jobId') jobId?: string,
    @Query('outcome') outcome?: string,
    @Query('review') review?: string,
  ) {
    return this.qa.sessions(ctx, {
      projectId: q(uuid, projectId),
      jobId: q(uuid, jobId),
      outcome: q(z.string().max(40).optional(), outcome),
      review: q(z.enum(['open', 'reviewed_ok', 'reviewed_issue']).optional(), review),
    });
  }

  @Get('sessions/:id')
  @RequirePermissions('results.read')
  session(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.qa.session(ctx, id);
  }

  @Post('sessions/:id/review')
  @HttpCode(200)
  @RequirePermissions('results.review')
  review(@Ctx() ctx: RequestContext, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(SessionReview)) b: z.infer<typeof SessionReview>) {
    return this.qa.review(ctx, id, b.status, b.note);
  }

  @Get('stats')
  @RequirePermissions('results.read')
  stats(@Ctx() ctx: RequestContext, @Query('projectId') projectId?: string) {
    return this.qa.stats(ctx, q(uuid, projectId));
  }

  @Get('questions')
  @RequirePermissions('results.read')
  questions(@Ctx() ctx: RequestContext, @Query('projectId') projectId?: string, @Query('stage') stage?: string) {
    return this.qa.questions(ctx, q(uuid, projectId), q(z.enum(['gate', 'client']).optional(), stage));
  }

  @Get('quality')
  @RequirePermissions('results.read')
  quality(@Ctx() ctx: RequestContext, @Query('projectId') projectId?: string) {
    return this.qa.quality(ctx, q(uuid, projectId));
  }

  @Get('regression')
  @RequirePermissions('results.read')
  regression(@Ctx() ctx: RequestContext, @Query('a') a: string, @Query('b') b: string) {
    return this.qa.regression(ctx, q(z.uuid(), a), q(z.uuid(), b));
  }

  @Get('ip-records')
  @RequirePermissions('ip_risk.read')
  ip(@Ctx() ctx: RequestContext, @Query('projectId') projectId?: string) {
    return this.qa.ipRecords(ctx, q(uuid, projectId));
  }

  @Get('security-events')
  @RequirePermissions('security.read')
  security(@Ctx() ctx: RequestContext) {
    return this.qa.securityEvents(ctx);
  }
}
