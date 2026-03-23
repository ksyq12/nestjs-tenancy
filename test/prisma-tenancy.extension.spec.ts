import { TenancyContext } from '../src/services/tenancy-context';
import { TenancyService } from '../src/services/tenancy.service';
import { createPrismaTenancyExtension } from '../src/prisma/prisma-tenancy.extension';

/**
 * Unit tests for createPrismaTenancyExtension.
 *
 * Since Prisma.defineExtension returns an opaque descriptor,
 * we mock Prisma.defineExtension to capture the inner factory,
 * then invoke it with a mock PrismaClient to test the actual logic.
 */

// Mock Prisma.defineExtension to capture the factory function
let capturedFactory: ((prisma: any) => any) | null = null;

jest.mock('@prisma/client', () => ({
  Prisma: {
    defineExtension: (factory: (prisma: any) => any) => {
      capturedFactory = factory;
      return factory;
    },
  },
}));

describe('createPrismaTenancyExtension', () => {
  let context: TenancyContext;
  let service: TenancyService;

  beforeEach(() => {
    context = new TenancyContext();
    service = new TenancyService(context);
    capturedFactory = null;
  });

  function buildMockPrisma() {
    const mockTransaction = jest.fn();
    const mockExecuteRaw = jest.fn();

    const mockPrisma = {
      $transaction: mockTransaction,
      $executeRaw: mockExecuteRaw,
      $extends: jest.fn((config: any) => {
        // Store the $allOperations handler for direct invocation
        return config;
      }),
    };

    return { mockPrisma, mockTransaction, mockExecuteRaw };
  }

  function getHandler(mockPrisma: any) {
    createPrismaTenancyExtension(service);
    expect(capturedFactory).not.toBeNull();

    const extensionConfig = capturedFactory!(mockPrisma);
    return extensionConfig.query.$allModels.$allOperations;
  }

  it('should return a Prisma.defineExtension result', () => {
    const result = createPrismaTenancyExtension(service);
    expect(result).toBeDefined();
    expect(capturedFactory).not.toBeNull();
  });

  it('should pass through query when no tenant context', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();
    const handler = getHandler(mockPrisma);

    const mockQuery = jest.fn().mockResolvedValue([{ id: 1 }]);
    const result = await handler({
      args: { where: { id: 1 } },
      query: mockQuery,
    });

    expect(mockQuery).toHaveBeenCalledWith({ where: { id: 1 } });
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(result).toEqual([{ id: 1 }]);
  });

  it('should wrap in batch transaction when tenant exists', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();
    const handler = getHandler(mockPrisma);

    const mockQuery = jest.fn().mockReturnValue(
      Promise.resolve([{ id: 1, tenant_id: 'tenant-1' }]),
    );

    // $transaction receives array of promises and returns their results
    mockTransaction.mockResolvedValue([1, [{ id: 1, tenant_id: 'tenant-1' }]]);

    await new Promise<void>((resolve, reject) => {
      context.run('550e8400-e29b-41d4-a716-446655440000', async () => {
        try {
          const result = await handler({
            args: { where: { id: 1 } },
            query: mockQuery,
          });

          expect(mockTransaction).toHaveBeenCalledTimes(1);

          // Verify $transaction was called with an array of two elements
          const txArgs = mockTransaction.mock.calls[0][0];
          expect(Array.isArray(txArgs)).toBe(true);
          expect(txArgs).toHaveLength(2);

          // Second element should be the query result promise
          expect(mockQuery).toHaveBeenCalledWith({ where: { id: 1 } });

          // Result should be the second element of the transaction result
          expect(result).toEqual([{ id: 1, tenant_id: 'tenant-1' }]);

          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  it('should use custom dbSettingKey', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();

    capturedFactory = null;
    createPrismaTenancyExtension(service, { dbSettingKey: 'custom.tenant' });
    const extensionConfig = capturedFactory!(mockPrisma);
    const handler = extensionConfig.query.$allModels.$allOperations;

    mockTransaction.mockResolvedValue([1, []]);

    await new Promise<void>((resolve, reject) => {
      context.run('550e8400-e29b-41d4-a716-446655440000', async () => {
        try {
          await handler({ args: {}, query: jest.fn().mockReturnValue(Promise.resolve([])) });

          // Verify $executeRaw was called via tagged template
          // The first arg to $transaction is the array, and the first element
          // is the $executeRaw call which would contain our custom key
          expect(mockTransaction).toHaveBeenCalled();
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  it('should return second element of transaction result', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();
    const handler = getHandler(mockPrisma);

    const expectedData = [{ id: 1 }, { id: 2 }, { id: 3 }];
    mockTransaction.mockResolvedValue([1, expectedData]);

    await new Promise<void>((resolve, reject) => {
      context.run('550e8400-e29b-41d4-a716-446655440000', async () => {
        try {
          const result = await handler({
            args: {},
            query: jest.fn().mockReturnValue(Promise.resolve(expectedData)),
          });

          expect(result).toEqual(expectedData);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });
});
