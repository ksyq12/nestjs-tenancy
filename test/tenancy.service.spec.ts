import { TenancyContext } from '../src/services/tenancy-context';
import { TenancyService } from '../src/services/tenancy.service';
import { TenancyEventService } from '../src/events/tenancy-event.service';
import { TenancyEvents } from '../src/events/tenancy-events';
import { TenantContextMissingError } from '../src/errors/tenant-context-missing.error';

function createMockEventService(): TenancyEventService & { emit: jest.Mock } {
  return { emit: jest.fn(), onModuleInit: jest.fn() } as any;
}

describe('TenancyService', () => {
  let context: TenancyContext;
  let service: TenancyService;
  let eventService: ReturnType<typeof createMockEventService>;

  beforeEach(() => {
    context = new TenancyContext();
    eventService = createMockEventService();
    service = new TenancyService(context, eventService);
  });

  describe('getCurrentTenant', () => {
    it('should return null when no tenant is set', () => {
      expect(service.getCurrentTenant()).toBeNull();
    });

    it('should return the current tenant ID', (done) => {
      context.run('tenant-123', () => {
        expect(service.getCurrentTenant()).toBe('tenant-123');
        done();
      });
    });
  });

  describe('getCurrentTenantOrThrow', () => {
    it('should throw TenantContextMissingError when no tenant is set', () => {
      expect(() => service.getCurrentTenantOrThrow()).toThrow(TenantContextMissingError);
      expect(() => service.getCurrentTenantOrThrow()).toThrow('No tenant context available');
    });

    it('should return tenant ID when set', (done) => {
      context.run('tenant-456', () => {
        expect(service.getCurrentTenantOrThrow()).toBe('tenant-456');
        done();
      });
    });
  });

  describe('isTenantBypassed', () => {
    it('should return false when no context is set', () => {
      expect(service.isTenantBypassed()).toBe(false);
    });

    it('should return false inside tenant context', (done) => {
      context.run('tenant-123', () => {
        expect(service.isTenantBypassed()).toBe(false);
        done();
      });
    });

    it('should return true inside withoutTenant()', async () => {
      await service.withoutTenant(async () => {
        expect(service.isTenantBypassed()).toBe(true);
      });
    });
  });

  describe('withoutTenant', () => {
    it('should clear tenant context inside callback', async () => {
      await new Promise<void>((resolve) => {
        context.run('tenant-123', async () => {
          await service.withoutTenant(async () => {
            expect(service.getCurrentTenant()).toBeNull();
          });
          resolve();
        });
      });
    });

    it('should restore tenant after callback completes', async () => {
      await new Promise<void>((resolve) => {
        context.run('tenant-123', async () => {
          await service.withoutTenant(async () => {
            // tenant is null here
          });
          expect(service.getCurrentTenant()).toBe('tenant-123');
          resolve();
        });
      });
    });

    it('should return callback result', async () => {
      const result = await service.withoutTenant(async () => {
        return [{ id: 1 }, { id: 2 }];
      });
      expect(result).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it('should propagate errors', async () => {
      await expect(
        service.withoutTenant(async () => {
          throw new Error('service error');
        }),
      ).rejects.toThrow('service error');
    });

    it('should emit tenant.context_bypassed event with reason withoutTenant', async () => {
      await service.withoutTenant(async () => {});
      expect(eventService.emit).toHaveBeenCalledWith(
        TenancyEvents.CONTEXT_BYPASSED,
        { reason: 'withoutTenant' },
      );
    });

    it('should emit previous tenant ID when bypassing inside tenant context', async () => {
      await new Promise<void>((resolve, reject) => {
        context.run('tenant-123', async () => {
          try {
            await service.withoutTenant(async () => {});
            expect(eventService.emit).toHaveBeenCalledWith(
              TenancyEvents.CONTEXT_BYPASSED,
              { reason: 'withoutTenant', previousTenantId: 'tenant-123' },
            );
            resolve();
          } catch (e) { reject(e); }
        });
      });
    });

    it('should work without eventService (optional injection)', async () => {
      const serviceNoEvents = new TenancyService(context);
      const result = await serviceNoEvents.withoutTenant(async () => 'ok');
      expect(result).toBe('ok');
    });
  });
});
