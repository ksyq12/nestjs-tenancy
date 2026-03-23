import { TenancyContext } from '../src/services/tenancy-context';

describe('CurrentTenant', () => {
  it('should read tenant ID from static AsyncLocalStorage', (done) => {
    const setter = new TenancyContext();
    const reader = new TenancyContext();
    setter.run('tenant-xyz', () => {
      expect(reader.getTenantId()).toBe('tenant-xyz');
      done();
    });
  });

  it('should return null when no tenant context', () => {
    const ctx = new TenancyContext();
    expect(ctx.getTenantId()).toBeNull();
  });
});
