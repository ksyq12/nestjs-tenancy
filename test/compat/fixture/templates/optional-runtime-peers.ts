import { CacheKey, CACHE_MANAGER, CacheModule } from '@nestjs/cache-manager';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { TenantCacheInterceptor } from '@nestarc/tenancy/cache';

class OptionalCacheTarget {
  @CacheKey('products')
  handle(): void {}
}

export function loadOptionalRuntime() {
  return {
    cacheHandler: OptionalCacheTarget.prototype.handle,
    cacheInterceptorToken: TenantCacheInterceptor,
    cacheToken: CACHE_MANAGER,
    eventEmitterToken: EventEmitter2,
    imports: [CacheModule.register(), EventEmitterModule.forRoot()],
    providers: [TenantCacheInterceptor],
  };
}
