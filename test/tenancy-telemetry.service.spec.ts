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

    beforeEach(() => {
      service = createService({ telemetry: { createSpans: true } });
      // Simulate successful OTel initialization by setting internal state
      (service as any).traceApi = {
        getActiveSpan: () => mockSpan,
        getTracer: () => mockTracer,
      };
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
      (service as any).traceApi = {
        getActiveSpan: () => null,
        getTracer: () => mockTracer,
      };
      expect(() => service.setTenantAttribute('tenant-no-span')).not.toThrow();
    });
  });
});
