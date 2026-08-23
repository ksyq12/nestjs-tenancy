import { TenancyContext } from '../src/services/tenancy-context';
import { KafkaTenantPropagator } from '../src/propagation/kafka-tenant-propagator';
import { TenantContextDiagnostics } from '../src/diagnostics/tenant-context-diagnostics';

describe('KafkaTenantPropagator', () => {
  let context: TenancyContext;

  beforeEach(() => {
    context = new TenancyContext();
  });

  describe('inject', () => {
    it('should add tenant header to message with default name', (done) => {
      const propagator = new KafkaTenantPropagator(context);
      context.run('tenant-abc', () => {
        const result = propagator.inject({ value: 'payload' });
        expect(result).toEqual({
          value: 'payload',
          headers: { 'X-Tenant-Id': 'tenant-abc' },
        });
        done();
      });
    });

    it('should merge with existing headers', (done) => {
      const propagator = new KafkaTenantPropagator(context);
      context.run('tenant-abc', () => {
        const result = propagator.inject({
          value: 'payload',
          headers: { 'X-Correlation-Id': 'corr-123' },
        });
        expect(result.headers).toEqual({
          'X-Correlation-Id': 'corr-123',
          'X-Tenant-Id': 'tenant-abc',
        });
        done();
      });
    });

    it('should use custom header name', (done) => {
      const propagator = new KafkaTenantPropagator(context, { headerName: 'X-Custom' });
      context.run('tenant-xyz', () => {
        const result = propagator.inject({ value: 'payload' });
        expect(result.headers).toEqual({ 'X-Custom': 'tenant-xyz' });
        done();
      });
    });

    it('should return message unchanged when no tenant context', () => {
      const propagator = new KafkaTenantPropagator(context);
      const message = { value: 'payload' };
      expect(propagator.inject(message)).toBe(message);
    });

    it('should apply throw policy when producer context is missing', () => {
      const propagator = new KafkaTenantPropagator(context, {
        resource: 'orders.created',
        diagnostics: new TenantContextDiagnostics({ policy: 'throw' }),
      });

      expect(() => propagator.inject({ value: 'payload' })).toThrow(
        'Tenant context is missing during kafka.inject for resource "orders.created"',
      );
    });

    it('should not mutate original message', (done) => {
      const propagator = new KafkaTenantPropagator(context);
      const original = { value: 'payload', headers: { existing: 'header' } };
      context.run('tenant-abc', () => {
        propagator.inject(original);
        expect(original.headers).toEqual({ existing: 'header' });
        done();
      });
    });
  });

  describe('extract', () => {
    it('should extract tenant from string header', () => {
      const propagator = new KafkaTenantPropagator(context);
      expect(propagator.extract({
        headers: { 'X-Tenant-Id': 'tenant-abc' },
      })).toBe('tenant-abc');
    });

    it('should extract tenant from Buffer header', () => {
      const propagator = new KafkaTenantPropagator(context);
      expect(propagator.extract({
        headers: { 'X-Tenant-Id': Buffer.from('tenant-abc') },
      })).toBe('tenant-abc');
    });

    it('should use custom header name for extraction', () => {
      const propagator = new KafkaTenantPropagator(context, { headerName: 'X-Custom' });
      expect(propagator.extract({
        headers: { 'X-Custom': 'tenant-xyz' },
      })).toBe('tenant-xyz');
    });

    it('should return null when header is missing', () => {
      const propagator = new KafkaTenantPropagator(context);
      expect(propagator.extract({ headers: {} })).toBeNull();
    });

    it('should diagnose missing header context on extract', () => {
      const onMissing = jest.fn();
      const propagator = new KafkaTenantPropagator(context, {
        diagnostics: new TenantContextDiagnostics({ policy: 'warn', onMissing }),
      });

      expect(propagator.extract({ headers: {} })).toBeNull();
      expect(onMissing).toHaveBeenCalledWith({
        transport: 'kafka', operation: 'extract',
      });
    });

    it('should return null when headers object is undefined', () => {
      const propagator = new KafkaTenantPropagator(context);
      expect(propagator.extract({})).toBeNull();
    });

    it('should return null when header is undefined', () => {
      const propagator = new KafkaTenantPropagator(context);
      expect(propagator.extract({
        headers: { 'X-Tenant-Id': undefined },
      })).toBeNull();
    });

    it('should return null for empty Buffer', () => {
      const propagator = new KafkaTenantPropagator(context);
      expect(propagator.extract({
        headers: { 'X-Tenant-Id': Buffer.from('') },
      })).toBeNull();
    });

    it('should return null for empty string header', () => {
      const propagator = new KafkaTenantPropagator(context);
      expect(propagator.extract({
        headers: { 'X-Tenant-Id': '' },
      })).toBeNull();
    });
  });

  describe('getHeaders (TenantPropagator compatibility)', () => {
    it('should return tenant header', (done) => {
      const propagator = new KafkaTenantPropagator(context);
      context.run('tenant-abc', () => {
        expect(propagator.getHeaders()).toEqual({ 'X-Tenant-Id': 'tenant-abc' });
        done();
      });
    });

    it('should return empty object when no tenant context', () => {
      const propagator = new KafkaTenantPropagator(context);
      expect(propagator.getHeaders()).toEqual({});
    });
  });
});
