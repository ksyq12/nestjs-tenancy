import { Test } from '@nestjs/testing';
import { TenancyModule } from '../src/tenancy.module';
import { TenancyService } from '../src/services/tenancy.service';
import { TENANCY_MODULE_OPTIONS } from '../src/tenancy.constants';

describe('TenancyModule', () => {
  describe('forRoot', () => {
    it('should provide TenancyService', async () => {
      const module = await Test.createTestingModule({
        imports: [TenancyModule.forRoot({ tenantExtractor: 'x-tenant-id' })],
      }).compile();

      const service = module.get(TenancyService);
      expect(service).toBeDefined();
      expect(service.getCurrentTenant()).toBeNull();
    });

    it('should provide module options', async () => {
      const module = await Test.createTestingModule({
        imports: [TenancyModule.forRoot({ tenantExtractor: 'x-tenant-id' })],
      }).compile();

      const options = module.get(TENANCY_MODULE_OPTIONS);
      expect(options.tenantExtractor).toBe('x-tenant-id');
    });
  });

  describe('forRootAsync', () => {
    it('should provide TenancyService with useFactory', async () => {
      const module = await Test.createTestingModule({
        imports: [
          TenancyModule.forRootAsync({
            useFactory: () => ({ tenantExtractor: 'x-tenant-id' }),
          }),
        ],
      }).compile();

      expect(module.get(TenancyService)).toBeDefined();
    });

    it('should support useClass', async () => {
      class TestOptionsFactory {
        createTenancyOptions() {
          return { tenantExtractor: 'x-tenant-id' };
        }
      }

      const module = await Test.createTestingModule({
        imports: [
          TenancyModule.forRootAsync({ useClass: TestOptionsFactory }),
        ],
      }).compile();

      expect(module.get(TenancyService)).toBeDefined();
    });
  });
});
