import { TenancyContext } from '../src/services/tenancy-context';
import { HttpTenantPropagator } from '../src/propagation/http-tenant-propagator';

describe('HttpTenantPropagator', () => {
  let context: TenancyContext;

  beforeEach(() => {
    context = new TenancyContext();
  });

  it('should return tenant header with default name', (done) => {
    const propagator = new HttpTenantPropagator(context);
    context.run('tenant-abc', () => {
      expect(propagator.getHeaders()).toEqual({ 'X-Tenant-Id': 'tenant-abc' });
      done();
    });
  });

  it('should return tenant header with custom name', (done) => {
    const propagator = new HttpTenantPropagator(context, { headerName: 'X-Custom-Tenant' });
    context.run('tenant-xyz', () => {
      expect(propagator.getHeaders()).toEqual({ 'X-Custom-Tenant': 'tenant-xyz' });
      done();
    });
  });

  it('should return empty object when no tenant context', () => {
    const propagator = new HttpTenantPropagator(context);
    expect(propagator.getHeaders()).toEqual({});
  });

  it('should return empty object inside withoutTenant()', () => {
    const propagator = new HttpTenantPropagator(context);
    context.runWithoutTenant(() => {
      expect(propagator.getHeaders()).toEqual({});
    });
  });

  it('should allow merging with existing headers', (done) => {
    const propagator = new HttpTenantPropagator(context);
    context.run('tenant-abc', () => {
      const headers = { Authorization: 'Bearer token', ...propagator.getHeaders() };
      expect(headers).toEqual({
        Authorization: 'Bearer token',
        'X-Tenant-Id': 'tenant-abc',
      });
      done();
    });
  });
});
