import { TenancyContext } from '../src/services/tenancy-context';

describe('TenancyContext', () => {
  let context: TenancyContext;

  beforeEach(() => {
    context = new TenancyContext();
  });

  it('should return null when no context is set', () => {
    expect(context.getTenantId()).toBeNull();
  });

  it('should store and retrieve tenant ID within run()', (done) => {
    context.run('tenant-abc', () => {
      expect(context.getTenantId()).toBe('tenant-abc');
      done();
    });
  });

  it('should return null outside of run() scope', async () => {
    await new Promise<void>((resolve) => {
      context.run('tenant-abc', () => { resolve(); });
    });
    expect(context.getTenantId()).toBeNull();
  });

  it('should handle nested contexts', (done) => {
    context.run('outer', () => {
      expect(context.getTenantId()).toBe('outer');
      context.run('inner', () => {
        expect(context.getTenantId()).toBe('inner');
        done();
      });
    });
  });

  it('should isolate concurrent contexts', async () => {
    const results: string[] = [];
    await Promise.all([
      new Promise<void>((resolve) => {
        context.run('tenant-1', async () => {
          await new Promise((r) => setTimeout(r, 10));
          results.push(context.getTenantId()!);
          resolve();
        });
      }),
      new Promise<void>((resolve) => {
        context.run('tenant-2', async () => {
          await new Promise((r) => setTimeout(r, 5));
          results.push(context.getTenantId()!);
          resolve();
        });
      }),
    ]);
    expect(results).toContain('tenant-1');
    expect(results).toContain('tenant-2');
  });

  it('should share state across different instances (static storage)', (done) => {
    const another = new TenancyContext();
    context.run('shared-tenant', () => {
      expect(another.getTenantId()).toBe('shared-tenant');
      done();
    });
  });

  describe('isBypassed', () => {
    it('should return false when no context is set', () => {
      expect(context.isBypassed()).toBe(false);
    });

    it('should return false inside run()', (done) => {
      context.run('tenant-abc', () => {
        expect(context.isBypassed()).toBe(false);
        done();
      });
    });

    it('should return true inside runWithoutTenant()', async () => {
      await context.runWithoutTenant(async () => {
        expect(context.isBypassed()).toBe(true);
      });
    });

    it('should return true inside runWithoutTenant() even when nested in run()', async () => {
      await new Promise<void>((resolve) => {
        context.run('tenant-abc', async () => {
          await context.runWithoutTenant(async () => {
            expect(context.isBypassed()).toBe(true);
            expect(context.getTenantId()).toBeNull();
          });
          expect(context.isBypassed()).toBe(false);
          resolve();
        });
      });
    });
  });

  describe('runWithoutTenant', () => {
    it('should return sync callback result without wrapping in Promise', () => {
      const result = context.runWithoutTenant(() => 'sync-result');

      expect(result).toBe('sync-result');
      expect(result).not.toBeInstanceOf(Promise);
    });

    it('should return null tenant inside runWithoutTenant()', (done) => {
      context.run('tenant-abc', () => {
        context.runWithoutTenant(() => {
          expect(context.getTenantId()).toBeNull();
          done();
        });
      });
    });

    it('should restore tenant after runWithoutTenant() completes', async () => {
      await new Promise<void>((resolve) => {
        context.run('tenant-abc', async () => {
          await context.runWithoutTenant(async () => {
            expect(context.getTenantId()).toBeNull();
          });
          expect(context.getTenantId()).toBe('tenant-abc');
          resolve();
        });
      });
    });

    it('should propagate errors from callback', async () => {
      await expect(
        context.runWithoutTenant(async () => {
          throw new Error('test error');
        }),
      ).rejects.toThrow('test error');
    });

    it('should work without existing tenant context', async () => {
      const result = await context.runWithoutTenant(async () => {
        expect(context.getTenantId()).toBeNull();
        return 'ok';
      });
      expect(result).toBe('ok');
    });
  });
});
