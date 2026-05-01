import type { FactoryProvider, Type } from '@nestjs/common';
import type { ModuleMetadata } from '@nestjs/common/interfaces';
import { TenancyRequest, TenancyResponse } from './tenancy-request.interface';
import { TenantExtractor } from './tenant-extractor.interface';

export interface TelemetryOptions {
  /** Span attribute key for tenant ID. @default 'tenant.id' */
  spanAttributeKey?: string;
  /** Create custom spans for tenant lifecycle events (resolved, not_found, etc.). @default false */
  createSpans?: boolean;
}

export interface TenancyModuleOptions {
  /**
   * Tenant extraction strategy.
   *
   * A string is a shortcut for `HeaderTenantExtractor` and is interpreted as
   * the HTTP header name. Use a `TenantExtractor` instance for non-header
   * strategies such as subdomain, path, JWT claim, or composite extraction.
   *
   * @example
   * ```typescript
   * tenantExtractor: 'X-Tenant-Id'
   * tenantExtractor: new SubdomainTenantExtractor()
   * ```
   */
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
   * - `'skip'`: request continues but `next()` is NOT called.
   *   **Warning:** You must send a response (e.g., `response.status(403).end()`)
   *   or throw an exception before returning `'skip'`. Otherwise the HTTP request
   *   will hang indefinitely with no response sent to the client.
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

  /** @deprecated Since v0.10.0. Use `crossCheck: { extractor }` instead. Planned removal in v0.12.0. */
  crossCheckExtractor?: TenantExtractor;

  /** @deprecated Since v0.10.0. Use `crossCheck: { onFailed }` instead. Planned removal in v0.12.0. */
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
  inject?: FactoryProvider['inject'];
  useFactory?: (
    ...args: any[]
  ) => TenancyModuleOptions | Promise<TenancyModuleOptions>;
  useClass?: Type<TenancyModuleOptionsFactory>;
  useExisting?: Type<TenancyModuleOptionsFactory>;
}
