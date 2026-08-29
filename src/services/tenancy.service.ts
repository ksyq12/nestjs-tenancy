import { Inject, Injectable, Optional } from '@nestjs/common';
import { TenancyContext } from './tenancy-context';
import { TenancyEventService } from '../events/tenancy-event.service';
import { TenancyEvents } from '../events/tenancy-events';
import { TenantContextMissingError } from '../errors/tenant-context-missing.error';
import { TENANCY_RUNTIME_CONFIG } from '../tenancy.constants';
import {
  createTenancyRuntimeConfig,
  resolveRuntimeDbSettingKey,
  TenancyRuntimeConfig,
} from '../tenancy-runtime-config';

@Injectable()
export class TenancyService {
  private readonly runtimeConfig?: TenancyRuntimeConfig;

  constructor(
    private readonly context: TenancyContext,
    @Optional() @Inject(TenancyEventService) private readonly eventService?: TenancyEventService,
    /** @internal Canonical runtime configuration is supplied by TenancyModule. */
    @Optional() @Inject(TENANCY_RUNTIME_CONFIG) runtimeConfig?: TenancyRuntimeConfig,
  ) {
    this.runtimeConfig = runtimeConfig
      ? createTenancyRuntimeConfig(runtimeConfig)
      : undefined;
  }

  getDbSettingKey(): string {
    return resolveRuntimeDbSettingKey(this.runtimeConfig);
  }

  /** @internal Used by the package's Prisma integration entry points. */
  resolveDbSettingKey(explicitDbSettingKey?: string): string {
    return resolveRuntimeDbSettingKey(
      this.runtimeConfig,
      explicitDbSettingKey,
    );
  }

  getCurrentTenant(): string | null {
    return this.context.getTenantId();
  }

  getCurrentTenantOrThrow(): string {
    const tenantId = this.context.getTenantId();
    if (!tenantId) {
      throw new TenantContextMissingError();
    }
    return tenantId;
  }

  isTenantBypassed(): boolean {
    return this.context.isBypassed();
  }

  async withoutTenant<T>(callback: () => T | Promise<T>): Promise<T> {
    const previousTenantId = this.context.getTenantId();
    this.eventService?.emit(TenancyEvents.CONTEXT_BYPASSED, {
      reason: 'withoutTenant',
      ...(previousTenantId ? { previousTenantId } : {}),
    });
    return this.context.runWithoutTenant(callback);
  }
}
