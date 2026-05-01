import { Test } from '@nestjs/testing';
import { EventEmitter2, EventEmitterModule } from '@nestjs/event-emitter';
import { TenancyEventService } from '../src/events/tenancy-event.service';
import { TenancyEvents } from '../src/events/tenancy-events';

describe('TenancyEventService integration with @nestjs/event-emitter', () => {
  it('should resolve EventEmitter2 from real EventEmitterModule', async () => {
    const module = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [TenancyEventService],
    }).compile();

    await module.init();

    const service = module.get(TenancyEventService);
    const emitter = module.get(EventEmitter2);

    const received: any[] = [];
    emitter.on(TenancyEvents.RESOLVED, (payload: any) => received.push(payload));

    service.emit(TenancyEvents.RESOLVED, {
      tenantId: 'test-tenant',
      requestSummary: { method: 'GET', path: '/users' },
    });

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({
      tenantId: 'test-tenant',
      requestSummary: { method: 'GET', path: '/users' },
    });

    await module.close();
  });

  it('should emit multiple event types correctly', async () => {
    const module = await Test.createTestingModule({
      imports: [EventEmitterModule.forRoot()],
      providers: [TenancyEventService],
    }).compile();

    await module.init();

    const service = module.get(TenancyEventService);
    const emitter = module.get(EventEmitter2);

    const resolved: any[] = [];
    const notFound: any[] = [];
    emitter.on(TenancyEvents.RESOLVED, (p: any) => resolved.push(p));
    emitter.on(TenancyEvents.NOT_FOUND, (p: any) => notFound.push(p));

    service.emit(TenancyEvents.RESOLVED, { tenantId: 'a' });
    service.emit(TenancyEvents.NOT_FOUND, {});
    service.emit(TenancyEvents.RESOLVED, { tenantId: 'b' });

    expect(resolved).toHaveLength(2);
    expect(notFound).toHaveLength(1);

    await module.close();
  });

  it('should work without EventEmitterModule (graceful degradation)', async () => {
    const module = await Test.createTestingModule({
      providers: [TenancyEventService],
    }).compile();

    await module.init();

    const service = module.get(TenancyEventService);

    // Should not throw
    expect(() => service.emit(TenancyEvents.RESOLVED, { tenantId: 'test' })).not.toThrow();

    await module.close();
  });
});
