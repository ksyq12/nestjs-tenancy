import { expectTenantIsolation } from '../../src/testing/expect-tenant-isolation';
import { TenancyContext } from '../../src/services/tenancy-context';

describe('expectTenantIsolation', () => {
  const context = new TenancyContext();

  function createMockModel(data: Record<string, any[]>) {
    return {
      findMany: jest.fn(async () => {
        const tenantId = context.getTenantId();
        return data[tenantId!] ?? [];
      }),
    };
  }

  it('should pass when tenants are properly isolated', async () => {
    const model = createMockModel({
      'tenant-a': [{ id: 1, tenant_id: 'tenant-a' }],
      'tenant-b': [{ id: 2, tenant_id: 'tenant-b' }],
    });

    await expect(
      expectTenantIsolation(model, 'tenant-a', 'tenant-b'),
    ).resolves.toBeUndefined();
  });

  it('should throw when tenant A leaks into tenant B', async () => {
    const model = createMockModel({
      'tenant-a': [
        { id: 1, tenant_id: 'tenant-a' },
        { id: 2, tenant_id: 'tenant-b' }, // leak!
      ],
      'tenant-b': [{ id: 3, tenant_id: 'tenant-b' }],
    });

    await expect(
      expectTenantIsolation(model, 'tenant-a', 'tenant-b'),
    ).rejects.toThrow('Tenant isolation violation');
  });

  it('should throw when tenant B leaks into tenant A', async () => {
    const model = createMockModel({
      'tenant-a': [{ id: 1, tenant_id: 'tenant-a' }],
      'tenant-b': [
        { id: 2, tenant_id: 'tenant-b' },
        { id: 3, tenant_id: 'tenant-a' }, // leak!
      ],
    });

    await expect(
      expectTenantIsolation(model, 'tenant-a', 'tenant-b'),
    ).rejects.toThrow('Tenant isolation violation');
  });

  it('should pass when both tenants return empty results', async () => {
    const model = createMockModel({});

    await expect(
      expectTenantIsolation(model, 'tenant-a', 'tenant-b'),
    ).resolves.toBeUndefined();
  });

  it('should throw when a third-party tenant leaks into results', async () => {
    const model = createMockModel({
      'tenant-a': [
        { id: 1, tenant_id: 'tenant-a' },
        { id: 99, tenant_id: 'tenant-c' }, // third-party leak!
      ],
      'tenant-b': [{ id: 2, tenant_id: 'tenant-b' }],
    });

    await expect(
      expectTenantIsolation(model, 'tenant-a', 'tenant-b'),
    ).rejects.toThrow('tenant-c');
  });

  it('should support custom tenantIdField', async () => {
    const model = createMockModel({
      'tenant-a': [{ id: 1, org_id: 'tenant-a' }],
      'tenant-b': [{ id: 2, org_id: 'tenant-b' }],
    });

    await expect(
      expectTenantIsolation(model, 'tenant-a', 'tenant-b', { tenantIdField: 'org_id' }),
    ).resolves.toBeUndefined();
  });
});
