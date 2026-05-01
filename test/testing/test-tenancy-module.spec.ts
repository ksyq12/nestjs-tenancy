import { Test } from '@nestjs/testing';
import { Injectable } from '@nestjs/common';
import { TenancyService } from '../../src/services/tenancy.service';
import { TenancyContext } from '../../src/services/tenancy-context';
import { TENANCY_MODULE_OPTIONS } from '../../src/tenancy.constants';
import { TestTenancyModule } from '../../src/testing/test-tenancy.module';
import { withTenant } from '../../src/testing/with-tenant';

@Injectable()
class SampleService {
  constructor(private readonly tenancy: TenancyService) {}

  getCurrentTenant(): string | null {
    return this.tenancy.getCurrentTenant();
  }
}

describe('TestTenancyModule', () => {
  it('should provide TenancyService', async () => {
    const module = await Test.createTestingModule({
      imports: [TestTenancyModule.register()],
    }).compile();

    const service = module.get(TenancyService);
    expect(service).toBeDefined();
    expect(service.getCurrentTenant()).toBeNull();
  });

  it('should provide TenancyContext', async () => {
    const module = await Test.createTestingModule({
      imports: [TestTenancyModule.register()],
    }).compile();

    const context = module.get(TenancyContext);
    expect(context).toBeDefined();
  });

  it('should provide default tenancy module options', async () => {
    const module = await Test.createTestingModule({
      imports: [TestTenancyModule.register()],
    }).compile();

    expect(module.get(TENANCY_MODULE_OPTIONS)).toEqual({
      tenantExtractor: 'X-Tenant-Id',
    });
  });

  it('should allow overriding tenancy module options', async () => {
    const module = await Test.createTestingModule({
      imports: [TestTenancyModule.register({ tenantExtractor: 'X-Org-Id' })],
    }).compile();

    expect(module.get(TENANCY_MODULE_OPTIONS)).toEqual({
      tenantExtractor: 'X-Org-Id',
    });
  });

  it('should allow injecting TenancyService into other services', async () => {
    const module = await Test.createTestingModule({
      imports: [TestTenancyModule.register()],
      providers: [SampleService],
    }).compile();

    const sample = module.get(SampleService);
    expect(sample).toBeDefined();

    const tenantId = await withTenant('test-tenant', () => sample.getCurrentTenant());
    expect(tenantId).toBe('test-tenant');
  });

  it('should work without middleware or guard', async () => {
    const module = await Test.createTestingModule({
      imports: [TestTenancyModule.register()],
    }).compile();

    const service = module.get(TenancyService);

    // No middleware to set tenant, so it should be null
    expect(service.getCurrentTenant()).toBeNull();

    // But withTenant sets it explicitly
    const result = await withTenant('tenant-abc', () => service.getCurrentTenant());
    expect(result).toBe('tenant-abc');
  });
});
