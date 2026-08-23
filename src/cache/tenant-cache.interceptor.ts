import { ExecutionContext, Inject, Injectable, Optional } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CACHE_MANAGER, CacheInterceptor } from '@nestjs/cache-manager';
import { createHash } from 'crypto';
import { SHARED_TENANT_CACHE_KEY } from '../tenancy.constants';
import { TenancyContext } from '../services/tenancy-context';
import { TENANT_CACHE_INTERCEPTOR_OPTIONS } from './tenant-cache.constants';
import { TenantCacheInterceptorOptions } from './tenant-cache-options.interface';
import { TenantContextDiagnostics } from '../diagnostics/tenant-context-diagnostics';

type BaseCacheKey = Promise<string | undefined | null> | string | undefined | null;

@Injectable()
export class TenantCacheInterceptor extends CacheInterceptor {
  private readonly tenantPrefix: string;
  private readonly sharedPrefix: string;
  private readonly separator: string;
  private readonly hashTenantId: boolean;
  private readonly diagnostics?: TenantContextDiagnostics;
  private readonly resource?: string;

  constructor(
    @Inject(CACHE_MANAGER)
    cacheManager: ConstructorParameters<typeof CacheInterceptor>[0],
    reflector: Reflector,
    @Optional()
    @Inject(TENANT_CACHE_INTERCEPTOR_OPTIONS)
    options?: TenantCacheInterceptorOptions,
    @Optional()
    diagnostics?: TenantContextDiagnostics,
  ) {
    super(cacheManager, reflector);
    this.tenantPrefix = options?.tenantPrefix ?? 'tenant';
    this.sharedPrefix = options?.sharedPrefix ?? 'shared';
    this.separator = options?.separator ?? ':';
    this.hashTenantId = options?.hashTenantId ?? false;
    this.diagnostics = options?.diagnostics ?? diagnostics;
    this.resource = options?.resource;
  }

  protected getBaseCacheKey(context: ExecutionContext): BaseCacheKey {
    return super.trackBy(context);
  }

  protected async trackBy(context: ExecutionContext): Promise<string | undefined> {
    const baseKey = await this.getBaseCacheKey(context);
    if (!baseKey) {
      return undefined;
    }

    if (this.isSharedCache(context)) {
      return this.joinKeyParts(this.sharedPrefix, baseKey);
    }

    const tenantId = TenancyContext.getCurrentTenantId();
    if (!tenantId) {
      this.diagnostics?.report({
        transport: 'cache',
        operation: 'cache',
        ...(this.resource ? { resource: this.resource } : {}),
      });
      return undefined;
    }

    return this.joinKeyParts(
      this.tenantPrefix,
      this.formatTenantId(tenantId),
      baseKey,
    );
  }

  private isSharedCache(context: ExecutionContext): boolean {
    return this.reflector.getAllAndOverride<boolean>(
      SHARED_TENANT_CACHE_KEY,
      [context.getHandler(), context.getClass()],
    ) === true;
  }

  private formatTenantId(tenantId: string): string {
    if (this.hashTenantId) {
      return createHash('sha256').update(tenantId).digest('hex');
    }

    return `${tenantId.length}:${tenantId}`;
  }

  private joinKeyParts(...parts: string[]): string {
    return parts.join(this.separator);
  }
}
