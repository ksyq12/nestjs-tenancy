import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenancyGuard } from '../src/guards/tenancy.guard';
import { TenancyContext } from '../src/services/tenancy-context';
import { TenancyEventService } from '../src/events/tenancy-event.service';
import { TenancyEvents } from '../src/events/tenancy-events';

function createMockContext(
  type: string = 'http',
  handler: Function = () => {},
  classRef: Function = class {},
  request: Record<string, unknown> = {
    headers: { 'user-agent': 'jest' },
    method: 'GET',
    path: '/health',
    ip: '127.0.0.1',
  },
): ExecutionContext {
  return {
    getType: () => type,
    getHandler: () => handler,
    getClass: () => classRef,
    switchToHttp: () => ({ getRequest: () => request }),
  } as any;
}

function createMockEventService(): TenancyEventService & { emit: jest.Mock } {
  return { emit: jest.fn(), onModuleInit: jest.fn() } as any;
}

describe('TenancyGuard', () => {
  let context: TenancyContext;
  let reflector: Reflector;
  let eventService: ReturnType<typeof createMockEventService>;
  let guard: TenancyGuard;

  beforeEach(() => {
    context = new TenancyContext();
    reflector = new Reflector();
    eventService = createMockEventService();
    guard = new TenancyGuard(context, reflector, eventService);
  });

  it('should allow when tenant is present', (done) => {
    context.run('tenant-123', () => {
      expect(guard.canActivate(createMockContext())).toBe(true);
      done();
    });
  });

  it('should throw ForbiddenException when tenant is missing', () => {
    expect(() => guard.canActivate(createMockContext())).toThrow(ForbiddenException);
  });

  it('should skip non-HTTP contexts (ws)', () => {
    expect(guard.canActivate(createMockContext('ws'))).toBe(true);
  });

  it('should skip non-HTTP contexts (rpc)', () => {
    expect(guard.canActivate(createMockContext('rpc'))).toBe(true);
  });

  it('should skip when @BypassTenancy is set', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    expect(guard.canActivate(createMockContext())).toBe(true);
  });

  it('should emit tenant.context_bypassed when @BypassTenancy is set', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    guard.canActivate(createMockContext());
    expect(eventService.emit).toHaveBeenCalledWith(
      TenancyEvents.CONTEXT_BYPASSED,
      {
        reason: 'decorator',
        requestSummary: {
          method: 'GET',
          path: '/health',
          ip: '127.0.0.1',
          userAgent: 'jest',
        },
      },
    );
  });

  it('should NOT emit events when tenant is present', (done) => {
    context.run('tenant-123', () => {
      guard.canActivate(createMockContext());
      expect(eventService.emit).not.toHaveBeenCalled();
      done();
    });
  });
});
