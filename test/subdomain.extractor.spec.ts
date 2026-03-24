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
});
