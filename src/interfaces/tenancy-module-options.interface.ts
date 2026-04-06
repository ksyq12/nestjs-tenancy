import { Type } from '@nestjs/common';
import { ModuleMetadata } from '@nestjs/common/interfaces';
import { TenancyRequest, TenancyResponse } from './tenancy-request.interface';
import { TenantExtractor } from './tenant-extractor.interface';

export interface TelemetryOptions {
  /** Span attribute key for tenant ID. @default 'tenant.id' */
  spanAttributeKey?: string;
  /** Create custom spans for tenant lifecycle events (resolved, not_found, etc.). @default false */
  createSpans?: boolean;
}

export interface TenancyModuleOptions {
  tenantExtractor: string | TenantExtractor;
  dbSettingKey?: string;
  validateTenantId?: (tenantId: string) => boolean | Promise<boolean>;
  onTenantResolved?: (tenantId: string, request: TenancyRequest) => void | Promise<void>;

  /**
   * Called when no tenant ID could be extracted from the request.
   *
   * Behavior based on return value:
   * - `void` / `undefined`: request continues to the next middleware (observation-only hook)
   * - `'skip'`: request continues but `next()` is NOT called — you must have already
   *   sent a response (e.g., via injected `TenancyResponse`) or thrown an exception
   *
   * Throwing an exception (e.g., `throw new ForbiddenException()`) always aborts
   * the request regardless of return value.
   */
  onTenantNotFound?: (request: TenancyRequest, response: TenancyResponse) => void | 'skip' | Promise<void | 'skip'>;

  /**
   * Secondary extractor for cross-checking the tenant ID against another source.
   * Prevents tenant ID forgery by comparing the primary extractor result with this one.
   *
   * Common pattern: primary = header, crossCheck = JWT claim.
   * If both return a value and they differ, the request is rejected or logged
   * based on `onCrossCheckFailed`.
   *
   * If the cross-check extractor returns null (e.g., no JWT present),
   * validation is skipped — allowing unauthenticated endpoints to work normally.
   */
  crossCheckExtractor?: TenantExtractor;

  /**
   * Behavior when `crossCheckExtractor` detects a mismatch.
   * - `'reject'` (default): throws ForbiddenException
   * - `'log'`: logs a warning and continues with the primary extractor's value
   */
  onCrossCheckFailed?: 'reject' | 'log';

  /**
   * OpenTelemetry integration. Automatically adds tenant.id to active spans.
   * Silently ignored if `@opentelemetry/api` is not installed.
   */
  telemetry?: TelemetryOptions;
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
