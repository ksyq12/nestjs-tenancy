import { TenancyContext } from '../src/services/tenancy-context';
import { TenancyService } from '../src/services/tenancy.service';
import { createPrismaTenancyExtension } from '../src/prisma/prisma-tenancy.extension';

describe('createPrismaTenancyExtension', () => {
  let context: TenancyContext;
  let service: TenancyService;

  beforeEach(() => {
    context = new TenancyContext();
    service = new TenancyService(context);
  });

  it('should return a valid Prisma extension config', () => {
    const ext = createPrismaTenancyExtension(service);
    expect(ext).toBeDefined();
    expect(ext.query.$allOperations).toBeDefined();
  });

  it('should pass through query when no tenant context', async () => {
    const ext = createPrismaTenancyExtension(service);
    const mockQuery = jest.fn().mockResolvedValue([{ id: 1 }]);

    const result = await ext.query.$allOperations({
      args: { where: { id: 1 } },
      query: mockQuery,
      model: 'User',
      operation: 'findMany',
      __prismaRawClient: null,
    });

    expect(mockQuery).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(result).toEqual([{ id: 1 }]);
  });

  it('should use interactive transaction when tenant and raw client exist', async () => {
    const ext = createPrismaTenancyExtension(service);
    const mockExecuteRawUnsafe = jest.fn().mockResolvedValue(undefined);
    const mockTxQuery = jest.fn().mockResolvedValue([{ id: 1 }]);
    const mockTx = { $executeRawUnsafe: mockExecuteRawUnsafe, User: { findMany: mockTxQuery } };
    const mockTransaction = jest.fn().mockImplementation(async (fn) => fn(mockTx));

    await new Promise<void>((resolve) => {
      context.run('550e8400-e29b-41d4-a716-446655440000', async () => {
        await ext.query.$allOperations({
          args: { where: { id: 1 } },
          query: jest.fn(),
          model: 'User',
          operation: 'findMany',
          __prismaRawClient: { $transaction: mockTransaction },
        });
        expect(mockTransaction).toHaveBeenCalled();
        expect(mockExecuteRawUnsafe).toHaveBeenCalledWith(
          expect.stringContaining('SET LOCAL'),
        );
        expect(mockTxQuery).toHaveBeenCalledWith({ where: { id: 1 } });
        resolve();
      });
    });
  });

  it('should fall back to direct query when no raw client', async () => {
    const ext = createPrismaTenancyExtension(service);
    const mockQuery = jest.fn().mockResolvedValue([{ id: 1 }]);

    await new Promise<void>((resolve) => {
      context.run('550e8400-e29b-41d4-a716-446655440000', async () => {
        const result = await ext.query.$allOperations({
          args: { where: { id: 1 } },
          query: mockQuery,
          model: 'User',
          operation: 'findMany',
          __prismaRawClient: null,
        });
        expect(mockQuery).toHaveBeenCalled();
        expect(result).toEqual([{ id: 1 }]);
        resolve();
      });
    });
  });

  it('should use custom dbSettingKey', async () => {
    const ext = createPrismaTenancyExtension(service, { dbSettingKey: 'custom.tenant' });
    const mockExecuteRawUnsafe = jest.fn().mockResolvedValue(undefined);
    const mockTx = { $executeRawUnsafe: mockExecuteRawUnsafe, User: { findMany: jest.fn().mockResolvedValue([]) } };
    const mockTransaction = jest.fn().mockImplementation(async (fn) => fn(mockTx));

    await new Promise<void>((resolve) => {
      context.run('550e8400-e29b-41d4-a716-446655440000', async () => {
        await ext.query.$allOperations({
          args: {},
          query: jest.fn(),
          model: 'User',
          operation: 'findMany',
          __prismaRawClient: { $transaction: mockTransaction },
        });
        expect(mockExecuteRawUnsafe).toHaveBeenCalledWith(
          expect.stringContaining('custom.tenant'),
        );
        resolve();
      });
    });
  });
});
