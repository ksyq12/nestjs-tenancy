import { SubdomainTenantExtractor } from '../src/extractors/subdomain.extractor';

describe('SubdomainTenantExtractor', () => {
  it('should extract subdomain from hostname', () => {
    const extractor = new SubdomainTenantExtractor();
    const req = { hostname: 'tenant1.app.com' } as any;
    expect(extractor.extract(req)).toBe('tenant1');
  });

  it('should return null when no subdomain', () => {
    const extractor = new SubdomainTenantExtractor();
    const req = { hostname: 'app.com' } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should exclude www by default', () => {
    const extractor = new SubdomainTenantExtractor();
    const req = { hostname: 'www.app.com' } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should support custom exclude list', () => {
    const extractor = new SubdomainTenantExtractor({ excludeSubdomains: ['www', 'api'] });
    const req = { hostname: 'api.app.com' } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should extract from deep subdomain', () => {
    const extractor = new SubdomainTenantExtractor();
    const req = { hostname: 'tenant1.us-east.app.com' } as any;
    expect(extractor.extract(req)).toBe('tenant1');
  });

  it('should return null for localhost', () => {
    const extractor = new SubdomainTenantExtractor();
    const req = { hostname: 'localhost' } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should extract subdomain from ccTLD (co.uk)', () => {
    const extractor = new SubdomainTenantExtractor();
    const req = { hostname: 'tenant1.example.co.uk' } as any;
    expect(extractor.extract(req)).toBe('tenant1');
  });

  it('should return null for bare ccTLD domain', () => {
    const extractor = new SubdomainTenantExtractor();
    const req = { hostname: 'example.co.uk' } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should extract subdomain from co.jp', () => {
    const extractor = new SubdomainTenantExtractor();
    const req = { hostname: 'tenant1.example.co.jp' } as any;
    expect(extractor.extract(req)).toBe('tenant1');
  });

  it('should exclude www from ccTLD', () => {
    const extractor = new SubdomainTenantExtractor();
    const req = { hostname: 'www.example.co.uk' } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should return null for IP address', () => {
    const extractor = new SubdomainTenantExtractor();
    const req = { hostname: '192.168.1.1' } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should return null for bracketed IPv6 address', () => {
    const extractor = new SubdomainTenantExtractor();
    const req = { hostname: '[::1]' } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should return null for IPv6 address without brackets', () => {
    const extractor = new SubdomainTenantExtractor();
    const req = { hostname: '2001:db8::1' } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should handle com.au TLD', () => {
    const extractor = new SubdomainTenantExtractor();
    const req = { hostname: 'tenant1.example.com.au' } as any;
    expect(extractor.extract(req)).toBe('tenant1');
  });

  it('should extract subdomain from internal domain', () => {
    const extractor = new SubdomainTenantExtractor();
    const req = { hostname: 'tenant1.example.local' } as any;
    // Internal domains should work even if not in public suffix list
    expect(extractor.extract(req)).toBe('tenant1');
  });

  it('should return null when hostname is undefined', () => {
    const extractor = new SubdomainTenantExtractor();
    const req = {} as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should return null for bare TLD hostname', () => {
    const extractor = new SubdomainTenantExtractor();
    // A hostname that is just a TLD — psl.parse() returns error for this
    const req = { hostname: 'com' } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should return null for empty string hostname', () => {
    const extractor = new SubdomainTenantExtractor();
    const req = { hostname: '' } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should handle single-label internal hostname', () => {
    const extractor = new SubdomainTenantExtractor();
    // Single label like 'myserver' — no subdomain possible
    const req = { hostname: 'myserver' } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should handle two-label internal hostname', () => {
    const extractor = new SubdomainTenantExtractor();
    // Two labels like 'host.internal' — not enough for subdomain with 3-label requirement
    const req = { hostname: 'host.internal' } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should return null when psl.parse returns an error', () => {
    const extractor = new SubdomainTenantExtractor();
    // Hostname starting with a dash is truthy but psl.parse returns { error: ... }
    const req = { hostname: '--invalid' } as any;
    expect(extractor.extract(req)).toBeNull();
  });
});
