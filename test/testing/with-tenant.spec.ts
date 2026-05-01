import { TenancyContext } from '../../src/services/tenancy-context';
import { withTenant } from '../../src/testing/with-tenant';

describe('withTenant', () => {
  it('should set tenant context for the callback', async () => {
    const context = new TenancyContext();
    const tenantId = await withTenant('tenant-1', () => context.getTenantId());
    expect(tenantId).toBe('tenant-1');
  });

  it('should return the callback result', async () => {
    const result = await withTenant('tenant-1', () => [1, 2, 3]);
    expect(result).toEqual([1, 2, 3]);
  });

  it('should resolve the value returned by TenancyContext.run', async () => {
    const context = {
      run: jest.fn(() => 'run-result'),
    } as unknown as TenancyContext;

    await expect(withTenant('tenant-1', () => 'callback-result', context)).resolves.toBe('run-result');
    expect(context.run).toHaveBeenCalledWith('tenant-1', expect.any(Function));
  });

  it('should handle async callbacks', async () => {
    const result = await withTenant('tenant-1', async () => {
      await new Promise((r) => setTimeout(r, 5));
      return 'async-result';
    });
    expect(result).toBe('async-result');
  });

  it('should propagate errors from callback', async () => {
    await expect(
      withTenant('tenant-1', () => {
        throw new Error('test error');
      }),
    ).rejects.toThrow('test error');
  });

  it('should propagate async errors', async () => {
    await expect(
      withTenant('tenant-1', async () => {
        throw new Error('async error');
      }),
    ).rejects.toThrow('async error');
  });

  it('should accept an explicit context instance', async () => {
    const ctx = new TenancyContext();
    const tenantId = await withTenant('tenant-2', () => ctx.getTenantId(), ctx);
    expect(tenantId).toBe('tenant-2');
  });

  it('should not leak tenant context after completion', async () => {
    const context = new TenancyContext();
    await withTenant('tenant-1', () => {});
    expect(context.getTenantId()).toBeNull();
  });
});
