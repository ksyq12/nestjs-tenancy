import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import type { Attributes, ContextAPI, Span, TraceAPI, Tracer } from '@opentelemetry/api';
import type { TenancyModuleOptions } from '../interfaces/tenancy-module-options.interface';
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
  private traceApi: TraceAPI | null = null;
  private contextApi: Pick<ContextAPI, 'active' | 'with'> | null = null;
  private tracer: Tracer | null = null;
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
      this.contextApi = api.context;
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
  startSpan(name: string, attributes?: Attributes): Span | null {
    if (!this.tracer || !this.createSpans) return null;
    return this.tracer.startSpan(name, { attributes });
  }

  /** Start a custom span with the configured tenant ID attribute attached. */
  startTenantSpan(name: string, tenantId: string): Span | null {
    return this.startSpan(name, { [this.spanAttributeKey]: tenantId });
  }

  /** Run a callback with a custom span set as the active OpenTelemetry span. */
  withSpan<T>(
    name: string,
    attributes: Attributes | undefined,
    callback: (span: Span | null) => T,
  ): T {
    const span = this.startSpan(name, attributes);
    const runCallback = () => callback(span);

    try {
      const result = span && this.traceApi && this.contextApi
        ? this.contextApi.with(
          this.traceApi.setSpan(this.contextApi.active(), span),
          runCallback,
        )
        : runCallback();

      return this.endSpanAfter(span, result);
    } catch (err) {
      this.endSpan(span);
      throw err;
    }
  }

  /** Run a callback with a tenant lifecycle span set as active. */
  withTenantSpan<T>(
    name: string,
    tenantId: string,
    callback: (span: Span | null) => T,
  ): T {
    return this.withSpan(name, { [this.spanAttributeKey]: tenantId }, callback);
  }

  /** Safely end a span (null-safe). */
  endSpan(span: Pick<Span, 'end'> | null): void {
    span?.end();
  }

  private endSpanAfter<T>(span: Pick<Span, 'end'> | null, result: T): T {
    if (
      result &&
      typeof result === 'object' &&
      typeof (result as unknown as Promise<unknown>).finally === 'function'
    ) {
      return (result as unknown as Promise<unknown>)
        .finally(() => this.endSpan(span)) as unknown as T;
    }

    this.endSpan(span);
    return result;
  }
}
