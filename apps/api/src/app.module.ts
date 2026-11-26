import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuditController } from './audit/audit.controller.js';
import { AuditService } from './audit/audit.service.js';
import { AuthController } from './auth/auth.controller.js';
import { AuthService } from './auth/auth.service.js';
import { SessionGuard } from './auth/session.guard.js';
import { ProblemFilter } from './common/problem.filter.js';
import { ENV, type Env } from './config.js';
import { DbModule } from './db/db.module.js';
import { HealthController } from './health/health.controller.js';
import { MetricsController } from './metrics.js';
import { NotificationsController } from './notifications/notifications.controller.js';
import { OpenApiController } from './openapi.js';
import { SettingsController } from './settings/settings.controller.js';
import { UsersController } from './users/users.controller.js';
import { UsersService } from './users/users.service.js';
import { AiController } from './qa/ai.controller.js';
import { AuthorizationsController, AuthorizationsService } from './qa/authorizations.js';
import { ExportsController, IntegrationController } from './qa/exports.js';
import { ModelGateway } from './qa/gateway.js';
import { QaController } from './qa/qa.controller.js';
import { QaService } from './qa/qa.service.js';
import { QaWorker } from './qa/worker.js';

@Module({})
export class AppModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: AppModule,
      global: true,
      imports: [
        ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: env.NODE_ENV === 'test' ? 10_000 : env.API_RATE_LIMIT }]),
        { module: DbModule, providers: [{ provide: ENV, useValue: env }], exports: [ENV] },
      ],
      providers: [
        { provide: ENV, useValue: env },
        AuditService,
        AuthService,
        UsersService,
        AuthorizationsService,
        QaService,
        ModelGateway,
        QaWorker,
        { provide: APP_GUARD, useClass: ThrottlerGuard },
        { provide: APP_GUARD, useClass: SessionGuard },
        { provide: APP_FILTER, useClass: ProblemFilter },
      ],
      exports: [ENV],
      controllers: [
        HealthController,
        MetricsController,
        OpenApiController,
        AuthController,
        UsersController,
        AuditController,
        SettingsController,
        NotificationsController,
        AuthorizationsController,
        QaController,
        AiController,
        ExportsController,
        IntegrationController,
      ],
    };
  }
}
