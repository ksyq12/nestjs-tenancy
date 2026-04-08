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
  /**
   * Called after a tenant ID is successfully extracted and validated.
   * Runs inside `TenancyContext.run()`, so `getCurrentTenant()` is available.
   *
   * Throwing an exception aborts the request — NestJS handles it as a 500
   * (or whatever your exception filter maps it to). The telemetry span is
   * always closed via `finally`, so throwing is safe for audit/authorization checks.
   */
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
   * Cross-check configuration for tenant ID forgery prevention.
   *
   * Compares the primary extractor result with a secondary source.
   * Common pattern: primary = header, cross-check = JWT claim.
   *
   * If the cross-check extractor returns null (e.g., no JWT present),
   * validation is skipped — allowing unauthenticated endpoints to work normally.
   * Set `required: true` to reject requests when the cross-check extractor
   * returns null, enforcing that every request must have a verifiable secondary source.
   */
  crossCheck?: {
    /** Secondary extractor to validate the tenant ID against. */
    extractor: TenantExtractor;
    /**
     * Behavior on mismatch.
     * - `'reject'` (default): throws ForbiddenException
     * - `'log'`: logs a warning and continues with the primary extractor's value
     */
    onFailed?: 'reject' | 'log';
    /**
     * When true, the cross-check extractor must return a non-null value.
     * Throws ForbiddenException if the extractor returns null.
     * Use this for endpoints that require authenticated cross-validation.
     * @default false
     */
    required?: boolean;
  };

  /** @deprecated Use `crossCheck: { extractor }` instead. Will be removed in v2.0. */
  crossCheckExtractor?: TenantExtractor;

  /** @deprecated Use `crossCheck: { onFailed }` instead. Will be removed in v2.0. */
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
