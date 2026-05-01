import { TenancyTelemetryService } from '../src/telemetry/tenancy-telemetry.service';
import { TenancyModuleOptions } from '../src/interfaces/tenancy-module-options.interface';

function createService(
  overrides: Partial<TenancyModuleOptions> = {},
): TenancyTelemetryService {
  const options: TenancyModuleOptions = { tenantExtractor: 'x-tenant-id', ...overrides };
  return new TenancyTelemetryService(options);
}

describe('TenancyTelemetryService', () => {
  describe('graceful degradation (no @opentelemetry/api)', () => {
    it('should not throw when calling setTenantAttribute without OTel', () => {
      const service = createService();
      // onModuleInit not called — traceApi is null
      expect(() => service.setTenantAttribute('tenant-123')).not.toThrow();
    });

    it('should return null from startSpan without OTel', () => {
      const service = createService({ telemetry: { createSpans: true } });
      expect(service.startSpan('test.span')).toBeNull();
    });

    it('should not throw when calling endSpan with null', () => {
      const service = createService();
      expect(() => service.endSpan(null)).not.toThrow();
    });
  });

  describe('with mocked OTel API', () => {
    let service: TenancyTelemetryService;
    const mockSpan = {
      setAttribute: jest.fn(),
      end: jest.fn(),
    };
    const mockTracer = {
      startSpan: jest.fn().mockReturnValue(mockSpan),
    };
    const mockTraceApi = {
      getActiveSpan: () => mockSpan,
      getTracer: () => mockTracer,
      setSpan: jest.fn((activeContext: unknown, span: unknown) => ({ activeContext, span })),
    };
    const mockContextApi = {
      active: jest.fn(() => ({ active: true })),
      with: jest.fn((_context: unknown, callback: () => unknown) => callback()),
    };

    beforeEach(() => {
      service = createService({ telemetry: { createSpans: true } });
      // Simulate successful OTel initialization by setting internal state
      (service as any).traceApi = mockTraceApi;
      (service as any).contextApi = mockContextApi;
      (service as any).tracer = mockTracer;
    });

    afterEach(() => jest.clearAllMocks());

    it('should set tenant attribute on active span', () => {
      service.setTenantAttribute('tenant-abc');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('tenant.id', 'tenant-abc');
    });

    it('should use custom spanAttributeKey', () => {
      const customService = createService({
        telemetry: { spanAttributeKey: 'app.tenant', createSpans: true },
      });
      (customService as any).traceApi = {
        getActiveSpan: () => mockSpan,
        getTracer: () => mockTracer,
      };
      customService.setTenantAttribute('tenant-custom');
      expect(mockSpan.setAttribute).toHaveBeenCalledWith('app.tenant', 'tenant-custom');
    });

    it('should create custom span when createSpans is true', () => {
      const span = service.startSpan('tenant.resolved');
      expect(mockTracer.startSpan).toHaveBeenCalledWith('tenant.resolved', { attributes: undefined });
      expect(span).toBe(mockSpan);
    });

    it('should accept OpenTelemetry non-string span attributes', () => {
      service.startSpan('tenant.metrics', {
        'tenant.retry_count': 2,
        'tenant.sampled': true,
      });

      expect(mockTracer.startSpan).toHaveBeenCalledWith('tenant.metrics', {
        attributes: {
          'tenant.retry_count': 2,
          'tenant.sampled': true,
        },
      });
    });

    it('should create tenant span with configured tenant attribute key', () => {
      const customService = createService({
        telemetry: { spanAttributeKey: 'app.tenant', createSpans: true },
      });
      (customService as any).tracer = mockTracer;

      const span = customService.startTenantSpan('tenant.resolved', 'tenant-custom');

      expect(mockTracer.startSpan).toHaveBeenCalledWith('tenant.resolved', {
        attributes: { 'app.tenant': 'tenant-custom' },
      });
      expect(span).toBe(mockSpan);
    });

    it('should run tenant span callback in active span context and end after async completion', async () => {
      const order: string[] = [];
      mockSpan.end.mockImplementationOnce(() => order.push('end'));

      const result = await service.withTenantSpan(
        'tenant.resolved',
        'tenant-abc',
        async (span) => {
          expect(span).toBe(mockSpan);
          expect(mockTraceApi.setSpan).toHaveBeenCalledWith({ active: true }, mockSpan);
          expect(mockContextApi.with).toHaveBeenCalled();
          order.push('callback');
          return 'ok';
        },
      );

      expect(result).toBe('ok');
      expect(order).toEqual(['callback', 'end']);
    });

    it('should not create span when createSpans is false', () => {
      const noSpanService = createService({ telemetry: { createSpans: false } });
      (noSpanService as any).tracer = mockTracer;
      const span = noSpanService.startSpan('tenant.resolved');
      expect(span).toBeNull();
      expect(mockTracer.startSpan).not.toHaveBeenCalled();
    });

    it('should end span safely', () => {
      const span = service.startSpan('test.span');
      service.endSpan(span);
      expect(mockSpan.end).toHaveBeenCalled();
    });

    it('should handle null active span gracefully', () => {
      (service as any).traceApi = { ...mockTraceApi, getActiveSpan: () => null };
      expect(() => service.setTenantAttribute('tenant-no-span')).not.toThrow();
    });
  });

  describe('onModuleInit', () => {
    it('should set traceApi and tracer when @opentelemetry/api is available', async () => {
      const service = createService({ telemetry: { createSpans: true } });

      // @opentelemetry/api is installed as a devDependency — onModuleInit should succeed
      await service.onModuleInit();

      // After successful init, setTenantAttribute should not throw
      expect(() => service.setTenantAttribute('tenant-init-test')).not.toThrow();

      // tracer should be initialized — startSpan returns a real span object
      const span = service.startSpan('test.init.span');
      expect(span).not.toBeNull();
      expect(typeof span!.end).toBe('function');
      service.endSpan(span);
    });

    it('should gracefully handle import failure in onModuleInit', async () => {
      const service = createService();
      // onModuleInit should not throw regardless of import result
      await expect(service.onModuleInit()).resolves.not.toThrow();
    });
  });
});
