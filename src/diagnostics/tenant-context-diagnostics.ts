import { Logger } from '@nestjs/common';
import { TenantContextMissingError } from '../errors/tenant-context-missing.error';
import type { TenancyEventService } from '../events/tenancy-event.service';
import { TenancyEvents } from '../events/tenancy-events';
import type { TenancyTelemetryService } from '../telemetry/tenancy-telemetry.service';

export type MissingTenantContextPolicy = 'ignore' | 'warn' | 'throw';

export type TenantContextDiagnosticOperation =
  | 'inject'
  | 'extract'
  | 'consume'
  | 'cache'
  | 'key'
  | 'search';

export interface MissingTenantContextDiagnostic {
  transport: 'bull' | 'kafka' | 'grpc' | 'cache' | 'redis' | 'search';
  operation: TenantContextDiagnosticOperation;
  resource?: string;
}

/**
 * Low-cardinality metadata for an inbound tenant ID rejected by an explicit
 * RPC validator. The interceptor does not copy the rejected value here;
 * callers must keep `resource` stable and non-sensitive.
 */
export interface InvalidTenantContextDiagnostic {
  transport: 'bull' | 'kafka' | 'grpc';
  operation: 'consume';
  resource?: string;
}

type TenantContextTelemetryReporter =
  Pick<TenancyTelemetryService, 'recordMissingContext'> &
  Partial<Pick<TenancyTelemetryService, 'recordInvalidContext'>>;

export interface TenantContextDiagnosticsOptions {
  /** Existing silent/pass-through behavior remains the default. */
  policy?: MissingTenantContextPolicy;
  /** Optional hook for structured logging or application metrics. */
  onMissing?: (diagnostic: MissingTenantContextDiagnostic) => void;
}

/**
 * Reports missing or invalid tenant context across non-HTTP transports and resources.
 *
 * `ignore` preserves the pre-diagnostics behavior. `warn` reports and continues,
 * while `throw` reports and then raises `TenantContextMissingError`. That policy
 * applies only to missing context; invalid-ID reporting is observational because
 * the interceptor always rejects a validator result of `false`.
 */
export class TenantContextDiagnostics {
  private readonly logger = new Logger(TenantContextDiagnostics.name);
  readonly policy: MissingTenantContextPolicy;

  constructor(
    options: TenantContextDiagnosticsOptions = {},
    private readonly eventService?: Pick<TenancyEventService, 'emit'>,
    private readonly telemetryService?: TenantContextTelemetryReporter,
  ) {
    this.policy = options.policy ?? 'ignore';
    this.onMissing = options.onMissing;
  }

  private readonly onMissing?: (diagnostic: MissingTenantContextDiagnostic) => void;

  report(diagnostic: MissingTenantContextDiagnostic): void {
    if (this.policy === 'ignore') return;

    this.invokeReporter(
      'Missing-context event reporter failed',
      () => this.eventService?.emit(TenancyEvents.CONTEXT_MISSING, diagnostic),
    );
    this.invokeReporter(
      'Missing-context telemetry reporter failed',
      () => this.telemetryService?.recordMissingContext(diagnostic),
    );
    this.invokeHook(diagnostic);

    const message = this.formatMessage(diagnostic);
    if (this.policy === 'warn') {
      this.logger.warn(message);
      return;
    }

    throw new TenantContextMissingError(message);
  }

  /**
   * Records a rejected inbound tenant ID without exposing the rejected value.
   * Validation rejection is independent of the missing-context policy; the
   * interceptor remains responsible for failing the message.
   */
  reportInvalid(diagnostic: InvalidTenantContextDiagnostic): void {
    this.invokeReporter(
      'Invalid-context event reporter failed',
      () => this.eventService?.emit(TenancyEvents.CONTEXT_INVALID, diagnostic),
    );
    this.invokeReporter(
      'Invalid-context telemetry reporter failed',
      () => this.telemetryService?.recordInvalidContext?.(diagnostic),
    );
  }

  private invokeHook(diagnostic: MissingTenantContextDiagnostic): void {
    this.invokeReporter(
      'Missing-context diagnostic hook failed',
      () => this.onMissing?.(diagnostic),
    );
  }

  private invokeReporter(message: string, reporter: () => void): void {
    try {
      reporter();
    } catch (error) {
      this.logger.error(
        message,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private formatMessage(diagnostic: MissingTenantContextDiagnostic): string {
    const resource = diagnostic.resource
      ? ` for resource "${diagnostic.resource}"`
      : '';
    return `Tenant context is missing during ${diagnostic.transport}.${diagnostic.operation}${resource}`;
  }
}
