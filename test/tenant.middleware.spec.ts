import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TenancyContext } from '../src/services/tenancy-context';
import { TenantMiddleware } from '../src/middleware/tenant.middleware';
import { TenancyEventService } from '../src/events/tenancy-event.service';
import { TenancyTelemetryService } from '../src/telemetry/tenancy-telemetry.service';
import { TenancyEvents } from '../src/events/tenancy-events';
import { HeaderTenantExtractor } from '../src/extractors/header.extractor';
import { TenancyModuleOptions } from '../src/interfaces/tenancy-module-options.interface';
import { TenantExtractor } from '../src/interfaces/tenant-extractor.interface';
import { createMockEventService } from './__helpers__/mocks';

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

const mockReq = (headers: Record<string, string> = {}, overrides: Record<string, unknown> = {}) => ({
  headers,
  method: 'GET',
  path: '/users',
  ip: '127.0.0.1',
  ...overrides,
}) as any;
const mockRes = () => ({}) as any;

describe('TenantMiddleware', () => {
  it('should extract tenant and set context', async () => {
    const mw = createMiddleware();

    await mw.use(mockReq({ 'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000' }), mockRes(), () => {
      expect(new TenancyContext().getTenantId()).toBe('550e8400-e29b-41d4-a716-446655440000');
    });
  });

  it('should call next without context when header missing', async () => {
    const mw = createMiddleware();

    await mw.use(mockReq(), mockRes(), () => {
      expect(new TenancyContext().getTenantId()).toBeNull();
    });
  });

  describe('inbound context isolation', () => {
    const OUTER_TENANT = 'ambient-tenant-a';
    const INBOUND_TENANT = '550e8400-e29b-41d4-a716-446655440000';

    it('should neutralize ambient tenant and bypass state for a tenant-missing request', async () => {
      const context = new TenancyContext();
      const observations: Array<[string, string | null, boolean]> = [];
      const tenantExtractor: TenantExtractor = {
        extract: async () => {
          observations.push(['extract', context.getTenantId(), context.isBypassed()]);
          return null;
        },
      };
      const onTenantNotFound = jest.fn(async () => {
        observations.push(['not-found', context.getTenantId(), context.isBypassed()]);
      });
      const mw = createMiddleware({ tenantExtractor, onTenantNotFound });
      let asyncDownstream: Promise<[string, string | null, boolean]> | undefined;

      await context.run(OUTER_TENANT, async () => {
        await mw.use(mockReq(), mockRes(), () => {
          observations.push(['next', context.getTenantId(), context.isBypassed()]);
          asyncDownstream = new Promise((resolve) => {
            setImmediate(() => {
              resolve(['async-next', context.getTenantId(), context.isBypassed()]);
            });
          });
        });

        expect(context.getTenantId()).toBe(OUTER_TENANT);
        expect(context.isBypassed()).toBe(false);
        await expect(asyncDownstream).resolves.toEqual(['async-next', null, false]);
        expect(context.getTenantId()).toBe(OUTER_TENANT);
      });

      expect(observations).toEqual([
        ['extract', null, false],
        ['not-found', null, false],
        ['next', null, false],
      ]);
    });

    it('should validate in a neutral context, nest a valid inbound tenant, and restore outer tenant', async () => {
      const context = new TenancyContext();
      const observations: Array<[string, string | null, boolean]> = [];
      const tenantExtractor: TenantExtractor = {
        extract: () => {
          observations.push(['extract', context.getTenantId(), context.isBypassed()]);
          return INBOUND_TENANT;
        },
      };
      const mw = createMiddleware({
        tenantExtractor,
        validateTenantId: async () => {
          observations.push(['validate', context.getTenantId(), context.isBypassed()]);
          return true;
        },
        crossCheck: {
          extractor: {
            extract: () => {
              observations.push(['cross-check', context.getTenantId(), context.isBypassed()]);
              return INBOUND_TENANT;
            },
          },
        },
        onTenantResolved: async () => {
          observations.push(['resolved', context.getTenantId(), context.isBypassed()]);
        },
      });

      await context.run(OUTER_TENANT, async () => {
        await mw.use(mockReq(), mockRes(), () => {
          observations.push(['next', context.getTenantId(), context.isBypassed()]);
        });

        expect(context.getTenantId()).toBe(OUTER_TENANT);
      });

      expect(observations).toEqual([
        ['extract', null, false],
        ['validate', null, false],
        ['cross-check', null, false],
        ['resolved', INBOUND_TENANT, false],
        ['next', INBOUND_TENANT, false],
      ]);
    });

    it('should restore the outer tenant after a downstream throw', async () => {
      const context = new TenancyContext();
      const mw = createMiddleware();
      const downstreamError = new Error('downstream failed');

      await context.run(OUTER_TENANT, async () => {
        await expect(
          mw.use(mockReq(), mockRes(), () => {
            expect(context.getTenantId()).toBeNull();
            expect(context.isBypassed()).toBe(false);
            throw downstreamError;
          }),
        ).rejects.toBe(downstreamError);

        expect(context.getTenantId()).toBe(OUTER_TENANT);
        expect(context.isBypassed()).toBe(false);
      });
    });
  });

  it('should throw BadRequestException for invalid tenant ID', async () => {
    const mw = createMiddleware();
    await expect(
      mw.use(mockReq({ 'x-tenant-id': 'not-a-uuid' }), mockRes(), () => {}),
    ).rejects.toThrow(BadRequestException);
  });

  it('should accept custom sync validator', async () => {
    const mw = createMiddleware({ validateTenantId: (id) => id.startsWith('org_') });
    const next = jest.fn(() => {
      expect(new TenancyContext().getTenantId()).toBe('org_123');
    });

    await mw.use(mockReq({ 'x-tenant-id': 'org_123' }), mockRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('should accept async validator', async () => {
    const mw = createMiddleware({ validateTenantId: async (id) => id.startsWith('org_') });
    const next = jest.fn(() => {
      expect(new TenancyContext().getTenantId()).toBe('org_456');
    });

    await mw.use(mockReq({ 'x-tenant-id': 'org_456' }), mockRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });

  it('should propagate error when async validator throws', async () => {
    const mw = createMiddleware({
      validateTenantId: async () => { throw new Error('db connection failed'); },
    });
    await expect(
      mw.use(mockReq({ 'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000' }), mockRes(), () => {}),
    ).rejects.toThrow('db connection failed');
  });

  it('should accept TenantExtractor object', async () => {
    const mw = createMiddleware({ tenantExtractor: new HeaderTenantExtractor('x-custom') });
    const next = jest.fn(() => {
      expect(new TenancyContext().getTenantId()).toBe('550e8400-e29b-41d4-a716-446655440000');
    });

    await mw.use(
      mockReq({ 'x-custom': '550e8400-e29b-41d4-a716-446655440000' }),
      mockRes(),
      next,
    );

    expect(next).toHaveBeenCalledTimes(1);
  });

  describe('Lifecycle Hooks', () => {
    it('should call onTenantResolved after successful extraction', async () => {
      const onTenantResolved = jest.fn();
      const mw = createMiddleware({ onTenantResolved });
      const req = mockReq({ 'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000' });

      const next = jest.fn(() => {
        expect(onTenantResolved).toHaveBeenCalledWith(
          '550e8400-e29b-41d4-a716-446655440000',
          req,
        );
      });

      await mw.use(req, mockRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('should call onTenantResolved inside context.run (getCurrentTenant available)', async () => {
      const onTenantResolved = jest.fn((tenantId: string) => {
        expect(new TenancyContext().getTenantId()).toBe(tenantId);
      });
      const mw = createMiddleware({ onTenantResolved });
      const next = jest.fn();

      await mw.use(
        mockReq({ 'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000' }),
        mockRes(),
        next,
      );

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('should call onTenantNotFound when no tenant header', async () => {
      const onTenantNotFound = jest.fn();
      const mw = createMiddleware({ onTenantNotFound });
      const req = mockReq();
      const res = mockRes();

      const next = jest.fn(() => {
        expect(onTenantNotFound).toHaveBeenCalledWith(req, res);
      });

      await mw.use(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('should support async hooks', async () => {
      const onTenantResolved = jest.fn().mockResolvedValue(undefined);
      const mw = createMiddleware({ onTenantResolved });
      const next = jest.fn(() => {
        expect(onTenantResolved).toHaveBeenCalled();
      });

      await mw.use(
        mockReq({ 'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000' }),
        mockRes(),
        next,
      );

      expect(next).toHaveBeenCalledTimes(1);
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
        startTenantSpan: jest.fn().mockReturnValue(mockSpan),
        withTenantSpan: jest.fn((
          _name: string,
          _tenantId: string,
          callback: (span: { end: jest.Mock }) => unknown,
        ) => callback(mockSpan)),
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

      expect(mockTelemetry.withTenantSpan).toHaveBeenCalledWith(
        'tenant.resolved',
        '550e8400-e29b-41d4-a716-446655440000',
        expect.any(Function),
      );
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

    it('should call next() when onTenantNotFound returns void', async () => {
      const onTenantNotFound = jest.fn();  // returns undefined
      const mw = createMiddleware({ onTenantNotFound });
      const req = mockReq();
      const res = mockRes();

      const next = jest.fn(() => {
        expect(onTenantNotFound).toHaveBeenCalledWith(req, res);
      });

      await mw.use(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
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

    it('should reject removed flat cross-check options at compile time', () => {
      const extractor = staticExtractor(VALID_UUID);

      const crossCheckExtractorOptions: TenancyModuleOptions = {
        tenantExtractor: 'x-tenant-id',
        // @ts-expect-error crossCheckExtractor was removed in v0.12.0
        crossCheckExtractor: extractor,
      };
      expect(crossCheckExtractorOptions.tenantExtractor).toBe('x-tenant-id');

      const onCrossCheckFailedOptions: TenancyModuleOptions = {
        tenantExtractor: 'x-tenant-id',
        // @ts-expect-error onCrossCheckFailed was removed in v0.12.0
        onCrossCheckFailed: 'reject',
      };
      expect(onCrossCheckFailedOptions.tenantExtractor).toBe('x-tenant-id');
    });

    it('should pass when cross-check matches primary extractor', async () => {
      const mw = createMiddleware({
        crossCheck: { extractor: staticExtractor(VALID_UUID) },
      });
      const next = jest.fn(() => {
        expect(new TenancyContext().getTenantId()).toBe(VALID_UUID);
      });

      await mw.use(mockReq({ 'x-tenant-id': VALID_UUID }), mockRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('should throw ForbiddenException on mismatch (reject mode)', async () => {
      const mw = createMiddleware({
        crossCheck: { extractor: staticExtractor(OTHER_UUID), onFailed: 'reject' },
      });
      await expect(
        new Promise((resolve, reject) => {
          mw.use(mockReq({ 'x-tenant-id': VALID_UUID }), mockRes(), resolve).catch(reject);
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should log warning and continue on mismatch (log mode)', async () => {
      const mw = createMiddleware({
        crossCheck: { extractor: staticExtractor(OTHER_UUID), onFailed: 'log' },
      });
      const next = jest.fn(() => {
        // Continued with primary extractor value despite mismatch
        expect(new TenancyContext().getTenantId()).toBe(VALID_UUID);
      });

      await mw.use(mockReq({ 'x-tenant-id': VALID_UUID }), mockRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('should skip validation when cross-check returns null', async () => {
      const mw = createMiddleware({
        crossCheck: { extractor: staticExtractor(null), onFailed: 'reject' },
      });
      const next = jest.fn(() => {
        expect(new TenancyContext().getTenantId()).toBe(VALID_UUID);
      });

      await mw.use(mockReq({ 'x-tenant-id': VALID_UUID }), mockRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('should default to reject mode', async () => {
      const mw = createMiddleware({
        crossCheck: { extractor: staticExtractor(OTHER_UUID) },
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
        { crossCheck: { extractor: staticExtractor(OTHER_UUID) } },
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
          requestSummary: {
            method: 'GET',
            path: '/users',
            ip: '127.0.0.1',
          },
        }),
      );
      expect(eventService.emit.mock.calls[0][1]).not.toHaveProperty('request');
    });
  });

  describe('Cross-check sub-object format', () => {
    const VALID_UUID = '550e8400-e29b-41d4-a716-446655440000';
    const OTHER_UUID = '660e8400-e29b-41d4-a716-446655440000';

    function staticExtractor(value: string | null): TenantExtractor {
      return { extract: () => value };
    }

    it('should pass when crossCheck.extractor matches', async () => {
      const mw = createMiddleware({
        crossCheck: { extractor: staticExtractor(VALID_UUID) },
      });
      const next = jest.fn(() => {
        expect(new TenancyContext().getTenantId()).toBe(VALID_UUID);
      });

      await mw.use(mockReq({ 'x-tenant-id': VALID_UUID }), mockRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
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

    it('should log on mismatch with crossCheck log mode', async () => {
      const mw = createMiddleware({
        crossCheck: { extractor: staticExtractor(OTHER_UUID), onFailed: 'log' },
      });
      const next = jest.fn(() => {
        expect(new TenancyContext().getTenantId()).toBe(VALID_UUID);
      });

      await mw.use(mockReq({ 'x-tenant-id': VALID_UUID }), mockRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
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

    it('should NOT emit deprecation warning for new crossCheck format', async () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation();

      try {
        const mw = createMiddleware({
          crossCheck: { extractor: staticExtractor(VALID_UUID) },
        });
        const next = jest.fn(() => {
          expect(warnSpy).not.toHaveBeenCalledWith(
            expect.stringContaining('deprecated'),
          );
        });

        await mw.use(mockReq({ 'x-tenant-id': VALID_UUID }), mockRes(), next);

        expect(next).toHaveBeenCalledTimes(1);
      } finally {
        warnSpy.mockRestore();
      }
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

    it('should skip when required is false and cross-check returns null', async () => {
      const mw = createMiddleware({
        crossCheck: { extractor: staticExtractor(null), required: false },
      });
      const next = jest.fn(() => {
        expect(new TenancyContext().getTenantId()).toBe(VALID_UUID);
      });

      await mw.use(mockReq({ 'x-tenant-id': VALID_UUID }), mockRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('should skip by default when cross-check returns null (required defaults to false)', async () => {
      const mw = createMiddleware({
        crossCheck: { extractor: staticExtractor(null) },
      });
      const next = jest.fn(() => {
        expect(new TenancyContext().getTenantId()).toBe(VALID_UUID);
      });

      await mw.use(mockReq({ 'x-tenant-id': VALID_UUID }), mockRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('should pass when required is true and cross-check matches', async () => {
      const mw = createMiddleware({
        crossCheck: { extractor: staticExtractor(VALID_UUID), required: true },
      });
      const next = jest.fn(() => {
        expect(new TenancyContext().getTenantId()).toBe(VALID_UUID);
      });

      await mw.use(mockReq({ 'x-tenant-id': VALID_UUID }), mockRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
    });

  });

  describe('Extractor error propagation', () => {
    it('should propagate error when extractor throws', async () => {
      const eventService = createMockEventService();
      const throwingExtractor: TenantExtractor = {
        extract: () => { throw new Error('extractor crashed'); },
      };
      const mw = createMiddleware({ tenantExtractor: throwingExtractor }, eventService);

      await expect(
        new Promise((resolve, reject) => {
          mw.use(mockReq({ 'x-tenant-id': 'any' }), mockRes(), resolve).catch(reject);
        }),
      ).rejects.toThrow('extractor crashed');

      expect(eventService.emit).toHaveBeenCalledWith(
        TenancyEvents.EXTRACTION_FAILED,
        {
          errorName: 'Error',
          errorMessage: 'extractor crashed',
          requestSummary: {
            method: 'GET',
            path: '/users',
            ip: '127.0.0.1',
          },
        },
      );
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
    it('should emit tenant.resolved on successful extraction', async () => {
      const eventService = createMockEventService();
      const mw = createMiddleware({}, eventService);
      const req = mockReq({ 'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000' });

      const next = jest.fn(() => {
        expect(eventService.emit).toHaveBeenCalledWith(
          TenancyEvents.RESOLVED,
          expect.objectContaining({
            tenantId: '550e8400-e29b-41d4-a716-446655440000',
            requestSummary: {
              method: 'GET',
              path: '/users',
              ip: '127.0.0.1',
            },
          }),
        );
        expect(eventService.emit.mock.calls[0][1]).not.toHaveProperty('request');
      });

      await mw.use(req, mockRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('should emit tenant.not_found when no tenant', async () => {
      const eventService = createMockEventService();
      const mw = createMiddleware({}, eventService);
      const req = mockReq();

      const next = jest.fn(() => {
        expect(eventService.emit).toHaveBeenCalledWith(
          TenancyEvents.NOT_FOUND,
          expect.objectContaining({
            requestSummary: {
              method: 'GET',
              path: '/users',
              ip: '127.0.0.1',
            },
          }),
        );
        expect(eventService.emit.mock.calls[0][1]).not.toHaveProperty('request');
      });

      await mw.use(req, mockRes(), next);

      expect(next).toHaveBeenCalledTimes(1);
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
        expect.objectContaining({
          tenantId: 'invalid',
          requestSummary: {
            method: 'GET',
            path: '/users',
            ip: '127.0.0.1',
          },
        }),
      );
      expect(eventService.emit.mock.calls[0][1]).not.toHaveProperty('request');
    });
  });
});
