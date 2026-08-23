import {
  Body,
  Controller,
  Get,
  Inject,
  Module,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiKeysGuard,
  ApiKeysModule,
  RequireScope,
} from '@nestarc/api-keys';
import {
  JobsModule,
  createOutboxJobsPublisher,
} from '@nestarc/jobs';
import {
  OutboxEmitter,
  OutboxEvent,
  OutboxModule,
} from '@nestarc/outbox';
import {
  Can,
  InMemoryRbacStorage,
  RbacGuard,
  RbacModule,
} from '@nestarc/rbac';
import { createApiKeySubjectResolver } from '@nestarc/rbac/integrations/api-keys';
import { createTenancyTenantResolver } from '@nestarc/rbac/integrations/tenancy';
import {
  TenancyModule,
  TenancyService,
  tenancyTransaction,
} from '@nestarc/tenancy';
import {
  WebhookEvent,
  WebhookModule,
  WebhookService,
} from '@nestarc/webhook';
import {
  API_KEY_PEPPER,
  apiKeyStorage,
  apiKeyTenantExtractor,
  prisma,
  tenancyContext,
} from './runtime';

export const rbacStorage = new InMemoryRbacStorage();

class ProjectCreatedOutboxEvent extends OutboxEvent {
  static readonly eventType = 'project.created';

  constructor(
    public readonly projectId: string,
    public readonly name: string,
  ) {
    super();
  }
}

export class ProjectCreatedWebhookEvent extends WebhookEvent {
  static readonly eventType = 'project.created';

  constructor(
    public readonly projectId: string,
    public readonly name: string,
    public readonly observedTenantId: string,
  ) {
    super();
  }
}

@Controller('projects')
@UseGuards(ApiKeysGuard, RbacGuard)
export class ProjectsController {
  constructor(
    @Inject(TenancyService) private readonly tenancy: TenancyService,
    @Inject(OutboxEmitter) private readonly outbox: OutboxEmitter,
  ) {}

  @Post()
  @RequireScope('projects', 'write')
  @Can('projects.create', { tenant: 'required' })
  async create(@Body() body: { name: string }) {
    const tenantId = this.tenancy.getCurrentTenantOrThrow();
    return tenancyTransaction(prisma, this.tenancy, async (tx) => {
      const project = await tx.project.create({
        data: { tenantId, name: body.name },
      });
      await this.outbox.emit(
        tx,
        new ProjectCreatedOutboxEvent(project.id, project.name),
        {
          aggregateType: 'project',
          aggregateId: project.id,
          idempotencyKey: `project:${project.id}:created`,
          correlationId: project.id,
        },
      );
      return project;
    });
  }

  @Get()
  @RequireScope('projects', 'read')
  @Can('projects.read', { tenant: 'required' })
  list() {
    return tenancyTransaction(prisma, this.tenancy, (tx) =>
      tx.project.findMany({ orderBy: { name: 'asc' } }),
    );
  }
}

const JobsPublisher = createOutboxJobsPublisher({
  map: {
    'project.created': { job: 'webhook.publish' },
  },
});

@Module({
  imports: [
    TenancyModule.forRoot({
      tenantExtractor: apiKeyTenantExtractor,
      validateTenantId: (tenantId) => /^[0-9a-f-]{36}$/i.test(tenantId),
      missingContext: { policy: 'throw' },
    }),
    ApiKeysModule.forRoot({
      storage: apiKeyStorage,
      peppers: { 1: API_KEY_PEPPER },
      currentPepperVersion: 1,
      debounceMs: 0,
    }),
    RbacModule.forRoot({
      storage: rbacStorage,
      subjectResolver: createApiKeySubjectResolver(),
      tenantResolver: createTenancyTenantResolver(() =>
        tenancyContext.getTenantId(),
      ),
      tenant: {
        requiredByDefault: true,
        allowGlobalRolesInTenant: false,
      },
      writeValidation: { rejectTenantMismatch: true },
    }),
    JobsModule.forInMemory({
      jobTypes: ['webhook.publish'],
      contextExtractor: () => {
        const tenantId = tenancyContext.getTenantId();
        return tenantId ? { tenantId } : {};
      },
      contextRunner: async (context, callback) => {
        if (!context.tenantId) throw new Error('Job tenant context is required');
        return tenancyContext.run(context.tenantId, callback);
      },
    }),
    WebhookModule.forRoot({
      prisma,
      polling: { enabled: false, batchSize: 20 },
      delivery: { timeout: 5_000, maxRetries: 2, jitter: false },
      allowPrivateUrls: true,
    }),
    OutboxModule.forRoot({
      prisma,
      transport: JobsPublisher,
      delivery: { mode: 'publisher' },
      polling: { enabled: true, interval: 20, batchSize: 20 },
      retry: { maxRetries: 2, initialDelay: 10, backoff: 'fixed' },
      tenancy: {
        provider: {
          getTenantId: () => tenancyContext.getTenantId(),
          runWithTenant: (tenantId, callback) =>
            tenancyContext.run(tenantId, callback),
        },
      },
    }),
  ],
  controllers: [ProjectsController],
})
export class EcosystemModule {}
