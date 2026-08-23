import { TenantContextDiagnostics } from '../src/diagnostics/tenant-context-diagnostics';
import { TenantResourceKey } from '../src/resources/tenant-resource-key';
import { TenantSearch } from '../src/resources/tenant-search';
import { TenancyContext } from '../src/services/tenancy-context';

describe('tenant-scoped Redis/search resources', () => {
  let context: TenancyContext;

  beforeEach(() => {
    context = new TenancyContext();
  });

  it('creates collision-safe Redis keys inside tenant context', () => {
    const keys = new TenantResourceKey(context, {
      transport: 'redis',
      resource: 'response-cache',
    });

    expect(context.run('tenant:a', () => keys.create('product:1')))
      .toBe('tenant:8:tenant:a:product:1');
  });

  it('returns null and diagnoses a missing Redis context', () => {
    const onMissing = jest.fn();
    const keys = new TenantResourceKey(context, {
      transport: 'redis',
      resource: 'response-cache',
      prefix: 'org',
      separator: '|',
      diagnostics: new TenantContextDiagnostics({ policy: 'warn', onMissing }),
    });

    expect(keys.create('product:1')).toBeNull();
    expect(onMissing).toHaveBeenCalledWith({
      transport: 'redis',
      operation: 'key',
      resource: 'response-cache',
    });
  });

  it('passes explicit tenant and index scope to a search adapter', async () => {
    const adapter = { search: jest.fn().mockResolvedValue(['one']) };
    const search = new TenantSearch(context, adapter, { index: 'products' });

    await expect(context.run('tenant-a', () => search.search({ term: 'one' })))
      .resolves.toEqual(['one']);
    expect(adapter.search).toHaveBeenCalledWith(
      { tenantId: 'tenant-a', index: 'products' },
      { term: 'one' },
    );
  });

  it('never calls a search adapter without tenant context', async () => {
    const adapter = { search: jest.fn() };
    const onMissing = jest.fn();
    const search = new TenantSearch(context, adapter, {
      index: 'products',
      diagnostics: new TenantContextDiagnostics({ policy: 'warn', onMissing }),
    });

    await expect(search.search({ term: 'one' })).resolves.toBeNull();
    expect(adapter.search).not.toHaveBeenCalled();
    expect(onMissing).toHaveBeenCalledWith({
      transport: 'search',
      operation: 'search',
      resource: 'products',
    });
  });
});
