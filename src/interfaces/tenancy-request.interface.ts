/**
 * Minimal HTTP request interface for @nestarc/tenancy public API.
 *
 * This is intentionally framework-agnostic. Express `Request`, Fastify
 * `FastifyRequest`, and Node.js `http.IncomingMessage` all satisfy this
 * interface. Use type assertion if you need platform-specific properties
 * (e.g., `request as import('express').Request`).
 */
export interface TenancyRequest {
  /** HTTP request headers. Keys are lowercase in Node.js. */
  headers: Record<string, string | string[] | undefined>;
  /** Hostname derived from the `Host` header. */
  hostname?: string;
  /** Request path without query string. */
  path?: string;
  /** Full request URL. */
  url?: string;
  /** Index signature allows platform-specific properties. */
  [key: string]: any;
}

/**
 * Minimal HTTP response interface for @nestarc/tenancy public API.
 *
 * Used only in `onTenantNotFound` callback. Framework-agnostic — both
 * Express `Response` and Fastify `FastifyReply` satisfy this interface.
 */
export interface TenancyResponse {
  [key: string]: any;
}
