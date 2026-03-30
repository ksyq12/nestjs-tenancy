import { TenancyEventService } from '../src/events/tenancy-event.service';

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
      expect(() => service.emit('tenant.resolved', { tenantId: 'test' })).not.toThrow();
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
      service.emit('tenant.resolved', payload);

      expect(mockEmitter.emit).toHaveBeenCalledWith('tenant.resolved', payload);
    });
  });
});
