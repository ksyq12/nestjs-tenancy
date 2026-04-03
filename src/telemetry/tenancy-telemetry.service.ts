import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { TenancyModuleOptions } from '../interfaces/tenancy-module-options.interface';
import { TENANCY_MODULE_OPTIONS } from '../tenancy.constants';

/**
 * Optional OpenTelemetry integration service.
 *
 * If `@opentelemetry/api` is installed, automatically adds the tenant ID
 * as a span attribute to the current active span. Optionally creates
 * custom spans for tenant lifecycle events.
 *
 * If `@opentelemetry/api` is not installed, all methods are silently no-ops.
 * Follows the same graceful degradation pattern as `TenancyEventService`.
 */
@Injectable()
export class TenancyTelemetryService implements OnModuleInit {
  private traceApi: { getActiveSpan(): any; getTracer(name: string): any } | null = null;
  private tracer: { startSpan(name: string, options?: Record<string, unknown>): any } | null = null;
  private readonly spanAttributeKey: string;
  private readonly createSpans: boolean;

  constructor(
    @Inject(TENANCY_MODULE_OPTIONS)
    options: TenancyModuleOptions,
  ) {
    this.spanAttributeKey = options.telemetry?.spanAttributeKey ?? 'tenant.id';
    this.createSpans = options.telemetry?.createSpans ?? false;
  }

  async onModuleInit(): Promise<void> {
    try {
      const api = await import('@opentelemetry/api');
      this.traceApi = api.trace;
      this.tracer = api.trace.getTracer('@nestarc/tenancy');
    } catch {
      // @opentelemetry/api not installed — telemetry silently skipped
    }
  }

  /** Add tenant.id attribute to the current active span. */
  setTenantAttribute(tenantId: string): void {
    if (!this.traceApi) return;
    const span = this.traceApi.getActiveSpan();
    span?.setAttribute(this.spanAttributeKey, tenantId);
  }

  /** Start a custom span (only when createSpans is true). Returns null if disabled or OTel unavailable. */
  startSpan(name: string, attributes?: Record<string, string>): { end(): void } | null {
    if (!this.tracer || !this.createSpans) return null;
    return this.tracer.startSpan(name, { attributes });
  }

  /** Safely end a span (null-safe). */
  endSpan(span: { end(): void } | null): void {
    span?.end();
  }
}
