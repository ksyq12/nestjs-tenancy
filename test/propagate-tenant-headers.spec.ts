import { TenancyContext } from '../src/services/tenancy-context';
import { propagateTenantHeaders } from '../src/propagation/propagate-tenant-headers';

describe('propagateTenantHeaders', () => {
  let context: TenancyContext;

  beforeEach(() => {
    context = new TenancyContext();
  });

  it('should return tenant header when in tenant context', (done) => {
    context.run('tenant-abc', () => {
      expect(propagateTenantHeaders()).toEqual({ 'X-Tenant-Id': 'tenant-abc' });
      done();
    });
  });

  it('should return empty object when no tenant context', () => {
    expect(propagateTenantHeaders()).toEqual({});
  });

  it('should support custom header name', (done) => {
    context.run('tenant-xyz', () => {
      expect(propagateTenantHeaders('X-Custom')).toEqual({ 'X-Custom': 'tenant-xyz' });
      done();
    });
  });

  it('should return empty object inside withoutTenant()', () => {
    context.runWithoutTenant(() => {
      expect(propagateTenantHeaders()).toEqual({});
    });
  });

  it('should work with fetch-style spread', (done) => {
    context.run('tenant-123', () => {
      const headers = {
        'Content-Type': 'application/json',
        ...propagateTenantHeaders(),
      };
      expect(headers).toEqual({
        'Content-Type': 'application/json',
        'X-Tenant-Id': 'tenant-123',
      });
      done();
    });
  });
});
