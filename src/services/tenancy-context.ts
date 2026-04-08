import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

type TenantStore =
  | { tenantId: string; bypassed: false }
  | { tenantId: null; bypassed: true };

@Injectable()
export class TenancyContext {
  private static readonly storage = new AsyncLocalStorage<TenantStore>();

  run<T>(tenantId: string, callback: () => Promise<T>): Promise<T>;
  run<T>(tenantId: string, callback: () => T): T;
  run<T>(tenantId: string, callback: () => T | Promise<T>): T | Promise<T> {
    return TenancyContext.storage.run({ tenantId, bypassed: false }, callback);
  }

  getTenantId(): string | null {
    return TenancyContext.storage.getStore()?.tenantId ?? null;
  }

  isBypassed(): boolean {
    return TenancyContext.storage.getStore()?.bypassed ?? false;
  }

  runWithoutTenant<T>(callback: () => T | Promise<T>): Promise<T> {
    return Promise.resolve(
      TenancyContext.storage.run({ tenantId: null, bypassed: true }, () => callback()),
    );
  }
}
