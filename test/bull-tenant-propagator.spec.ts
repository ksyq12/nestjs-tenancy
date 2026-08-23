import { TenancyContext } from '../src/services/tenancy-context';
import { BullTenantPropagator } from '../src/propagation/bull-tenant-propagator';
import { TenantContextDiagnostics } from '../src/diagnostics/tenant-context-diagnostics';

describe('BullTenantPropagator', () => {
  let context: TenancyContext;

  beforeEach(() => {
    context = new TenancyContext();
  });

  describe('inject', () => {
    it('should add tenant ID to job data with default key', (done) => {
      const propagator = new BullTenantPropagator(context);
      context.run('tenant-abc', () => {
        const result = propagator.inject({ orderId: '123' });
        expect(result).toEqual({ orderId: '123', __tenantId: 'tenant-abc' });
        done();
      });
    });

    it('should add tenant ID with custom key', (done) => {
      const propagator = new BullTenantPropagator(context, { dataKey: 'tenantId' });
      context.run('tenant-xyz', () => {
        const result = propagator.inject({ orderId: '123' });
        expect(result).toEqual({ orderId: '123', tenantId: 'tenant-xyz' });
        done();
      });
    });

    it('should return job data unchanged when no tenant context', () => {
      const propagator = new BullTenantPropagator(context);
      const data = { orderId: '123' };
      expect(propagator.inject(data)).toBe(data);
    });

    it('should diagnose missing producer context with queue resource', () => {
      const onMissing = jest.fn();
      const propagator = new BullTenantPropagator(context, {
        resource: 'orders',
        diagnostics: new TenantContextDiagnostics({ policy: 'warn', onMissing }),
      });

      expect(propagator.inject({ orderId: '123' })).toEqual({ orderId: '123' });
      expect(onMissing).toHaveBeenCalledWith({
        transport: 'bull', operation: 'inject', resource: 'orders',
      });
    });

    it('should not mutate original job data', (done) => {
      const propagator = new BullTenantPropagator(context);
      const original = { orderId: '123' };
      context.run('tenant-abc', () => {
        propagator.inject(original);
        expect(original).toEqual({ orderId: '123' });
        done();
      });
    });

    it('should return job data unchanged inside withoutTenant()', async () => {
      const propagator = new BullTenantPropagator(context);
      const data = { orderId: '123' };
      await context.runWithoutTenant(() => {
        expect(propagator.inject(data)).toBe(data);
      });
    });

    it('should throw when job data already has a different tenant ID', (done) => {
      const propagator = new BullTenantPropagator(context);
      context.run('tenant-abc', () => {
        expect(() =>
          propagator.inject({ orderId: '123', __tenantId: 'tenant-other' }),
        ).toThrow(
          '[BullTenantPropagator] Job data already contains "__tenantId" with a different tenant ID',
        );
        done();
      });
    });

    it('should allow job data that already has the same tenant ID', (done) => {
      const propagator = new BullTenantPropagator(context);
      context.run('tenant-abc', () => {
        expect(propagator.inject({ orderId: '123', __tenantId: 'tenant-abc' })).toEqual({
          orderId: '123',
          __tenantId: 'tenant-abc',
        });
        done();
      });
    });
  });

  describe('extract', () => {
    it('should extract tenant ID from job data', () => {
      const propagator = new BullTenantPropagator(context);
      expect(propagator.extract({ __tenantId: 'tenant-abc', orderId: '123' })).toBe('tenant-abc');
    });

    it('should extract tenant ID with custom key', () => {
      const propagator = new BullTenantPropagator(context, { dataKey: 'tenantId' });
      expect(propagator.extract({ tenantId: 'tenant-abc' })).toBe('tenant-abc');
    });

    it('should return null when key is missing', () => {
      const propagator = new BullTenantPropagator(context);
      expect(propagator.extract({ orderId: '123' })).toBeNull();
    });

    it('should diagnose missing consumer carrier context', () => {
      const onMissing = jest.fn();
      const propagator = new BullTenantPropagator(context, {
        diagnostics: new TenantContextDiagnostics({ policy: 'warn', onMissing }),
      });

      expect(propagator.extract({ orderId: '123' })).toBeNull();
      expect(onMissing).toHaveBeenCalledWith({
        transport: 'bull', operation: 'extract',
      });
    });

    it('should return null when value is not a string', () => {
      const propagator = new BullTenantPropagator(context);
      expect(propagator.extract({ __tenantId: 42 })).toBeNull();
    });

    it('should return null when value is empty string', () => {
      const propagator = new BullTenantPropagator(context);
      expect(propagator.extract({ __tenantId: '' })).toBeNull();
    });
  });
});
