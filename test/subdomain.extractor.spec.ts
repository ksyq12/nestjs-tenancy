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
});
