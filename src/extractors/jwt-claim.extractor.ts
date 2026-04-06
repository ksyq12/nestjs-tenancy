import { TenancyRequest } from '../interfaces/tenancy-request.interface';
import { TenantExtractor } from '../interfaces/tenant-extractor.interface';

export interface JwtClaimExtractorOptions {
  claimKey: string;
  headerName?: string;
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

    if (!headerValue.startsWith('Bearer ')) return null;
    const token = headerValue.slice(7);

    const parts = token.split('.');
    if (parts.length !== 3) return null;

    try {
      const payload = JSON.parse(
        Buffer.from(parts[1], 'base64url').toString('utf-8'),
      );
      const value = payload[this.claimKey];
      if (value == null) return null;
      return String(value);
    } catch {
      return null;
    }
  }
}
