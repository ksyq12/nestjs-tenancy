import { TenancyContext } from '../src/services/tenancy-context';
import { TenancyService } from '../src/services/tenancy.service';

describe('TenancyService', () => {
  let context: TenancyContext;
  let service: TenancyService;

  beforeEach(() => {
    context = new TenancyContext();
    service = new TenancyService(context);
  });

  describe('getCurrentTenant', () => {
    it('should return null when no tenant is set', () => {
      expect(service.getCurrentTenant()).toBeNull();
    });

    it('should return the current tenant ID', (done) => {
      context.run('tenant-123', () => {
        expect(service.getCurrentTenant()).toBe('tenant-123');
        done();
      });
    });
  });

  describe('getCurrentTenantOrThrow', () => {
    it('should throw when no tenant is set', () => {
      expect(() => service.getCurrentTenantOrThrow()).toThrow('No tenant context available');
    });

    it('should return tenant ID when set', (done) => {
      context.run('tenant-456', () => {
        expect(service.getCurrentTenantOrThrow()).toBe('tenant-456');
        done();
      });
    });
  });
});
