import { JwtClaimTenantExtractor } from '../src/extractors/jwt-claim.extractor';

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.fake-signature`;
}

describe('JwtClaimTenantExtractor', () => {
  it('should extract claim from Bearer token', () => {
    const extractor = new JwtClaimTenantExtractor({ claimKey: 'tenant_id' });
    const token = makeJwt({ tenant_id: 'acme-corp', sub: 'user-1' });
    const req = { headers: { authorization: `Bearer ${token}` } } as any;
    expect(extractor.extract(req)).toBe('acme-corp');
  });

  it('should accept case-insensitive Bearer scheme with flexible whitespace', () => {
    const extractor = new JwtClaimTenantExtractor({ claimKey: 'tenant_id' });
    const token = makeJwt({ tenant_id: 'acme-corp' });
    const req = { headers: { authorization: `  bearer\t${token}  ` } } as any;
    expect(extractor.extract(req)).toBe('acme-corp');
  });

  it('should decode base64url payload without requiring Buffer base64url support', () => {
    const extractor = new JwtClaimTenantExtractor({ claimKey: 'tenant_id' });
    const token = makeJwt({ tenant_id: 'fallback-tenant' });
    const req = { headers: { authorization: `Bearer ${token}` } } as any;
    const originalFrom = Buffer.from;
    const fromSpy = jest.spyOn(Buffer, 'from').mockImplementation(
      (value: any, encoding?: BufferEncoding) => {
        if (encoding === 'base64url') {
          throw new Error('base64url unsupported');
        }
        return originalFrom(value, encoding);
      },
    );

    try {
      expect(extractor.extract(req)).toBe('fallback-tenant');
    } finally {
      fromSpy.mockRestore();
    }
  });

  it('should return null for expired tokens', () => {
    const extractor = new JwtClaimTenantExtractor({ claimKey: 'tenant_id' });
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const token = makeJwt({ tenant_id: 'expired', exp: 999 });
    const req = { headers: { authorization: `Bearer ${token}` } } as any;

    try {
      expect(extractor.extract(req)).toBeNull();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('should return null for tokens before nbf', () => {
    const extractor = new JwtClaimTenantExtractor({ claimKey: 'tenant_id' });
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const token = makeJwt({ tenant_id: 'too-early', nbf: 1001 });
    const req = { headers: { authorization: `Bearer ${token}` } } as any;

    try {
      expect(extractor.extract(req)).toBeNull();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('should return null when no authorization header', () => {
    const extractor = new JwtClaimTenantExtractor({ claimKey: 'tenant_id' });
    const req = { headers: {} } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should return null when no Bearer prefix', () => {
    const extractor = new JwtClaimTenantExtractor({ claimKey: 'tenant_id' });
    const req = { headers: { authorization: 'Basic abc123' } } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should return null when claim key missing from payload', () => {
    const extractor = new JwtClaimTenantExtractor({ claimKey: 'tenant_id' });
    const token = makeJwt({ sub: 'user-1' });
    const req = { headers: { authorization: `Bearer ${token}` } } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should return null for malformed JWT (not 3 parts)', () => {
    const extractor = new JwtClaimTenantExtractor({ claimKey: 'tenant_id' });
    const req = { headers: { authorization: 'Bearer not-a-jwt' } } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should return null for invalid base64url payload', () => {
    const extractor = new JwtClaimTenantExtractor({ claimKey: 'tenant_id' });
    const req = { headers: { authorization: 'Bearer header.!!!invalid!!!.sig' } } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should support custom header name', () => {
    const extractor = new JwtClaimTenantExtractor({ claimKey: 'org_id', headerName: 'x-auth-token' });
    const token = makeJwt({ org_id: 'org-42' });
    const req = { headers: { 'x-auth-token': `Bearer ${token}` } } as any;
    expect(extractor.extract(req)).toBe('org-42');
  });

  it('should convert non-string claim to string', () => {
    const extractor = new JwtClaimTenantExtractor({ claimKey: 'tenant_id' });
    const token = makeJwt({ tenant_id: 12345 });
    const req = { headers: { authorization: `Bearer ${token}` } } as any;
    expect(extractor.extract(req)).toBe('12345');
  });

  it('should return null when authorization header is an array', () => {
    const extractor = new JwtClaimTenantExtractor({ claimKey: 'tenant_id' });
    const token = makeJwt({ tenant_id: 'acme' });
    const req = { headers: { authorization: [`Bearer ${token}`, 'Bearer other'] } } as any;
    expect(extractor.extract(req)).toBeNull();
  });
});
