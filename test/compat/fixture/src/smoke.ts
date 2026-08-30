import 'reflect-metadata';
import type { ExecutionContext, MiddlewareConsumer } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client/extension';
import {
  createPrismaTenancyExtension,
  tenancyTransaction,
  TenancyContext,
  TenancyEventService,
  TenancyEvents,
  TenancyModule,
  TenancyService,
  type PrismaTenancyExtensionOptions,
  type PrismaTransactionClient,
  type PrismaTransactionContext,
  type TenantCrossCheckFailedEvent,
  type TenantExtractionFailedEvent,
  type TenantNotFoundEvent,
  type TenantResolvedEvent,
  type TenantValidationFailedEvent,
} from '@nestarc/tenancy';
import { loadOptionalRuntime } from './optional-runtime';

type PrismaExtension = ReturnType<typeof Prisma.defineExtension>;

type CacheTrackBy = {
  trackBy(
    context: ExecutionContext,
  ): Promise<string | undefined> | string | undefined;
};

// Transparent transaction compatibility remains public through v0.16.x.
const deprecatedExtensionOptions: PrismaTenancyExtensionOptions = {
  interactiveTransactionSupport: false,
};
const resolvedEvent: TenantResolvedEvent = {
  tenantId: 'tenant-compat',
  requestSummary: { method: 'GET', path: '/products' },
};
const removedRawRequestEvents = [
  {
    tenantId: 'tenant-compat',
    // @ts-expect-error v0.16.0 declarations reject the removed raw request field.
    request: { headers: {} },
  } satisfies TenantResolvedEvent,
  {
    // @ts-expect-error v0.16.0 declarations reject the removed raw request field.
    request: { headers: {} },
  } satisfies TenantNotFoundEvent,
  {
    errorName: 'Error',
    errorMessage: 'bad tenant header',
    // @ts-expect-error v0.16.0 declarations reject the removed raw request field.
    request: { headers: {} },
  } satisfies TenantExtractionFailedEvent,
  {
    tenantId: 'tenant-compat',
    // @ts-expect-error v0.16.0 declarations reject the removed raw request field.
    request: { headers: {} },
  } satisfies TenantValidationFailedEvent,
  {
    extractedTenantId: 'tenant-compat',
    crossCheckTenantId: 'tenant-other',
    // @ts-expect-error v0.16.0 declarations reject the removed raw request field.
    request: { headers: {} },
  } satisfies TenantCrossCheckFailedEvent,
];
void removedRawRequestEvents;

function createExecutionContext(handler: () => void): ExecutionContext {
  return {
    getType: () => 'http',
    getClass: () => class OptionalCacheTarget {},
    getHandler: () => handler,
    switchToHttp: () => ({
      getRequest: () => ({ method: 'GET', url: '/products' }),
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
    switchToRpc: () => ({}),
    switchToWs: () => ({}),
    getArgs: () => [],
    getArgByIndex: () => undefined,
  } as unknown as ExecutionContext;
}

function verifyNestMiddlewarePath(nestMajor: number): void {
  const observed: { path?: unknown } = {};
  const consumer = {
    apply: () => ({
      forRoutes: (route: { path?: unknown }) => {
        observed.path = route.path;
      },
    }),
  };

  new TenancyModule().configure(
    consumer as unknown as MiddlewareConsumer,
  );

  const expected = nestMajor === 10 ? '*' : '{*splat}';
  if (observed.path !== expected) {
    throw new Error(
      `Nest ${nestMajor} middleware path was ${String(observed.path)}; expected ${expected}`,
    );
  }
}

function acceptPrismaExtension(
  extension: PrismaExtension,
): PrismaExtension {
  return extension;
}

async function main(): Promise<void> {
  const nestMajor = Number(process.env.TENANCY_COMPAT_NEST_MAJOR);
  if (nestMajor !== 10 && nestMajor !== 11) {
    throw new Error('TENANCY_COMPAT_NEST_MAJOR must be 10 or 11');
  }
  verifyNestMiddlewarePath(nestMajor);

  const optionalRuntime = loadOptionalRuntime();
  const moduleRef = await Test.createTestingModule({
    imports: [
      ...optionalRuntime.imports,
      TenancyModule.forRoot({
        tenantExtractor: 'x-tenant-id',
        dbSettingKey: 'compat.current_tenant',
      }),
    ],
    providers: [...optionalRuntime.providers],
  }).compile();

  await moduleRef.init();
  try {
    if (optionalRuntime.cacheToken) {
      moduleRef.get(optionalRuntime.cacheToken as never, { strict: false });
    }

    if (optionalRuntime.cacheInterceptorToken) {
      const interceptor = moduleRef.get(
        optionalRuntime.cacheInterceptorToken as never,
        { strict: false },
      ) as unknown as CacheTrackBy;
      const cacheKey = moduleRef.get(TenancyContext).run(
        'tenant-compat',
        () => interceptor.trackBy(
          createExecutionContext(optionalRuntime.cacheHandler),
        ),
      );
      if (cacheKey instanceof Promise) {
        throw new Error('Synchronous optional cache key became a Promise');
      }
      if (cacheKey !== 'tenant:13:tenant-compat:products') {
        throw new Error(`Unexpected optional cache key: ${String(cacheKey)}`);
      }
    }

    if (optionalRuntime.eventEmitterToken) {
      const emitter = moduleRef.get<{
        once(event: string, listener: () => void): void;
      }>(optionalRuntime.eventEmitterToken as never, { strict: false });
      let received = false;
      emitter.once(TenancyEvents.RESOLVED, () => {
        received = true;
      });
      moduleRef.get(TenancyEventService).emit(
        TenancyEvents.RESOLVED,
        resolvedEvent,
      );
      if (!received) throw new Error('Optional event emitter did not receive the event');
    }

    const context = moduleRef.get(TenancyContext);
    const service = moduleRef.get(TenancyService);
    const extension = acceptPrismaExtension(
      createPrismaTenancyExtension(service, deprecatedExtensionOptions),
    );
    if (typeof extension !== 'function') {
      throw new Error('Prisma extension factory did not return an extension');
    }

    let transactionOptions: Record<string, unknown> | undefined;
    let settingValues: unknown[] = [];
    const transactionContext: PrismaTransactionContext = {
      async $executeRaw(_strings, ...values) {
        settingValues = values;
        return 1;
      },
    };
    const transactionClient: PrismaTransactionClient = {
      async $transaction(callback, options) {
        transactionOptions = options;
        return callback(transactionContext);
      },
    };

    const result = await context.run('tenant-compat', () =>
      tenancyTransaction(
        transactionClient,
        service,
        async () => service.getCurrentTenantOrThrow(),
        {
          maxWait: 101,
          timeout: 202,
          isolationLevel: 'ReadCommitted',
        },
      ),
    );

    if (result !== 'tenant-compat') {
      throw new Error(`Unexpected transaction result: ${result}`);
    }
    if (
      settingValues[0] !== 'compat.current_tenant' ||
      settingValues[1] !== 'tenant-compat'
    ) {
      throw new Error(`Unexpected set_config values: ${settingValues.join(',')}`);
    }
    if (
      transactionOptions?.maxWait !== 101 ||
      transactionOptions.timeout !== 202 ||
      transactionOptions.isolationLevel !== 'ReadCommitted'
    ) {
      throw new Error('Transaction options were not forwarded');
    }
  } finally {
    await moduleRef.close();
  }

  console.log(
    `peer compatibility smoke passed for Nest ${nestMajor} with ` +
      `${process.env.TENANCY_COMPAT_OPTIONAL_PEERS ?? 'none'} optional peers`,
  );
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
