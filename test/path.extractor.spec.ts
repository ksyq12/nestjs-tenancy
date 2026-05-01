import { PathTenantExtractor } from '../src/extractors/path.extractor';

describe('PathTenantExtractor', () => {
  it('should extract param from matching path', () => {
    const extractor = new PathTenantExtractor({ pattern: '/api/tenants/:tenantId', paramName: 'tenantId' });
    const req = { path: '/api/tenants/abc-123' } as any;
    expect(extractor.extract(req)).toBe('abc-123');
  });

  it('should support prefix match (trailing segments)', () => {
    const extractor = new PathTenantExtractor({ pattern: '/api/tenants/:tenantId', paramName: 'tenantId' });
    const req = { path: '/api/tenants/abc-123/users/profile' } as any;
    expect(extractor.extract(req)).toBe('abc-123');
  });

  it('should ignore query string and hash fragments', () => {
    const extractor = new PathTenantExtractor({ pattern: '/api/tenants/:tenantId', paramName: 'tenantId' });
    const req = { path: '/api/tenants/abc-123?include=users#section' } as any;
    expect(extractor.extract(req)).toBe('abc-123');
  });

  it('should decode URL-encoded tenant segment', () => {
    const extractor = new PathTenantExtractor({ pattern: '/api/tenants/:tenantId', paramName: 'tenantId' });
    const req = { path: '/api/tenants/acme%20corp' } as any;
    expect(extractor.extract(req)).toBe('acme corp');
  });

  it('should return null for malformed URL encoding', () => {
    const extractor = new PathTenantExtractor({ pattern: '/api/tenants/:tenantId', paramName: 'tenantId' });
    const req = { path: '/api/tenants/%E0%A4%A' } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should return null when path has fewer segments than pattern', () => {
    const extractor = new PathTenantExtractor({ pattern: '/api/tenants/:tenantId', paramName: 'tenantId' });
    const req = { path: '/api/tenants' } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should return null when static segments do not match', () => {
    const extractor = new PathTenantExtractor({ pattern: '/api/tenants/:tenantId', paramName: 'tenantId' });
    const req = { path: '/api/users/abc-123' } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should handle param in middle of path', () => {
    const extractor = new PathTenantExtractor({ pattern: '/orgs/:orgId/projects', paramName: 'orgId' });
    const req = { path: '/orgs/my-org/projects' } as any;
    expect(extractor.extract(req)).toBe('my-org');
  });

  it('should throw at construction when paramName not found in pattern', () => {
    expect(() => new PathTenantExtractor({ pattern: '/api/:id', paramName: 'tenantId' }))
      .toThrow('":tenantId" not found in pattern "/api/:id"');
  });

  it('should return null when request.path is undefined', () => {
    const extractor = new PathTenantExtractor({ pattern: '/api/tenants/:tenantId', paramName: 'tenantId' });
    const req = { headers: {} } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should return null when request.path is empty string', () => {
    const extractor = new PathTenantExtractor({ pattern: '/api/tenants/:tenantId', paramName: 'tenantId' });
    const req = { path: '' } as any;
    expect(extractor.extract(req)).toBeNull();
  });
});
