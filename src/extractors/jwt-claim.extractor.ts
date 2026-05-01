import { TenancyRequest } from '../interfaces/tenancy-request.interface';
import { TenantExtractor } from '../interfaces/tenant-extractor.interface';

export interface JwtClaimExtractorOptions {
  claimKey: string;
  headerName?: string;
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + '='.repeat(paddingLength);
  return Buffer.from(padded, 'base64').toString('utf-8');
}

function isTokenOutsideTimeWindow(payload: Record<string, unknown>): boolean {
  const now = Date.now();
  if (typeof payload.exp === 'number' && payload.exp * 1000 <= now) {
    return true;
  }
  if (typeof payload.nbf === 'number' && payload.nbf * 1000 > now) {
    return true;
  }
  return false;
}

/**
 * Extracts the tenant ID from a JWT claim in the Authorization header.
 *
 * **IMPORTANT: This extractor does NOT verify the JWT signature.**
 * It decodes the payload (Base64URL) without cryptographic validation.
 * You MUST ensure that JWT authentication (e.g., `@nestjs/passport` AuthGuard,
 * or an upstream auth middleware) has already validated the token before this
 * extractor runs. Using this extractor without prior JWT verification allows
 * attackers to forge tenant IDs via crafted tokens.
 */
export class JwtClaimTenantExtractor implements TenantExtractor {
  private readonly claimKey: string;
  private readonly headerName: string;

  constructor(options: JwtClaimExtractorOptions) {
    this.claimKey = options.claimKey;
    this.headerName = (options.headerName ?? 'authorization').toLowerCase();
  }

  extract(request: TenancyRequest): string | null {
    const headerValue = request.headers[this.headerName];
    if (!headerValue || Array.isArray(headerValue)) return null;

    const bearerMatch = headerValue.match(/^\s*Bearer\s+(.+?)\s*$/i);
    if (!bearerMatch) return null;
    const token = bearerMatch[1];

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    try {
      const payload = JSON.parse(decodeBase64Url(parts[1])) as Record<string, unknown>;
      if (isTokenOutsideTimeWindow(payload)) return null;
      const value = payload[this.claimKey];
      if (value == null) return null;
      return String(value);
    } catch {
      return null;
    }
  }
}
