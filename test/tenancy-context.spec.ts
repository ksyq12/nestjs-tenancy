import {
  runInEmptyTenancyContext,
  TenancyContext,
} from '../src/services/tenancy-context';

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
      context.run('tenant-1', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        results.push(context.getTenantId()!);
      }),
      context.run('tenant-2', async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        results.push(context.getTenantId()!);
      }),
    ]);
    expect(results).toContain('tenant-1');
    expect(results).toContain('tenant-2');
  });

  it('should propagate an async callback rejection to the caller', async () => {
    const error = new Error('context callback failed');

    await expect(
      context.run('tenant-abc', async () => {
        await Promise.resolve();
        throw error;
      }),
    ).rejects.toBe(error);
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
      await context.run('tenant-abc', async () => {
        await context.runWithoutTenant(async () => {
          expect(context.isBypassed()).toBe(true);
          expect(context.getTenantId()).toBeNull();
        });
        expect(context.isBypassed()).toBe(false);
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
      await context.run('tenant-abc', async () => {
        await context.runWithoutTenant(async () => {
          expect(context.getTenantId()).toBeNull();
        });
        expect(context.getTenantId()).toBe('tenant-abc');
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

  describe('runInEmptyTenancyContext', () => {
    it('should clear tenant and explicit bypass while restoring each outer store', async () => {
      await context.run('outer-tenant', async () => {
        await context.runWithoutTenant(async () => {
          expect(context.getTenantId()).toBeNull();
          expect(context.isBypassed()).toBe(true);

          await runInEmptyTenancyContext(async () => {
            expect(context.getTenantId()).toBeNull();
            expect(context.isBypassed()).toBe(false);
          });

          expect(context.getTenantId()).toBeNull();
          expect(context.isBypassed()).toBe(true);
        });

        expect(context.getTenantId()).toBe('outer-tenant');
        expect(context.isBypassed()).toBe(false);
      });

      expect(context.getTenantId()).toBeNull();
      expect(context.isBypassed()).toBe(false);
    });
  });
});
