import { DynamicModule, Module } from '@nestjs/common';
import { TenancyContext } from '../services/tenancy-context';
import { TenancyService } from '../services/tenancy.service';
import type { TenancyModuleOptions } from '../interfaces/tenancy-module-options.interface';
import { TENANCY_MODULE_OPTIONS } from '../tenancy.constants';

export type TestTenancyModuleOptions = Partial<TenancyModuleOptions>;

const DEFAULT_TEST_TENANCY_OPTIONS: TenancyModuleOptions = {
  tenantExtractor: 'X-Tenant-Id',
};

/**
 * A lightweight test module that provides TenancyContext and TenancyService
 * without the middleware, guard, or module options required by the production
 * TenancyModule.
 *
 * Usage in tests:
 * ```typescript
 * const module = await Test.createTestingModule({
 *   imports: [TestTenancyModule.register()],
 *   providers: [MyService],
 * }).compile();
 *
 * const service = module.get(MyService);
 * const result = await withTenant('tenant-1', () => service.findAll());
 * ```
 */
@Module({})
export class TestTenancyModule {
  static register(options: TestTenancyModuleOptions = {}): DynamicModule {
    const tenancyOptions: TenancyModuleOptions = {
      ...DEFAULT_TEST_TENANCY_OPTIONS,
      ...options,
      tenantExtractor: options.tenantExtractor ?? DEFAULT_TEST_TENANCY_OPTIONS.tenantExtractor,
    };

    return {
      module: TestTenancyModule,
      global: true,
      providers: [
        { provide: TENANCY_MODULE_OPTIONS, useValue: tenancyOptions },
        TenancyContext,
        TenancyService,
      ],
      exports: [TENANCY_MODULE_OPTIONS, TenancyContext, TenancyService],
    };
  }
}
