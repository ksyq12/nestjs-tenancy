import 'reflect-metadata';
import {
  Controller,
  ExecutionContext,
  Get,
  INestApplication,
  UseInterceptors,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CacheKey, CacheModule, CacheTTL } from '@nestjs/cache-manager';
import { Test } from '@nestjs/testing';
import { createHash } from 'crypto';
import request from 'supertest';
import {
  TENANT_CACHE_INTERCEPTOR_OPTIONS,
  TenantCacheInterceptor,
  TenantCacheInterceptorOptions,
} from '../src/cache';
import { BypassTenancy } from '../src/decorators/bypass-tenancy.decorator';
import { SharedTenantCache } from '../src/decorators/shared-tenant-cache.decorator';
import { HeaderTenantExtractor } from '../src/extractors/header.extractor';
import { TenancyContext } from '../src/services/tenancy-context';
import { TenancyModule } from '../src/tenancy.module';
import { SHARED_TENANT_CACHE_KEY } from '../src/tenancy.constants';
import { TenantContextDiagnostics } from '../src/diagnostics/tenant-context-diagnostics';

type BaseCacheKey =
  | Promise<string | undefined | null>
  | string
  | undefined
  | null;

type TrackByCapable = {
  trackBy(context: ExecutionContext): BaseCacheKey;
};

class TestTenantCacheInterceptor extends TenantCacheInterceptor {
  constructor(
    reflector: Reflector,
    private readonly baseKey: BaseCacheKey,
    options?: TenantCacheInterceptorOptions,
  ) {
    const cacheManager = {
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      reset: jest.fn(),
      wrap: jest.fn(),
    };

    super(cacheManager, reflector, options);
  }

  protected getBaseCacheKey(_context: ExecutionContext): BaseCacheKey {
    return this.baseKey;
  }

  track(context: ExecutionContext): Promise<string | undefined> | string | undefined {
    return this.trackBy(context);
  }
}

function createExecutionContext(
  handler: Function = function handler() {},
  controller: Function = class Controller {},
): ExecutionContext {
  return {
    getType: () => 'http',
    getClass: () => controller,
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

describe('TenantCacheInterceptor', () => {
  let reflector: Reflector;
  let tenancyContext: TenancyContext;

  beforeEach(() => {
    reflector = new Reflector();
    tenancyContext = new TenancyContext();
  });

  afterEach(() => {
    tenancyContext.runWithoutTenant(() => {
      expect(tenancyContext.getTenantId()).toBeNull();
    });
    expect(TenancyContext.getCurrentTenantId()).toBeNull();
  });

  it('should prefix base cache key with current tenant', async () => {
    const interceptor = new TestTenantCacheInterceptor(reflector, 'GET:/products');
    const execCtx = createExecutionContext();

    const result = await tenancyContext.run('tenant-a', () =>
      interceptor.track(execCtx),
    );

    expect(result).toBe('tenant:8:tenant-a:GET:/products');
  });

  it('should preserve unsafe tenant ID characters with an unambiguous length prefix', async () => {
    const interceptor = new TestTenantCacheInterceptor(reflector, 'GET:/products');
    const execCtx = createExecutionContext();
    const tenantId = 'tenant a/b?c=d:e';

    const result = await tenancyContext.run(tenantId, () =>
      interceptor.track(execCtx),
    );

    expect(result).toBe(`tenant:${tenantId.length}:${tenantId}:GET:/products`);
  });

  it('should serialize tenant IDs without separator-based key collisions', async () => {
    const firstInterceptor = new TestTenantCacheInterceptor(
      reflector,
      '/products?x=b:/products?x=c',
    );
    const secondInterceptor = new TestTenantCacheInterceptor(
      reflector,
      '/products?x=c',
    );
    const execCtx = createExecutionContext();

    const firstKey = await tenancyContext.run('a', () =>
      firstInterceptor.track(execCtx),
    );
    const secondKey = await tenancyContext.run('a:/products?x=b', () =>
      secondInterceptor.track(execCtx),
    );

    expect(firstKey).not.toBe(secondKey);
  });

  it('should support async base cache keys from CacheInterceptor.trackBy', async () => {
    const interceptor = new TestTenantCacheInterceptor(
      reflector,
      Promise.resolve('GET:/products'),
    );
    const execCtx = createExecutionContext();

    const result = await tenancyContext.run('tenant-a', () =>
      interceptor.track(execCtx),
    );

    expect(result).toBe('tenant:8:tenant-a:GET:/products');
  });

  it.each([undefined, null, ''])(
    'should return undefined when base cache key is %p',
    async (baseKey) => {
      const interceptor = new TestTenantCacheInterceptor(reflector, baseKey);
      const execCtx = createExecutionContext();

      const result = await tenancyContext.run('tenant-a', () =>
        interceptor.track(execCtx),
      );

      expect(result).toBeUndefined();
    },
  );

  it('should not cache missing tenant context unless route is shared', async () => {
    const interceptor = new TestTenantCacheInterceptor(reflector, 'GET:/products');
    const execCtx = createExecutionContext();

    await expect(interceptor.track(execCtx)).resolves.toBeUndefined();
  });

  it('should diagnose a missing tenant before disabling cache', async () => {
    const onMissing = jest.fn();
    const interceptor = new TestTenantCacheInterceptor(
      reflector,
      'GET:/products',
      {
        resource: 'response-cache',
        diagnostics: new TenantContextDiagnostics({ policy: 'warn', onMissing }),
      },
    );

    await expect(interceptor.track(createExecutionContext())).resolves.toBeUndefined();
    expect(onMissing).toHaveBeenCalledWith({
      transport: 'cache', operation: 'cache', resource: 'response-cache',
    });
  });

  it('should use shared prefix for handler-level shared cache metadata', async () => {
    function handler() {}
    Reflect.defineMetadata(SHARED_TENANT_CACHE_KEY, true, handler);
    const interceptor = new TestTenantCacheInterceptor(reflector, 'GET:/catalog');
    const execCtx = createExecutionContext(handler);

    await expect(interceptor.track(execCtx)).resolves.toBe('shared:GET:/catalog');
  });

  it('should use shared prefix for class-level shared cache metadata', async () => {
    class CatalogController {}
    Reflect.defineMetadata(SHARED_TENANT_CACHE_KEY, true, CatalogController);
    const interceptor = new TestTenantCacheInterceptor(reflector, 'GET:/catalog');
    const execCtx = createExecutionContext(function handler() {}, CatalogController);

    await expect(interceptor.track(execCtx)).resolves.toBe('shared:GET:/catalog');
  });

  it('should let shared metadata win over tenant context', async () => {
    function handler() {}
    Reflect.defineMetadata(SHARED_TENANT_CACHE_KEY, true, handler);
    const interceptor = new TestTenantCacheInterceptor(reflector, 'GET:/catalog');
    const execCtx = createExecutionContext(handler);

    const result = await tenancyContext.run('tenant-a', () =>
      interceptor.track(execCtx),
    );

    expect(result).toBe('shared:GET:/catalog');
  });

  it('should support custom prefixes and separator', async () => {
    const interceptor = new TestTenantCacheInterceptor(reflector, 'GET:/products', {
      tenantPrefix: 'org',
      sharedPrefix: 'global',
      separator: '|',
    });
    const execCtx = createExecutionContext();

    const result = await tenancyContext.run('tenant-a', () =>
      interceptor.track(execCtx),
    );

    expect(result).toBe('org|8:tenant-a|GET:/products');
  });

  it('should support custom shared prefix and separator', async () => {
    function handler() {}
    Reflect.defineMetadata(SHARED_TENANT_CACHE_KEY, true, handler);
    const interceptor = new TestTenantCacheInterceptor(reflector, 'GET:/catalog', {
      tenantPrefix: 'org',
      sharedPrefix: 'global',
      separator: '|',
    });
    const execCtx = createExecutionContext(handler);

    await expect(interceptor.track(execCtx)).resolves.toBe('global|GET:/catalog');
  });

  it('should hash tenant ID when hashTenantId is true', async () => {
    const tenantId = 'tenant a/b?c=d:e';
    const hashedTenantId = createHash('sha256').update(tenantId).digest('hex');
    const interceptor = new TestTenantCacheInterceptor(reflector, 'GET:/products', {
      hashTenantId: true,
    });
    const execCtx = createExecutionContext();

    const result = await tenancyContext.run(tenantId, () =>
      interceptor.track(execCtx),
    );

    expect(result).toBe(`tenant:${hashedTenantId}:GET:/products`);
    expect(result).not.toContain(tenantId);
  });

  it('should resolve from Nest dependency injection without an options provider', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [CacheModule.register()],
      providers: [TenantCacheInterceptor],
    }).compile();

    try {
      expect(moduleRef.get(TenantCacheInterceptor)).toBeInstanceOf(
        TenantCacheInterceptor,
      );
    } finally {
      await moduleRef.close();
    }
  });

  it('should apply injected options when resolving from Nest dependency injection', async () => {
    class ProductsController {
      @CacheKey('products')
      findAll() {}
    }

    const moduleRef = await Test.createTestingModule({
      imports: [CacheModule.register()],
      providers: [
        TenantCacheInterceptor,
        {
          provide: TENANT_CACHE_INTERCEPTOR_OPTIONS,
          useValue: {
            tenantPrefix: 'org',
            sharedPrefix: 'global',
            separator: '|',
          } satisfies TenantCacheInterceptorOptions,
        },
      ],
    }).compile();

    try {
      const interceptor = moduleRef.get(TenantCacheInterceptor);
      const execCtx = createExecutionContext(
        ProductsController.prototype.findAll,
        ProductsController,
      );

      const result = await tenancyContext.run('tenant-a', () =>
        (interceptor as unknown as TrackByCapable).trackBy(execCtx),
      );

      expect(result).toBe('org|8:tenant-a|products');
    } finally {
      await moduleRef.close();
    }
  });

  it('should use the module-level missing-context policy through dependency injection', async () => {
    class ProductsController {
      @CacheKey('products')
      findAll() {}
    }

    const moduleRef = await Test.createTestingModule({
      imports: [
        CacheModule.register(),
        TenancyModule.forRoot({
          tenantExtractor: 'x-tenant-id',
          missingContext: { policy: 'throw' },
        }),
      ],
      providers: [TenantCacheInterceptor],
    }).compile();

    try {
      const interceptor = moduleRef.get(TenantCacheInterceptor);
      const execCtx = createExecutionContext(
        ProductsController.prototype.findAll,
        ProductsController,
      );
      await expect(
        (interceptor as unknown as TrackByCapable).trackBy(execCtx),
      ).rejects.toThrow('Tenant context is missing during cache.cache');
    } finally {
      await moduleRef.close();
    }
  });
});

describe('TenantCacheInterceptor integration', () => {
  let app: INestApplication;
  let appUrl: string;
  let tenantHitCount = 0;
  let sharedHitCount = 0;
  let publicHitCount = 0;

  @Controller()
  class TestController {
    @UseInterceptors(TenantCacheInterceptor)
    @CacheKey('products')
    @CacheTTL(60)
    @Get('/products')
    products() {
      tenantHitCount += 1;
      return { hit: tenantHitCount };
    }

    @UseInterceptors(TenantCacheInterceptor)
    @BypassTenancy()
    @SharedTenantCache()
    @CacheKey('catalog')
    @CacheTTL(60)
    @Get('/catalog')
    catalog() {
      sharedHitCount += 1;
      return { hit: sharedHitCount };
    }

    @UseInterceptors(TenantCacheInterceptor)
    @BypassTenancy()
    @CacheKey('public')
    @CacheTTL(60)
    @Get('/public')
    publicRoute() {
      publicHitCount += 1;
      return { hit: publicHitCount };
    }
  }

  beforeEach(async () => {
    tenantHitCount = 0;
    sharedHitCount = 0;
    publicHitCount = 0;

    const moduleRef = await Test.createTestingModule({
      imports: [
        CacheModule.register(),
        TenancyModule.forRoot({
          tenantExtractor: new HeaderTenantExtractor('x-tenant-id'),
          validateTenantId: (id) => id.length > 0,
        }),
      ],
      controllers: [TestController],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.listen(0, '127.0.0.1');
    appUrl = await app.getUrl();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it('should cache same route separately per tenant', async () => {
    await request(appUrl)
      .get('/products')
      .set('x-tenant-id', 'tenant-a')
      .expect(200, { hit: 1 });
    await request(appUrl)
      .get('/products')
      .set('x-tenant-id', 'tenant-a')
      .expect(200, { hit: 1 });
    await request(appUrl)
      .get('/products')
      .set('x-tenant-id', 'tenant-b')
      .expect(200, { hit: 2 });
    await request(appUrl)
      .get('/products')
      .set('x-tenant-id', 'tenant-b')
      .expect(200, { hit: 2 });
  });

  it('should reuse shared cache across tenant contexts and no-tenant request', async () => {
    await request(appUrl)
      .get('/catalog')
      .set('x-tenant-id', 'tenant-a')
      .expect(200, { hit: 1 });
    await request(appUrl)
      .get('/catalog')
      .set('x-tenant-id', 'tenant-b')
      .expect(200, { hit: 1 });
    await request(appUrl).get('/catalog').expect(200, { hit: 1 });
  });

  it('should not cache public route without tenant when route is not shared', async () => {
    await request(appUrl).get('/public').expect(200, { hit: 1 });
    await request(appUrl).get('/public').expect(200, { hit: 2 });
  });
});
