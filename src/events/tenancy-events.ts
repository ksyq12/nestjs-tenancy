import { TenancyRequest } from '../interfaces/tenancy-request.interface';

export interface TenancyEventRequestSummary {
  method?: string;
  path?: string;
  ip?: string;
  userAgent?: string;
  host?: string;
}

export const TenancyEvents = {
  RESOLVED: 'tenant.resolved',
  NOT_FOUND: 'tenant.not_found',
  VALIDATION_FAILED: 'tenant.validation_failed',
  CONTEXT_BYPASSED: 'tenant.context_bypassed',
  CROSS_CHECK_FAILED: 'tenant.cross_check_failed',
} as const;

interface TenancyEventRequestPayload {
  requestSummary?: TenancyEventRequestSummary;
  /**
   * @deprecated Use `requestSummary` instead. Raw request objects may contain
   * credentials, cookies, body data, and framework-specific references.
   */
  request?: TenancyRequest;
}

export interface TenantResolvedEvent extends TenancyEventRequestPayload {
  tenantId: string;
}

export type TenantNotFoundEvent = TenancyEventRequestPayload;

export interface TenantValidationFailedEvent extends TenancyEventRequestPayload {
  tenantId: string;
}

export interface TenantContextBypassedEvent {
  reason: 'decorator' | 'withoutTenant';
  requestSummary?: TenancyEventRequestSummary;
}

export interface TenantCrossCheckFailedEvent extends TenancyEventRequestPayload {
  extractedTenantId: string;
  crossCheckTenantId: string;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function pathWithoutQuery(url: string | undefined): string | undefined {
  return url?.split('?')[0];
}

export function summarizeTenancyRequest(request: TenancyRequest): TenancyEventRequestSummary {
  const headers = request.headers ?? {};
  const socket = request.socket as { remoteAddress?: unknown } | undefined;
  const method = stringValue(request.method);
  const path = stringValue(request.path) ?? pathWithoutQuery(stringValue(request.url));
  const ip = stringValue(request.ip) ?? stringValue(socket?.remoteAddress);
  const userAgent = firstHeaderValue(headers['user-agent']);
  const host = firstHeaderValue(headers.host);

  return {
    ...(method ? { method } : {}),
    ...(path ? { path } : {}),
    ...(ip ? { ip } : {}),
    ...(userAgent ? { userAgent } : {}),
    ...(host ? { host } : {}),
  };
}

/**
 * Type-safe mapping from event name to payload type.
 * Used by `TenancyEventService.emit()` to enforce correct payloads at compile time.
 */
export interface TenancyEventMap {
  [TenancyEvents.RESOLVED]: TenantResolvedEvent;
  [TenancyEvents.NOT_FOUND]: TenantNotFoundEvent;
  [TenancyEvents.VALIDATION_FAILED]: TenantValidationFailedEvent;
  [TenancyEvents.CONTEXT_BYPASSED]: TenantContextBypassedEvent;
  [TenancyEvents.CROSS_CHECK_FAILED]: TenantCrossCheckFailedEvent;
}
