import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

type TenantStore =
  | { tenantId: string; bypassed: false }
  | { tenantId: null; bypassed: false }
  | { tenantId: null; bypassed: true };

const storage = new AsyncLocalStorage<TenantStore>();

/**
 * Runs an inbound boundary without inheriting an ambient tenant or explicit bypass.
 *
 * @internal This is package infrastructure, not part of the public root export.
 */
export function runInEmptyTenancyContext<T>(callback: () => Promise<T>): Promise<T>;
export function runInEmptyTenancyContext<T>(callback: () => T): T;
export function runInEmptyTenancyContext<T>(callback: () => T | Promise<T>): T | Promise<T> {
  return storage.run({ tenantId: null, bypassed: false }, callback);
}

@Injectable()
export class TenancyContext {
  static getCurrentTenantId(): string | null {
    return storage.getStore()?.tenantId ?? null;
  }

  run<T>(tenantId: string, callback: () => Promise<T>): Promise<T>;
  run<T>(tenantId: string, callback: () => T): T;
  run<T>(tenantId: string, callback: () => T | Promise<T>): T | Promise<T> {
    return storage.run({ tenantId, bypassed: false }, callback);
  }

  getTenantId(): string | null {
    return TenancyContext.getCurrentTenantId();
  }

  isBypassed(): boolean {
    return storage.getStore()?.bypassed ?? false;
  }

  runWithoutTenant<T>(callback: () => Promise<T>): Promise<T>;
  runWithoutTenant<T>(callback: () => T): T;
  runWithoutTenant<T>(callback: () => T | Promise<T>): T | Promise<T> {
    return storage.run({ tenantId: null, bypassed: true }, callback);
  }
}
