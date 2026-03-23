import { Injectable } from '@nestjs/common';
import { TenancyContext } from './tenancy-context';

@Injectable()
export class TenancyService {
  constructor(private readonly context: TenancyContext) {}

  getCurrentTenant(): string | null {
    return this.context.getTenantId();
  }

  getCurrentTenantOrThrow(): string {
    const tenantId = this.context.getTenantId();
    if (!tenantId) {
      throw new Error('No tenant context available');
    }
    return tenantId;
  }
}
