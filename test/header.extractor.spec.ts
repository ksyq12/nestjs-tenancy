import { HeaderTenantExtractor } from '../src/extractors/header.extractor';

describe('HeaderTenantExtractor', () => {
  it('should extract tenant ID from specified header', () => {
    const extractor = new HeaderTenantExtractor('x-tenant-id');
    const req = { headers: { 'x-tenant-id': 'tenant-abc' } } as any;
    expect(extractor.extract(req)).toBe('tenant-abc');
  });

  it('should return null when header is missing', () => {
    const extractor = new HeaderTenantExtractor('x-tenant-id');
    const req = { headers: {} } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should be case-insensitive (Express lowercases headers)', () => {
    const extractor = new HeaderTenantExtractor('X-Tenant-ID');
    const req = { headers: { 'x-tenant-id': 'tenant-abc' } } as any;
    expect(extractor.extract(req)).toBe('tenant-abc');
  });

  it('should return first value if header is an array', () => {
    const extractor = new HeaderTenantExtractor('x-tenant-id');
    const req = { headers: { 'x-tenant-id': ['first', 'second'] } } as any;
    expect(extractor.extract(req)).toBe('first');
  });
});
