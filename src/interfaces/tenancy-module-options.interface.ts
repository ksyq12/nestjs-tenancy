import { Type } from '@nestjs/common';
import { ModuleMetadata } from '@nestjs/common/interfaces';
import { Request, Response } from 'express';
import { TenantExtractor } from './tenant-extractor.interface';

export interface TenancyModuleOptions {
  tenantExtractor: string | TenantExtractor;
  dbSettingKey?: string;
  validateTenantId?: (tenantId: string) => boolean | Promise<boolean>;
  onTenantResolved?: (tenantId: string, request: Request) => void | Promise<void>;

  /**
   * Called when no tenant ID could be extracted from the request.
   *
   * Behavior based on return value:
   * - `void` / `undefined`: request continues to the next middleware (observation-only hook)
   * - `'skip'`: request continues but `next()` is NOT called — you must have already
   *   sent a response (e.g., via injected `Response`) or thrown an exception
   *
   * Throwing an exception (e.g., `throw new ForbiddenException()`) always aborts
   * the request regardless of return value.
   */
  onTenantNotFound?: (request: Request, response: Response) => void | 'skip' | Promise<void | 'skip'>;
}

export interface TenancyModuleOptionsFactory {
  createTenancyOptions():
    | TenancyModuleOptions
    | Promise<TenancyModuleOptions>;
}

export interface TenancyModuleAsyncOptions
  extends Pick<ModuleMetadata, 'imports'> {
  inject?: any[];
  useFactory?: (
    ...args: any[]
  ) => TenancyModuleOptions | Promise<TenancyModuleOptions>;
  useClass?: Type<TenancyModuleOptionsFactory>;
  useExisting?: Type<TenancyModuleOptionsFactory>;
}
