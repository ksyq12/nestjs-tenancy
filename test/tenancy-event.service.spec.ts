import { TenancyEventService } from '../src/events/tenancy-event.service';
import { TenancyEvents } from '../src/events/tenancy-events';

describe('TenancyEventService', () => {
  describe('when EventEmitter2 is not available', () => {
    it('should not throw on emit()', async () => {
      const moduleRef = {
        get: jest.fn().mockImplementation(() => {
          throw new Error('not found');
        }),
      };

      const service = new TenancyEventService(moduleRef as any);
      await service.onModuleInit();

      // Should silently skip
      expect(() => service.emit(TenancyEvents.RESOLVED, { tenantId: 'test' })).not.toThrow();
    });
  });

  describe('when EventEmitter2 is available', () => {
    it('should delegate emit() to the resolved emitter', async () => {
      const mockEmitter = { emit: jest.fn().mockReturnValue(true) };
      const EventEmitter2Class = class EventEmitter2 {};
      jest.mock('@nestjs/event-emitter', () => ({
        EventEmitter2: EventEmitter2Class,
      }), { virtual: true });

      const moduleRef = {
        get: jest.fn().mockReturnValue(mockEmitter),
      };

      const service = new TenancyEventService(moduleRef as any);
      await service.onModuleInit();

      const payload = { tenantId: 'test-tenant' };
      service.emit(TenancyEvents.RESOLVED, payload);

      expect(mockEmitter.emit).toHaveBeenCalledWith(TenancyEvents.RESOLVED, payload);
    });

    it('should isolate listener errors from callers', async () => {
      const mockEmitter = {
        emit: jest.fn(() => {
          throw new Error('listener failed');
        }),
      };
      const EventEmitter2Class = class EventEmitter2 {};
      jest.mock('@nestjs/event-emitter', () => ({
        EventEmitter2: EventEmitter2Class,
      }), { virtual: true });

      const moduleRef = {
        get: jest.fn().mockReturnValue(mockEmitter),
      };

      const service = new TenancyEventService(moduleRef as any);
      const loggerSpy = jest
        .spyOn((service as any).logger, 'error')
        .mockImplementation(() => undefined);
      await service.onModuleInit();

      expect(() => service.emit(TenancyEvents.RESOLVED, { tenantId: 'test' })).not.toThrow();
      expect(mockEmitter.emit).toHaveBeenCalledWith(TenancyEvents.RESOLVED, { tenantId: 'test' });
      expect(loggerSpy).toHaveBeenCalled();
      expect(loggerSpy.mock.calls[0][0]).toContain(TenancyEvents.RESOLVED);

      loggerSpy.mockRestore();
    });
  });
});
