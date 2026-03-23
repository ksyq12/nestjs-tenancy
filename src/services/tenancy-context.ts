import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

interface TenantStore {
  tenantId: string;
}

@Injectable()
export class TenancyContext {
  private static readonly storage = new AsyncLocalStorage<TenantStore>();

  run<T>(tenantId: string, callback: () => T): T {
    return TenancyContext.storage.run({ tenantId }, callback);
  }

  getTenantId(): string | null {
    return TenancyContext.storage.getStore()?.tenantId ?? null;
  }
}
