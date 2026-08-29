import { TenancyContext } from '../src/services/tenancy-context';
import { TenancyService } from '../src/services/tenancy.service';
import {
  tenancyTransaction,
  PrismaTransactionClient,
  PrismaTransactionContext,
} from '../src/prisma/tenancy-transaction';
import { Test } from '@nestjs/testing';
import { TenancyModule } from '../src/tenancy.module';

describe('tenancyTransaction', () => {
  let context: TenancyContext;
  let service: TenancyService;

  beforeEach(() => {
    context = new TenancyContext();
    service = new TenancyService(context);
  });

  function buildMockPrisma() {
    const mockTransaction = jest.fn();
    return { mockPrisma: { $transaction: mockTransaction }, mockTransaction };
  }

  it('should call $transaction with set_config and callback', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();
    const callOrder: string[] = [];
    const mockExecuteRaw = jest.fn().mockImplementation(async () => {
      callOrder.push('set_config');
      return 1;
    });

    mockTransaction.mockImplementation(async (cb: any) => {
      return cb({ $executeRaw: mockExecuteRaw });
    });

    await new Promise<void>((resolve, reject) => {
      context.run('tenant-123', async () => {
        try {
          const result = await tenancyTransaction(
            mockPrisma, service, async () => {
              callOrder.push('callback');
              return 'callback-result';
            },
          );
          expect(result).toBe('callback-result');
          expect(mockTransaction).toHaveBeenCalledTimes(1);
          expect(mockExecuteRaw).toHaveBeenCalledWith(
            ['SELECT set_config(', ', ', ', TRUE)'],
            'app.current_tenant',
            'tenant-123',
          );
          expect(callOrder).toEqual(['set_config', 'callback']);
          resolve();
        } catch (e) { reject(e); }
      });
    });
  });

  it('should throw when no tenant context', async () => {
    const { mockPrisma } = buildMockPrisma();
    await expect(
      tenancyTransaction(mockPrisma, service, async () => 'result'),
    ).rejects.toThrow('No tenant context available');
  });

  it('should pass transaction options', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();

    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = { $executeRaw: jest.fn().mockResolvedValue(1) };
      return cb(mockTx);
    });

    await new Promise<void>((resolve, reject) => {
      context.run('tenant-123', async () => {
        try {
          await tenancyTransaction(
            mockPrisma,
            service,
            async () => 'ok',
            { maxWait: 750, timeout: 5000 },
          );
          expect(mockTransaction).toHaveBeenCalledWith(
            expect.any(Function),
            { maxWait: 750, timeout: 5000 },
          );
          resolve();
        } catch (e) { reject(e); }
      });
    });
  });

  it('should use a custom module dbSettingKey when helper options omit it', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        TenancyModule.forRoot({
          tenantExtractor: 'x-tenant-id',
          dbSettingKey: 'custom.tenant',
        }),
      ],
    }).compile();
    const configuredService = moduleRef.get(TenancyService);
    const { mockPrisma, mockTransaction } = buildMockPrisma();

    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = { $executeRaw: jest.fn().mockResolvedValue(1) };
      const result = await cb(mockTx);
      expect(mockTx.$executeRaw).toHaveBeenCalledWith(
        ['SELECT set_config(', ', ', ', TRUE)'],
        'custom.tenant',
        'tenant-123',
      );
      return result;
    });

    try {
      await new Promise<void>((resolve, reject) => {
        context.run('tenant-123', async () => {
          try {
            await tenancyTransaction(
              mockPrisma, configuredService, async () => 'ok',
            );
            resolve();
          } catch (e) { reject(e); }
        });
      });
    } finally {
      await moduleRef.close();
    }
  });

  it('should fail before starting a transaction when dbSettingKey mismatches', async () => {
    const configuredService = new TenancyService(context, undefined, {
      dbSettingKey: 'custom.tenant',
    });
    const { mockPrisma, mockTransaction } = buildMockPrisma();
    const callback = jest.fn(async () => 'unexpected');

    await context.run('tenant-123', async () => {
      await expect(
        tenancyTransaction(mockPrisma, configuredService, callback, {
          dbSettingKey: 'other.tenant',
        }),
      ).rejects.toThrow(/dbSettingKey mismatch.*custom\.tenant.*other\.tenant/i);
    });

    expect(mockTransaction).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
  });

  it('should reject an invalid dbSettingKey before resolving tenant or starting a transaction', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();
    const callback = jest.fn(async () => 'unexpected');

    await expect(
      tenancyTransaction(mockPrisma, service, callback, {
        dbSettingKey: 'server_version',
      }),
    ).rejects.toThrow('Invalid database setting key');

    expect(mockTransaction).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
  });

  it('should accept an explicit dbSettingKey that matches the canonical value', async () => {
    const configuredService = new TenancyService(context, undefined, {
      dbSettingKey: 'custom.tenant',
    });
    const { mockPrisma, mockTransaction } = buildMockPrisma();

    mockTransaction.mockImplementation(async (cb: any) =>
      cb({ $executeRaw: jest.fn().mockResolvedValue(1) }),
    );

    await context.run('tenant-123', async () => {
      await expect(
        tenancyTransaction(
          mockPrisma,
          configuredService,
          async () => 'ok',
          { dbSettingKey: 'custom.tenant' },
        ),
      ).resolves.toBe('ok');
    });
  });

  it('should preserve standalone explicit custom dbSettingKey compatibility', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();
    const mockExecuteRaw = jest.fn().mockResolvedValue(1);

    mockTransaction.mockImplementation(async (cb: any) =>
      cb({ $executeRaw: mockExecuteRaw }),
    );

    await context.run('tenant-123', async () => {
      await tenancyTransaction(
        mockPrisma,
        service,
        async () => 'ok',
        { dbSettingKey: 'standalone.tenant' },
      );
    });

    expect(mockExecuteRaw).toHaveBeenCalledWith(
      ['SELECT set_config(', ', ', ', TRUE)'],
      'standalone.tenant',
      'tenant-123',
    );
  });

  it('should pass isolationLevel option to $transaction', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();

    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = { $executeRaw: jest.fn().mockResolvedValue(1) };
      return cb(mockTx);
    });

    await new Promise<void>((resolve, reject) => {
      context.run('tenant-123', async () => {
        try {
          await tenancyTransaction(
            mockPrisma, service, async () => 'ok',
            { isolationLevel: 'Serializable' },
          );
          expect(mockTransaction).toHaveBeenCalledWith(
            expect.any(Function),
            { isolationLevel: 'Serializable' },
          );
          resolve();
        } catch (e) { reject(e); }
      });
    });
  });

  it('should pass both timeout and isolationLevel options', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();

    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = { $executeRaw: jest.fn().mockResolvedValue(1) };
      return cb(mockTx);
    });

    await new Promise<void>((resolve, reject) => {
      context.run('tenant-123', async () => {
        try {
          await tenancyTransaction(
            mockPrisma, service, async () => 'ok',
            { timeout: 10000, isolationLevel: 'ReadCommitted' },
          );
          expect(mockTransaction).toHaveBeenCalledWith(
            expect.any(Function),
            { timeout: 10000, isolationLevel: 'ReadCommitted' },
          );
          resolve();
        } catch (e) { reject(e); }
      });
    });
  });

  it('should propagate callback errors', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();

    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = { $executeRaw: jest.fn().mockResolvedValue(1) };
      return cb(mockTx);
    });

    await new Promise<void>((resolve, reject) => {
      context.run('tenant-123', async () => {
        try {
          await expect(
            tenancyTransaction(mockPrisma, service, async () => {
              throw new Error('callback failed');
            }),
          ).rejects.toThrow('callback failed');
          resolve();
        } catch (e) { reject(e); }
      });
    });
  });

  it('should not call the callback when set_config fails', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();
    const settingError = new Error('set_config failed');
    const callback = jest.fn();

    mockTransaction.mockImplementation(async (cb: any) =>
      cb({ $executeRaw: jest.fn().mockRejectedValue(settingError) }),
    );

    await new Promise<void>((resolve, reject) => {
      context.run('tenant-123', async () => {
        try {
          await expect(
            tenancyTransaction(mockPrisma, service, callback),
          ).rejects.toBe(settingError);
          expect(callback).not.toHaveBeenCalled();
          resolve();
        } catch (e) { reject(e); }
      });
    });
  });

  it('should propagate transaction start failures without calling the callback', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();
    const startError = new Error('transaction start failed');
    const callback = jest.fn();
    mockTransaction.mockRejectedValue(startError);

    await new Promise<void>((resolve, reject) => {
      context.run('tenant-123', async () => {
        try {
          await expect(
            tenancyTransaction(mockPrisma, service, callback, { maxWait: 25 }),
          ).rejects.toBe(startError);
          expect(callback).not.toHaveBeenCalled();
          resolve();
        } catch (e) { reject(e); }
      });
    });
  });

  it('should preserve generic transaction client type in callback', async () => {
    interface MockTx extends PrismaTransactionContext {
      user: {
        findMany(): Promise<string[]>;
      };
    }

    const mockTx: MockTx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      user: {
        findMany: jest.fn().mockResolvedValue(['user-a']),
      },
    };
    const mockPrisma: PrismaTransactionClient<MockTx> = {
      $transaction: async (cb) => cb(mockTx),
    };

    await new Promise<void>((resolve, reject) => {
      context.run('tenant-123', async () => {
        try {
          const result = await tenancyTransaction(
            mockPrisma,
            service,
            async (tx) => tx.user.findMany(),
          );

          expect(result).toEqual(['user-a']);
          expect(mockTx.user.findMany).toHaveBeenCalled();
          resolve();
        } catch (e) { reject(e); }
      });
    });
  });
});
