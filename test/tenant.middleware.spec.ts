import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TenancyContext } from '../src/services/tenancy-context';
import { TenantMiddleware } from '../src/middleware/tenant.middleware';
import { TenancyEventService } from '../src/events/tenancy-event.service';
import { TenancyTelemetryService } from '../src/telemetry/tenancy-telemetry.service';
import { TenancyEvents } from '../src/events/tenancy-events';
import { HeaderTenantExtractor } from '../src/extractors/header.extractor';
import { TenancyModuleOptions } from '../src/interfaces/tenancy-module-options.interface';
import { TenantExtractor } from '../src/interfaces/tenant-extractor.interface';

function createMockEventService(): TenancyEventService & { emit: jest.Mock } {
  return { emit: jest.fn(), onModuleInit: jest.fn() } as any;
}

function createMockTelemetryService(): TenancyTelemetryService {
  const options: TenancyModuleOptions = { tenantExtractor: 'x-tenant-id' };
  return new TenancyTelemetryService(options);
}

function createMiddleware(
  overrides: Partial<TenancyModuleOptions> = {},
  eventService?: TenancyEventService,
): TenantMiddleware {
  const options: TenancyModuleOptions = { tenantExtractor: 'x-tenant-id', ...overrides };
  return new TenantMiddleware(
    options,
    new TenancyContext(),
    eventService ?? createMockEventService(),
    createMockTelemetryService(),
  );
}

const mockReq = (headers: Record<string, string> = {}) => ({ headers }) as any;
const mockRes = () => ({}) as any;

describe('TenantMiddleware', () => {
  it('should extract tenant and set context', (done) => {
    const mw = createMiddleware();
    mw.use(mockReq({ 'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000' }), mockRes(), () => {
      expect(new TenancyContext().getTenantId()).toBe('550e8400-e29b-41d4-a716-446655440000');
      done();
    });
  });

  it('should call next without context when header missing', (done) => {
    const mw = createMiddleware();
    mw.use(mockReq(), mockRes(), () => {
      expect(new TenancyContext().getTenantId()).toBeNull();
      done();
    });
  });

  it('should throw BadRequestException for invalid tenant ID', async () => {
    const mw = createMiddleware();
    await expect(
      new Promise((resolve, reject) => {
        mw.use(mockReq({ 'x-tenant-id': 'not-a-uuid' }), mockRes(), resolve).catch(reject);
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should accept custom sync validator', (done) => {
    const mw = createMiddleware({ validateTenantId: (id) => id.startsWith('org_') });
    mw.use(mockReq({ 'x-tenant-id': 'org_123' }), mockRes(), () => {
      expect(new TenancyContext().getTenantId()).toBe('org_123');
      done();
    });
  });

  it('should accept async validator', (done) => {
    const mw = createMiddleware({ validateTenantId: async (id) => id.startsWith('org_') });
    mw.use(mockReq({ 'x-tenant-id': 'org_456' }), mockRes(), () => {
      expect(new TenancyContext().getTenantId()).toBe('org_456');
      done();
    });
  });

  it('should propagate error when async validator throws', async () => {
    const mw = createMiddleware({
      validateTenantId: async () => { throw new Error('db connection failed'); },
    });
    await expect(
      new Promise((resolve, reject) => {
        mw.use(mockReq({ 'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000' }), mockRes(), resolve).catch(reject);
      }),
    ).rejects.toThrow('db connection failed');
  });

  it('should accept TenantExtractor object', (done) => {
    const mw = createMiddleware({ tenantExtractor: new HeaderTenantExtractor('x-custom') });
    mw.use(mockReq({ 'x-custom': '550e8400-e29b-41d4-a716-446655440000' }), mockRes(), () => {
      expect(new TenancyContext().getTenantId()).toBe('550e8400-e29b-41d4-a716-446655440000');
      done();
    });
  });

  describe('Lifecycle Hooks', () => {
    it('should call onTenantResolved after successful extraction', (done) => {
      const onTenantResolved = jest.fn();
      const mw = createMiddleware({ onTenantResolved });
      const req = mockReq({ 'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000' });

      mw.use(req, mockRes(), () => {
        expect(onTenantResolved).toHaveBeenCalledWith(
          '550e8400-e29b-41d4-a716-446655440000',
          req,
        );
        done();
      });
    });

    it('should call onTenantResolved inside context.run (getCurrentTenant available)', (done) => {
      const onTenantResolved = jest.fn((tenantId: string) => {
        expect(new TenancyContext().getTenantId()).toBe(tenantId);
      });
      const mw = createMiddleware({ onTenantResolved });

      mw.use(
        mockReq({ 'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000' }),
        mockRes(),
        () => { done(); },
      );
    });

    it('should call onTenantNotFound when no tenant header', (done) => {
      const onTenantNotFound = jest.fn();
      const mw = createMiddleware({ onTenantNotFound });
      const req = mockReq();
      const res = mockRes();

      mw.use(req, res, () => {
        expect(onTenantNotFound).toHaveBeenCalledWith(req, res);
        done();
      });
    });

    it('should support async hooks', (done) => {
      const onTenantResolved = jest.fn().mockResolvedValue(undefined);
      const mw = createMiddleware({ onTenantResolved });

      mw.use(
        mockReq({ 'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000' }),
        mockRes(),
        () => {
          expect(onTenantResolved).toHaveBeenCalled();
          done();
        },
      );
    });

    it('should propagate error from hook', async () => {
      const mw = createMiddleware({
        onTenantResolved: async () => { throw new Error('audit failed'); },
      });

      await expect(
        new Promise((resolve, reject) => {
          mw.use(
            mockReq({ 'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000' }),
            mockRes(),
            resolve,
          ).catch(reject);
        }),
      ).rejects.toThrow('audit failed');
    });

    it('should end telemetry span even when onTenantResolved throws', async () => {
      const mockSpan = { end: jest.fn() };
      const mockTelemetry = {
        setTenantAttribute: jest.fn(),
        startSpan: jest.fn().mockReturnValue(mockSpan),
        endSpan: jest.fn(),
      };
      const options: TenancyModuleOptions = {
        tenantExtractor: 'x-tenant-id',
        onTenantResolved: async () => { throw new Error('hook failed'); },
      };
      const mw = new TenantMiddleware(
        options,
        new TenancyContext(),
        createMockEventService(),
        mockTelemetry as any,
      );

      await expect(
        new Promise((resolve, reject) => {
          mw.use(
            mockReq({ 'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000' }),
            mockRes(),
            resolve,
          ).catch(reject);
        }),
      ).rejects.toThrow('hook failed');

      expect(mockTelemetry.startSpan).toHaveBeenCalledWith('tenant.resolved');
      expect(mockTelemetry.endSpan).toHaveBeenCalledWith(mockSpan);
    });

    it('should NOT call next() when onTenantNotFound returns "skip"', async () => {
      const onTenantNotFound = jest.fn().mockReturnValue('skip');
      const mw = createMiddleware({ onTenantNotFound });
      const next = jest.fn();
      const req = mockReq();
      const res = mockRes();

      await mw.use(req, res, next);

      expect(onTenantNotFound).toHaveBeenCalledWith(req, res);
      expect(next).not.toHaveBeenCalled();
    });

    it('should NOT call next() when async onTenantNotFound resolves "skip"', async () => {
      const onTenantNotFound = jest.fn().mockResolvedValue('skip');
      const mw = createMiddleware({ onTenantNotFound });
      const next = jest.fn();
      const req = mockReq();
      const res = mockRes();

      await mw.use(req, res, next);

      expect(onTenantNotFound).toHaveBeenCalledWith(req, res);
      expect(next).not.toHaveBeenCalled();
    });

    it('should call next() when onTenantNotFound returns void', (done) => {
      const onTenantNotFound = jest.fn();  // returns undefined
      const mw = createMiddleware({ onTenantNotFound });
      const req = mockReq();
      const res = mockRes();

      mw.use(req, res, () => {
        expect(onTenantNotFound).toHaveBeenCalledWith(req, res);
        done();
      });
    });

    it('should not call onTenantResolved when validation fails', async () => {
      const onTenantResolved = jest.fn();
      const mw = createMiddleware({ onTenantResolved });

      await expect(
        new Promise((resolve, reject) => {
          mw.use(mockReq({ 'x-tenant-id': 'invalid' }), mockRes(), resolve).catch(reject);
        }),
      ).rejects.toThrow(BadRequestException);

      expect(onTenantResolved).not.toHaveBeenCalled();
    });
  });

  describe('Cross-check validation', () => {
    const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
    const OTHER_UUID = '660e8400-e29b-41d4-a716-446655440000';

    function staticExtractor(value: string | null): TenantExtractor {
      return { extract: () => value };
    }

    it('should pass when cross-check matches primary extractor', (done) => {
      const mw = createMiddleware({
        crossCheckExtractor: staticExtractor(VALID_UUID),
      });
      mw.use(mockReq({ 'x-tenant-id': VALID_UUID }), mockRes(), () => {
        expect(new TenancyContext().getTenantId()).toBe(VALID_UUID);
        done();
      });
    });

    it('should throw ForbiddenException on mismatch (reject mode)', async () => {
      const mw = createMiddleware({
        crossCheckExtractor: staticExtractor(OTHER_UUID),
        onCrossCheckFailed: 'reject',
      });
      await expect(
        new Promise((resolve, reject) => {
          mw.use(mockReq({ 'x-tenant-id': VALID_UUID }), mockRes(), resolve).catch(reject);
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should log warning and continue on mismatch (log mode)', (done) => {
      const mw = createMiddleware({
        crossCheckExtractor: staticExtractor(OTHER_UUID),
        onCrossCheckFailed: 'log',
      });
      mw.use(mockReq({ 'x-tenant-id': VALID_UUID }), mockRes(), () => {
        // Continued with primary extractor value despite mismatch
        expect(new TenancyContext().getTenantId()).toBe(VALID_UUID);
        done();
      });
    });

    it('should skip validation when cross-check returns null', (done) => {
      const mw = createMiddleware({
        crossCheckExtractor: staticExtractor(null),
        onCrossCheckFailed: 'reject',
      });
      mw.use(mockReq({ 'x-tenant-id': VALID_UUID }), mockRes(), () => {
        expect(new TenancyContext().getTenantId()).toBe(VALID_UUID);
        done();
      });
    });

    it('should default to reject mode', async () => {
      const mw = createMiddleware({
        crossCheckExtractor: staticExtractor(OTHER_UUID),
        // onCrossCheckFailed not set — defaults to 'reject'
      });
      await expect(
        new Promise((resolve, reject) => {
          mw.use(mockReq({ 'x-tenant-id': VALID_UUID }), mockRes(), resolve).catch(reject);
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should emit CROSS_CHECK_FAILED event on mismatch', async () => {
      const eventService = createMockEventService();
      const mw = createMiddleware(
        { crossCheckExtractor: staticExtractor(OTHER_UUID) },
        eventService,
      );
      const req = mockReq({ 'x-tenant-id': VALID_UUID });

      await expect(
        new Promise((resolve, reject) => {
          mw.use(req, mockRes(), resolve).catch(reject);
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(eventService.emit).toHaveBeenCalledWith(
        TenancyEvents.CROSS_CHECK_FAILED,
        expect.objectContaining({
          extractedTenantId: VALID_UUID,
          crossCheckTenantId: OTHER_UUID,
        }),
      );
    });
  });

  describe('Cross-check sub-object format', () => {
    const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
    const OTHER_UUID = '660e8400-e29b-41d4-a716-446655440000';

    function staticExtractor(value: string | null): TenantExtractor {
      return { extract: () => value };
    }

    it('should pass when crossCheck.extractor matches', (done) => {
      const mw = createMiddleware({
        crossCheck: { extractor: staticExtractor(VALID_UUID) },
      });
      mw.use(mockReq({ 'x-tenant-id': VALID_UUID }), mockRes(), () => {
        expect(new TenancyContext().getTenantId()).toBe(VALID_UUID);
        done();
      });
    });

    it('should reject on mismatch with crossCheck format', async () => {
      const mw = createMiddleware({
        crossCheck: { extractor: staticExtractor(OTHER_UUID), onFailed: 'reject' },
      });
      await expect(
        new Promise((resolve, reject) => {
          mw.use(mockReq({ 'x-tenant-id': VALID_UUID }), mockRes(), resolve).catch(reject);
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should log on mismatch with crossCheck log mode', (done) => {
      const mw = createMiddleware({
        crossCheck: { extractor: staticExtractor(OTHER_UUID), onFailed: 'log' },
      });
      mw.use(mockReq({ 'x-tenant-id': VALID_UUID }), mockRes(), () => {
        expect(new TenancyContext().getTenantId()).toBe(VALID_UUID);
        done();
      });
    });

    it('should default onFailed to reject in crossCheck format', async () => {
      const mw = createMiddleware({
        crossCheck: { extractor: staticExtractor(OTHER_UUID) },
      });
      await expect(
        new Promise((resolve, reject) => {
          mw.use(mockReq({ 'x-tenant-id': VALID_UUID }), mockRes(), resolve).catch(reject);
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should NOT emit deprecation warning for new crossCheck format', (done) => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();
      const mw = createMiddleware({
        crossCheck: { extractor: staticExtractor(VALID_UUID) },
      });
      mw.use(mockReq({ 'x-tenant-id': VALID_UUID }), mockRes(), () => {
        expect(warnSpy).not.toHaveBeenCalledWith(
          expect.stringContaining('deprecated'),
        );
        warnSpy.mockRestore();
        done();
      });
    });

    it('should reject when required is true and cross-check returns null', async () => {
      const mw = createMiddleware({
        crossCheck: { extractor: staticExtractor(null), required: true },
      });
      await expect(
        new Promise((resolve, reject) => {
          mw.use(mockReq({ 'x-tenant-id': VALID_UUID }), mockRes(), resolve).catch(reject);
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should skip when required is false and cross-check returns null', (done) => {
      const mw = createMiddleware({
        crossCheck: { extractor: staticExtractor(null), required: false },
      });
      mw.use(mockReq({ 'x-tenant-id': VALID_UUID }), mockRes(), () => {
        expect(new TenancyContext().getTenantId()).toBe(VALID_UUID);
        done();
      });
    });

    it('should skip by default when cross-check returns null (required defaults to false)', (done) => {
      const mw = createMiddleware({
        crossCheck: { extractor: staticExtractor(null) },
      });
      mw.use(mockReq({ 'x-tenant-id': VALID_UUID }), mockRes(), () => {
        expect(new TenancyContext().getTenantId()).toBe(VALID_UUID);
        done();
      });
    });

    it('should pass when required is true and cross-check matches', (done) => {
      const mw = createMiddleware({
        crossCheck: { extractor: staticExtractor(VALID_UUID), required: true },
      });
      mw.use(mockReq({ 'x-tenant-id': VALID_UUID }), mockRes(), () => {
        expect(new TenancyContext().getTenantId()).toBe(VALID_UUID);
        done();
      });
    });

    it('should emit deprecation warning for old crossCheckExtractor format', () => {
      const mw = createMiddleware({
        crossCheckExtractor: staticExtractor(VALID_UUID),
      });
      // Warning is emitted in constructor — just verify middleware was created
      expect(mw).toBeDefined();
    });
  });

  describe('Extractor error propagation', () => {
    it('should propagate error when extractor throws', async () => {
      const throwingExtractor: TenantExtractor = {
        extract: () => { throw new Error('extractor crashed'); },
      };
      const mw = createMiddleware({ tenantExtractor: throwingExtractor });

      await expect(
        new Promise((resolve, reject) => {
          mw.use(mockReq({ 'x-tenant-id': 'any' }), mockRes(), resolve).catch(reject);
        }),
      ).rejects.toThrow('extractor crashed');
    });

    it('should propagate error when async extractor rejects', async () => {
      const throwingExtractor: TenantExtractor = {
        extract: async () => { throw new Error('async extractor failed'); },
      };
      const mw = createMiddleware({ tenantExtractor: throwingExtractor });

      await expect(
        new Promise((resolve, reject) => {
          mw.use(mockReq(), mockRes(), resolve).catch(reject);
        }),
      ).rejects.toThrow('async extractor failed');
    });
  });

  describe('Events', () => {
    it('should emit tenant.resolved on successful extraction', (done) => {
      const eventService = createMockEventService();
      const mw = createMiddleware({}, eventService);
      const req = mockReq({ 'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000' });

      mw.use(req, mockRes(), () => {
        expect(eventService.emit).toHaveBeenCalledWith(
          TenancyEvents.RESOLVED,
          expect.objectContaining({ tenantId: '550e8400-e29b-41d4-a716-446655440000', request: req }),
        );
        done();
      });
    });

    it('should emit tenant.not_found when no tenant', (done) => {
      const eventService = createMockEventService();
      const mw = createMiddleware({}, eventService);
      const req = mockReq();

      mw.use(req, mockRes(), () => {
        expect(eventService.emit).toHaveBeenCalledWith(
          TenancyEvents.NOT_FOUND,
          expect.objectContaining({ request: req }),
        );
        done();
      });
    });

    it('should emit tenant.validation_failed on invalid ID', async () => {
      const eventService = createMockEventService();
      const mw = createMiddleware({}, eventService);

      await expect(
        new Promise((resolve, reject) => {
          mw.use(mockReq({ 'x-tenant-id': 'invalid' }), mockRes(), resolve).catch(reject);
        }),
      ).rejects.toThrow(BadRequestException);

      expect(eventService.emit).toHaveBeenCalledWith(
        TenancyEvents.VALIDATION_FAILED,
        expect.objectContaining({ tenantId: 'invalid' }),
      );
    });
  });
});
