import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BypassTenancy,
  BullTenantPropagator,
  CompositeTenantExtractor,
  createPrismaTenancyExtension,
  CurrentTenant,
  GrpcTenantPropagator,
  HeaderTenantExtractor,
  HttpTenantPropagator,
  JwtClaimTenantExtractor,
  KafkaTenantPropagator,
  PathTenantExtractor,
  propagateTenantHeaders,
  SubdomainTenantExtractor,
  TENANCY_MODULE_OPTIONS,
  TenancyContext,
  TenancyContextRequiredError,
  TenancyEventService,
  TenancyEvents,
  TenancyModule,
  TenancyTelemetryService,
  tenancyTransaction,
  TenantContextInterceptor,
  TenantContextDiagnostics,
  TenantContextMissingError,
  TenantResourceKey,
  TenantSearch,
  TenancyService,
} from '../src';
import type {
  BullPropagationOptions,
  GrpcMetadataLike,
  GrpcPropagationOptions,
  HttpPropagationOptions,
  JwtClaimExtractorOptions,
  KafkaMessageLike,
  KafkaPropagationOptions,
  PathExtractorOptions,
  PrismaTenancyExtensionOptions,
  PrismaTransactionClient,
  PrismaTransactionContext,
  SubdomainExtractorOptions,
  TelemetryOptions,
  TenancyEventMap,
  TenancyEventRequestSummary,
  TenancyModuleAsyncOptions,
  TenancyModuleOptions,
  TenancyModuleOptionsFactory,
  TenancyRequest,
  TenancyResponse,
  TenancyTransactionOptions,
  TenantContextBypassedEvent,
  TenantContextCarrier,
  TenantContextInterceptorOptions,
  TenantContextDiagnosticsOptions,
  InvalidTenantContextDiagnostic,
  MissingTenantContextDiagnostic,
  MissingTenantContextPolicy,
  TenantCrossCheckFailedEvent,
  TenantExtractionFailedEvent,
  TenantExtractor,
  TenantIdValidator,
  TenantNotFoundEvent,
  TenantPropagator,
  TenantResolvedEvent,
  TenantValidationFailedEvent,
  TenantResourceKeyOptions,
  TenantSearchAdapter,
  TenantSearchOptions,
  TenantSearchScope,
} from '../src';
import {
  expectTenantIsolation,
  TestTenancyModule,
  withTenant,
} from '../src/testing';
import type {
  IsolationTestOptions,
  TestTenancyModuleOptions,
} from '../src/testing';
import {
  SharedTenantCache,
  TENANT_CACHE_INTERCEPTOR_OPTIONS,
  TenantCacheInterceptor,
} from '../src/cache';
import type { TenantCacheInterceptorOptions } from '../src/cache';

type PackageMetadata = {
  exports: Record<string, { types: string; default: string }>;
  typesVersions?: Record<string, Record<string, string[]>>;
};

describe('public API barrels', () => {
  it('exports root runtime API from src/index.ts', () => {
    const runtimeExports = {
      TenancyModule,
      TENANCY_MODULE_OPTIONS,
      TenancyService,
      TenancyContext,
      CurrentTenant,
      BypassTenancy,
      HeaderTenantExtractor,
      SubdomainTenantExtractor,
      JwtClaimTenantExtractor,
      PathTenantExtractor,
      CompositeTenantExtractor,
      createPrismaTenancyExtension,
      tenancyTransaction,
      TenantContextMissingError,
      TenancyContextRequiredError,
      HttpTenantPropagator,
      propagateTenantHeaders,
      BullTenantPropagator,
      KafkaTenantPropagator,
      GrpcTenantPropagator,
      TenantContextInterceptor,
      TenantContextDiagnostics,
      TenantResourceKey,
      TenantSearch,
      TenancyEventService,
      TenancyTelemetryService,
      TenancyEvents,
    };

    expect(runtimeExports).toEqual(
      expect.objectContaining({
        TenancyModule: expect.any(Function),
        TENANCY_MODULE_OPTIONS: Symbol.for('@nestarc/tenancy/TENANCY_MODULE_OPTIONS'),
        TenancyService: expect.any(Function),
        TenancyContext: expect.any(Function),
        CurrentTenant: expect.any(Function),
        BypassTenancy: expect.any(Function),
        HeaderTenantExtractor: expect.any(Function),
        SubdomainTenantExtractor: expect.any(Function),
        JwtClaimTenantExtractor: expect.any(Function),
        PathTenantExtractor: expect.any(Function),
        CompositeTenantExtractor: expect.any(Function),
        createPrismaTenancyExtension: expect.any(Function),
        tenancyTransaction: expect.any(Function),
        TenantContextMissingError: expect.any(Function),
        TenancyContextRequiredError: expect.any(Function),
        HttpTenantPropagator: expect.any(Function),
        propagateTenantHeaders: expect.any(Function),
        BullTenantPropagator: expect.any(Function),
        KafkaTenantPropagator: expect.any(Function),
        GrpcTenantPropagator: expect.any(Function),
        TenantContextInterceptor: expect.any(Function),
        TenantContextDiagnostics: expect.any(Function),
        TenantResourceKey: expect.any(Function),
        TenantSearch: expect.any(Function),
        TenancyEventService: expect.any(Function),
        TenancyTelemetryService: expect.any(Function),
        TenancyEvents: expect.objectContaining({
          RESOLVED: 'tenant.resolved',
          NOT_FOUND: 'tenant.not_found',
          CONTEXT_MISSING: 'tenant.context_missing',
          CONTEXT_INVALID: 'tenant.context_invalid',
        }),
      }),
    );
  });

  it('keeps cache runtime API off the root surface to preserve optional peer safety', () => {
    try {
      jest.isolateModules(() => {
        jest.doMock('@nestjs/cache-manager', () => {
          throw new Error('root API imported optional cache runtime');
        });

        const rootApi = jest.requireActual('../src') as Record<string, unknown>;

        expect(rootApi.TenantCacheInterceptor).toBeUndefined();
      });
    } finally {
      jest.dontMock('@nestjs/cache-manager');
    }
  });

  it('exports testing runtime API from src/testing/index.ts', () => {
    expect({
      TestTenancyModule,
      withTenant,
      expectTenantIsolation,
    }).toEqual({
      TestTenancyModule: expect.any(Function),
      withTenant: expect.any(Function),
      expectTenantIsolation: expect.any(Function),
    });
  });

  it('exports cache runtime API from src/cache/index.ts', () => {
    const options: TenantCacheInterceptorOptions = {
      tenantPrefix: 'tenant',
      sharedPrefix: 'shared',
    };

    expect({
      SharedTenantCache,
      TENANT_CACHE_INTERCEPTOR_OPTIONS,
      TenantCacheInterceptor,
      options,
    }).toEqual({
      SharedTenantCache: expect.any(Function),
      TENANT_CACHE_INTERCEPTOR_OPTIONS: Symbol.for(
        '@nestarc/tenancy/TENANT_CACHE_INTERCEPTOR_OPTIONS',
      ),
      TenantCacheInterceptor: expect.any(Function),
      options,
    });
  });

  it('publishes cache API through a dedicated subpath export', () => {
    const packageMetadata = JSON.parse(
      readFileSync(join(__dirname, '..', 'package.json'), 'utf8'),
    ) as PackageMetadata;

    expect(packageMetadata.exports['./cache']).toEqual({
      types: './dist/cache/index.d.ts',
      default: './dist/cache/index.js',
    });
    expect(packageMetadata.typesVersions?.['*']).toEqual(
      expect.objectContaining({
        testing: ['dist/testing/index.d.ts'],
        cache: ['dist/cache/index.d.ts'],
      }),
    );
  });

  it('allows representative public types to be used without internal imports', () => {
    const extractor: TenantExtractor = {
      extract: (request) => request.headers['x-tenant-id'] as string | undefined ?? null,
    };
    const telemetryOptions: TelemetryOptions = {
      spanAttributeKey: 'tenant.id',
      createSpans: true,
    };
    const tenantIdValidator: TenantIdValidator =
      (tenantId) => tenantId.length > 0;
    const moduleOptions: TenancyModuleOptions = {
      tenantExtractor: extractor,
      dbSettingKey: 'app.current_tenant',
      validateTenantId: tenantIdValidator,
      crossCheck: {
        extractor,
        onFailed: 'log',
        required: false,
      },
      telemetry: telemetryOptions,
      missingContext: { policy: 'warn' },
    };
    const optionsFactory: TenancyModuleOptionsFactory = {
      createTenancyOptions: () => moduleOptions,
    };
    const asyncOptions: TenancyModuleAsyncOptions = {
      inject: [],
      useFactory: () => moduleOptions,
    };

    const subdomainOptions: SubdomainExtractorOptions = {
      excludeSubdomains: ['www', 'app'],
    };
    const jwtClaimOptions: JwtClaimExtractorOptions = {
      claimKey: 'tenant_id',
      headerName: 'Authorization',
    };
    const pathOptions: PathExtractorOptions = {
      pattern: '/tenants/:tenantId/projects',
      paramName: 'tenantId',
    };

    const prismaOptions: PrismaTenancyExtensionOptions = {
      dbSettingKey: 'app.current_tenant',
      autoInjectTenantId: true,
      tenantIdField: 'tenant_id',
      sharedModels: ['FeatureFlag'],
      failClosed: true,
      interactiveTransactionSupport: false,
    };
    const transactionOptions: TenancyTransactionOptions = {
      timeout: 5_000,
      isolationLevel: 'Serializable',
      dbSettingKey: 'app.current_tenant',
    };
    const transactionContext: PrismaTransactionContext = {
      $executeRaw: async () => 1,
    };
    const transactionClient: PrismaTransactionClient<typeof transactionContext> = {
      $transaction: (callback) => callback(transactionContext),
    };

    const httpPropagationOptions: HttpPropagationOptions = {
      headerName: 'X-Tenant-Id',
    };
    const bullPropagationOptions: BullPropagationOptions = {
      dataKey: '__tenantId',
    };
    const kafkaPropagationOptions: KafkaPropagationOptions = {
      headerName: 'X-Tenant-Id',
    };
    const grpcPropagationOptions: GrpcPropagationOptions = {
      metadataKey: 'x-tenant-id',
    };
    const propagator: TenantPropagator = {
      getHeaders: () => ({ 'X-Tenant-Id': 'tenant-a' }),
    };
    const carrier: TenantContextCarrier<Record<string, unknown>> = {
      inject: (value) => ({ ...value, tenantId: 'tenant-a' }),
      extract: (value) => typeof value.tenantId === 'string' ? value.tenantId : null,
    };
    const kafkaMessage: KafkaMessageLike = {
      headers: { 'X-Tenant-Id': Buffer.from('tenant-a') },
      value: 'payload',
    };
    const grpcMetadata: GrpcMetadataLike = {
      set: jest.fn(),
      get: () => ['tenant-a'],
    };

    const requestSummary: TenancyEventRequestSummary = {
      method: 'GET',
      path: '/projects',
      ip: '127.0.0.1',
      userAgent: 'jest',
      host: 'tenant.example.com',
    };
    const resolvedEvent: TenantResolvedEvent = {
      tenantId: 'tenant-a',
      requestSummary,
    };
    const notFoundEvent: TenantNotFoundEvent = {
      requestSummary,
    };
    const extractionFailedEvent: TenantExtractionFailedEvent = {
      errorName: 'Error',
      errorMessage: 'bad tenant header',
      requestSummary,
    };
    const validationFailedEvent: TenantValidationFailedEvent = {
      tenantId: 'tenant-a',
      requestSummary,
    };
    const bypassedEvent: TenantContextBypassedEvent = {
      reason: 'withoutTenant',
      previousTenantId: 'tenant-a',
      requestSummary,
    };
    const crossCheckFailedEvent: TenantCrossCheckFailedEvent = {
      extractedTenantId: 'tenant-a',
      crossCheckTenantId: 'tenant-b',
      requestSummary,
    };
    const eventMap: TenancyEventMap = {
      [TenancyEvents.RESOLVED]: resolvedEvent,
      [TenancyEvents.NOT_FOUND]: notFoundEvent,
      [TenancyEvents.EXTRACTION_FAILED]: extractionFailedEvent,
      [TenancyEvents.VALIDATION_FAILED]: validationFailedEvent,
      [TenancyEvents.CONTEXT_BYPASSED]: bypassedEvent,
      [TenancyEvents.CROSS_CHECK_FAILED]: crossCheckFailedEvent,
      [TenancyEvents.CONTEXT_MISSING]: {
        transport: 'redis',
        operation: 'key',
        resource: 'cache',
      },
      [TenancyEvents.CONTEXT_INVALID]: {
        transport: 'kafka',
        operation: 'consume',
        resource: 'orders',
      },
    };

    const request: TenancyRequest = {
      headers: { 'x-tenant-id': 'tenant-a' },
      hostname: 'tenant.example.com',
      path: '/projects',
      url: '/projects?active=true',
      method: 'GET',
    };
    const response: TenancyResponse = {
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json: jest.fn(),
      end: jest.fn(),
    };
    const interceptorOptions: TenantContextInterceptorOptions = {
      transport: 'kafka',
      kafkaHeaderName: 'X-Tenant-Id',
      validateTenantId: tenantIdValidator,
    };
    const missingPolicy: MissingTenantContextPolicy = 'warn';
    const missingOptions: TenantContextDiagnosticsOptions = {
      policy: missingPolicy,
    };
    const missingDiagnostic: MissingTenantContextDiagnostic = {
      transport: 'redis',
      operation: 'key',
      resource: 'cache',
    };
    const invalidDiagnostic: InvalidTenantContextDiagnostic = {
      transport: 'kafka',
      operation: 'consume',
      resource: 'orders',
    };
    const resourceKeyOptions: TenantResourceKeyOptions = {
      transport: 'redis',
      resource: 'cache',
    };
    const searchScope: TenantSearchScope = {
      tenantId: 'tenant-a',
      index: 'products',
    };
    const searchOptions: TenantSearchOptions = { index: 'products' };
    const searchAdapter: TenantSearchAdapter<string, string[]> = {
      search: async () => ['result'],
    };

    const testingModuleOptions: TestTenancyModuleOptions = {
      tenantExtractor: 'X-Tenant-Id',
    };
    const isolationOptions: IsolationTestOptions = {
      tenantIdField: 'tenant_id',
    };

    expect([
      moduleOptions,
      optionsFactory.createTenancyOptions(),
      asyncOptions.useFactory?.(),
      subdomainOptions,
      jwtClaimOptions,
      pathOptions,
      prismaOptions,
      transactionOptions,
      transactionClient,
      httpPropagationOptions,
      bullPropagationOptions,
      kafkaPropagationOptions,
      grpcPropagationOptions,
      propagator.getHeaders(),
      carrier.inject({}),
      carrier.extract({ tenantId: 'tenant-a' }),
      kafkaMessage,
      grpcMetadata.get('x-tenant-id'),
      eventMap[TenancyEvents.RESOLVED],
      request,
      response.status?.(204),
      interceptorOptions,
      missingOptions,
      missingDiagnostic,
      invalidDiagnostic,
      resourceKeyOptions,
      searchScope,
      searchOptions,
      searchAdapter,
      testingModuleOptions,
      isolationOptions,
    ]).toEqual([
      moduleOptions,
      moduleOptions,
      moduleOptions,
      subdomainOptions,
      jwtClaimOptions,
      pathOptions,
      prismaOptions,
      transactionOptions,
      transactionClient,
      httpPropagationOptions,
      bullPropagationOptions,
      kafkaPropagationOptions,
      grpcPropagationOptions,
      { 'X-Tenant-Id': 'tenant-a' },
      { tenantId: 'tenant-a' },
      'tenant-a',
      kafkaMessage,
      ['tenant-a'],
      resolvedEvent,
      request,
      response,
      interceptorOptions,
      missingOptions,
      missingDiagnostic,
      invalidDiagnostic,
      resourceKeyOptions,
      searchScope,
      searchOptions,
      searchAdapter,
      testingModuleOptions,
      isolationOptions,
    ]);
  });
});
