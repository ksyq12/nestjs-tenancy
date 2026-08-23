import { Module, RequestMethod } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import {
  getTenancyAllRoutesPath,
  TenancyModule,
} from '../src/tenancy.module';
import { TenancyService } from '../src/services/tenancy.service';
import { TenancyEventService } from '../src/events/tenancy-event.service';
import { TenancyModuleOptionsFactory } from '../src/interfaces/tenancy-module-options.interface';
import { TENANCY_MODULE_OPTIONS } from '../src/tenancy.constants';
import { TenantContextDiagnostics } from '../src/diagnostics/tenant-context-diagnostics';

describe('TenancyModule', () => {
  it('should choose the legacy wildcard route path for NestJS 10', () => {
    expect(getTenancyAllRoutesPath(10)).toBe('*');
  });

  it('should choose the named wildcard route path for NestJS 11 and newer', () => {
    expect(getTenancyAllRoutesPath(11)).toBe('{*splat}');
    expect(getTenancyAllRoutesPath(12)).toBe('{*splat}');
    expect(getTenancyAllRoutesPath(null)).toBe('{*splat}');
  });

  it('should register middleware for all routes with a Nest-compatible wildcard', () => {
    const forRoutes = jest.fn();
    const apply = jest.fn(() => ({ forRoutes }));

    new TenancyModule().configure({ apply } as any);

    expect(forRoutes).toHaveBeenCalledWith({
      path: getTenancyAllRoutesPath(),
      method: RequestMethod.ALL,
    });
  });

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

    it('should provide TenancyEventService', async () => {
      const module = await Test.createTestingModule({
        imports: [TenancyModule.forRoot({ tenantExtractor: 'x-tenant-id' })],
      }).compile();

      const eventService = module.get(TenancyEventService);
      expect(eventService).toBeDefined();
    });

    it('should configure and export non-HTTP missing-context diagnostics', async () => {
      const module = await Test.createTestingModule({
        imports: [TenancyModule.forRoot({
          tenantExtractor: 'x-tenant-id',
          missingContext: { policy: 'throw' },
        })],
      }).compile();

      const diagnostics = module.get(TenantContextDiagnostics);
      expect(diagnostics.policy).toBe('throw');
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

    it('should support useExisting with pre-registered factory', async () => {
      class ExistingOptionsFactory implements TenancyModuleOptionsFactory {
        createTenancyOptions() {
          return { tenantExtractor: 'x-tenant-id' };
        }
      }

      // useExisting requires the factory to already be provided by another module.
      // Create a helper module that provides and exports it.
      @Module({
        providers: [ExistingOptionsFactory],
        exports: [ExistingOptionsFactory],
      })
      class OptionsModule {}

      const module = await Test.createTestingModule({
        imports: [
          OptionsModule,
          TenancyModule.forRootAsync({
            imports: [OptionsModule],
            useExisting: ExistingOptionsFactory,
          }),
        ],
      }).compile();

      expect(module.get(TenancyService)).toBeDefined();
      const options = module.get(TENANCY_MODULE_OPTIONS);
      expect(options.tenantExtractor).toBe('x-tenant-id');
    });

    it('should reject empty async options before Nest dependency resolution', () => {
      expect(() => TenancyModule.forRootAsync({})).toThrow(
        '[TenancyModule] forRootAsync requires one of: useFactory, useClass, or useExisting',
      );
    });
  });
});
