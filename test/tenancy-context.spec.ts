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
});
