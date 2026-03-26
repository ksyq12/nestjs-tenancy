# v0.3.0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement 4 features for v0.3.0 — programmatic bypass (`withoutTenant()`), subdomain ccTLD support (`psl`), interactive transaction support (hybrid), and CLI scaffolding tool.

**Architecture:** Each feature is independent and can be implemented/tested in isolation. All changes are additive (backward compatible). TDD throughout — write failing tests first, then implement.

**Tech Stack:** NestJS 10/11, Prisma 5/6, PostgreSQL 16, Jest 29, TypeScript 5, `psl` (optional), `prompts` (optional)

**Spec:** `docs/superpowers/specs/2026-03-26-v030-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `src/prisma/tenancy-transaction.ts` | `tenancyTransaction()` helper for interactive transactions |
| `src/cli/index.ts` | CLI entry point (bin command routing) |
| `src/cli/init.ts` | `init` command logic (prompts + file generation) |
| `src/cli/prisma-schema-parser.ts` | Parse `schema.prisma` for model names + `@@map` |
| `src/cli/templates/setup-sql.ts` | SQL template generator |
| `src/cli/templates/module-setup.ts` | Module config template generator |
| `test/tenancy-transaction.spec.ts` | Unit tests for transaction helper |
| `test/cli/prisma-schema-parser.spec.ts` | Schema parser unit tests |
| `test/cli/init.spec.ts` | CLI init command unit tests |

### Modified Files
| File | What Changes |
|------|-------------|
| `src/services/tenancy-context.ts` | Add `runWithoutTenant()` method |
| `src/services/tenancy.service.ts` | Add `withoutTenant()` public method |
| `src/extractors/subdomain.extractor.ts` | Replace manual split with `psl.parse()` |
| `src/prisma/prisma-tenancy.extension.ts` | Add `experimentalTransactionSupport` option |
| `src/index.ts` | Export `tenancyTransaction` |
| `package.json` | Add `bin`, `optionalDependencies`, bump to 0.3.0 |
| `tsconfig.build.json` | No change needed — `src/cli/` already included by default (verify only) |
| `test/tenancy-context.spec.ts` | Add `runWithoutTenant()` tests |
| `test/tenancy.service.spec.ts` | Add `withoutTenant()` tests |
| `test/subdomain.extractor.spec.ts` | Add ccTLD, localhost, IP tests |
| `test/prisma-tenancy.extension.spec.ts` | Add experimental transaction tests |
| `test/e2e/prisma-extension.e2e-spec.ts` | Add bypass + interactive transaction E2E |

---

## Task 1: `withoutTenant()` — TenancyContext

**Files:**
- Modify: `src/services/tenancy-context.ts`
- Test: `test/tenancy-context.spec.ts`

- [ ] **Step 1: Write failing tests for `runWithoutTenant()`**

Add to `test/tenancy-context.spec.ts`:

```typescript
describe('runWithoutTenant', () => {
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest test/tenancy-context.spec.ts -v`
Expected: FAIL — `context.runWithoutTenant is not a function`

- [ ] **Step 3: Implement `runWithoutTenant()` in TenancyContext**

In `src/services/tenancy-context.ts`, add method:

```typescript
runWithoutTenant<T>(callback: () => T | Promise<T>): Promise<T> {
  return Promise.resolve(
    TenancyContext.storage.run({ tenantId: null as unknown as string }, () => callback()),
  );
}
```

Full file becomes:

```typescript
import { Injectable } from '@nestjs/common';
import { AsyncLocalStorage } from 'async_hooks';

interface TenantStore {
  tenantId: string;
}

@Injectable()
export class TenancyContext {
  private static readonly storage = new AsyncLocalStorage<TenantStore>();

  run<T>(tenantId: string, callback: () => T): T {
    return TenancyContext.storage.run({ tenantId }, callback);
  }

  runWithoutTenant<T>(callback: () => T | Promise<T>): Promise<T> {
    return Promise.resolve(
      TenancyContext.storage.run({ tenantId: null as unknown as string }, () => callback()),
    );
  }

  getTenantId(): string | null {
    return TenancyContext.storage.getStore()?.tenantId ?? null;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest test/tenancy-context.spec.ts -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/tenancy-context.ts test/tenancy-context.spec.ts
git commit -m "feat: add runWithoutTenant() to TenancyContext"
```

---

## Task 2: `withoutTenant()` — TenancyService

**Files:**
- Modify: `src/services/tenancy.service.ts`
- Test: `test/tenancy.service.spec.ts`

- [ ] **Step 1: Write failing tests for `withoutTenant()`**

Add to `test/tenancy.service.spec.ts`:

```typescript
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest test/tenancy.service.spec.ts -v`
Expected: FAIL — `service.withoutTenant is not a function`

- [ ] **Step 3: Implement `withoutTenant()` in TenancyService**

In `src/services/tenancy.service.ts`, add method:

```typescript
async withoutTenant<T>(callback: () => T | Promise<T>): Promise<T> {
  return this.context.runWithoutTenant(callback);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest test/tenancy.service.spec.ts -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/services/tenancy.service.ts test/tenancy.service.spec.ts
git commit -m "feat: add withoutTenant() to TenancyService"
```

---

## Task 3: Subdomain ccTLD — `psl` integration

**Files:**
- Modify: `src/extractors/subdomain.extractor.ts`
- Modify: `package.json`
- Test: `test/subdomain.extractor.spec.ts`

- [ ] **Step 1: Install `psl`**

```bash
npm install psl --save-optional
```

Verify: `package.json` has `"optionalDependencies": { "psl": "..." }`

- [ ] **Step 2: Write failing tests for ccTLD support**

Replace `test/subdomain.extractor.spec.ts` entirely:

```typescript
import { SubdomainTenantExtractor } from '../src/extractors/subdomain.extractor';

describe('SubdomainTenantExtractor', () => {
  it('should extract subdomain from hostname', () => {
    const extractor = new SubdomainTenantExtractor();
    const req = { hostname: 'tenant1.app.com' } as any;
    expect(extractor.extract(req)).toBe('tenant1');
  });

  it('should return null when no subdomain', () => {
    const extractor = new SubdomainTenantExtractor();
    const req = { hostname: 'app.com' } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should exclude www by default', () => {
    const extractor = new SubdomainTenantExtractor();
    const req = { hostname: 'www.app.com' } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should support custom exclude list', () => {
    const extractor = new SubdomainTenantExtractor({
      excludeSubdomains: ['www', 'api'],
    });
    const req = { hostname: 'api.app.com' } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should extract from deep subdomain', () => {
    const extractor = new SubdomainTenantExtractor();
    const req = { hostname: 'tenant1.us-east.app.com' } as any;
    expect(extractor.extract(req)).toBe('tenant1');
  });

  it('should return null for localhost', () => {
    const extractor = new SubdomainTenantExtractor();
    const req = { hostname: 'localhost' } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  // New ccTLD tests
  it('should extract subdomain from ccTLD (co.uk)', () => {
    const extractor = new SubdomainTenantExtractor();
    const req = { hostname: 'tenant1.example.co.uk' } as any;
    expect(extractor.extract(req)).toBe('tenant1');
  });

  it('should return null for bare ccTLD domain', () => {
    const extractor = new SubdomainTenantExtractor();
    const req = { hostname: 'example.co.uk' } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should extract subdomain from co.jp', () => {
    const extractor = new SubdomainTenantExtractor();
    const req = { hostname: 'tenant1.example.co.jp' } as any;
    expect(extractor.extract(req)).toBe('tenant1');
  });

  it('should exclude www from ccTLD', () => {
    const extractor = new SubdomainTenantExtractor();
    const req = { hostname: 'www.example.co.uk' } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should return null for IP address', () => {
    const extractor = new SubdomainTenantExtractor();
    const req = { hostname: '192.168.1.1' } as any;
    expect(extractor.extract(req)).toBeNull();
  });

  it('should handle com.au TLD', () => {
    const extractor = new SubdomainTenantExtractor();
    const req = { hostname: 'tenant1.example.com.au' } as any;
    expect(extractor.extract(req)).toBe('tenant1');
  });
});
```

- [ ] **Step 3: Run tests to verify new tests fail**

Run: `npx jest test/subdomain.extractor.spec.ts -v`
Expected: ccTLD tests FAIL (`example.co.uk` incorrectly returns `'example'` instead of `null`)

- [ ] **Step 4: Implement `psl`-based extractor**

Replace `src/extractors/subdomain.extractor.ts`:

```typescript
import { Request } from 'express';
import { TenantExtractor } from '../interfaces/tenant-extractor.interface';

export interface SubdomainExtractorOptions {
  excludeSubdomains?: string[];
}

let pslModule: typeof import('psl') | null = null;

function loadPsl(): typeof import('psl') {
  if (pslModule) return pslModule;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    pslModule = require('psl');
    return pslModule!;
  } catch {
    throw new Error(
      'SubdomainTenantExtractor requires the "psl" package. Install it: npm install psl',
    );
  }
}

export class SubdomainTenantExtractor implements TenantExtractor {
  private readonly excludes: Set<string>;
  private readonly psl: typeof import('psl');

  constructor(options?: SubdomainExtractorOptions) {
    this.excludes = new Set(
      (options?.excludeSubdomains ?? ['www']).map((s) => s.toLowerCase()),
    );
    this.psl = loadPsl();
  }

  extract(request: Request): string | null {
    const hostname = request.hostname;
    const parsed = this.psl.parse(hostname);

    if ('error' in parsed || !('subdomain' in parsed) || !parsed.subdomain) {
      return null;
    }

    const parts = parsed.subdomain.split('.');
    const subdomain = parts[0].toLowerCase();

    if (this.excludes.has(subdomain)) return null;
    return subdomain;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest test/subdomain.extractor.spec.ts -v`
Expected: ALL PASS

- [ ] **Step 6: Run full test suite to check no regressions**

Run: `npx jest --testPathIgnorePatterns=e2e -v`
Expected: ALL 84+ tests PASS

- [ ] **Step 7: Commit**

```bash
git add src/extractors/subdomain.extractor.ts test/subdomain.extractor.spec.ts package.json package-lock.json
git commit -m "feat: add ccTLD support to SubdomainTenantExtractor via psl

BREAKING CHANGE: SubdomainTenantExtractor now requires the 'psl' package.
Install it: npm install psl"
```

---

## Task 4: `tenancyTransaction()` helper function

**Files:**
- Create: `src/prisma/tenancy-transaction.ts`
- Modify: `src/index.ts`
- Test: `test/tenancy-transaction.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `test/tenancy-transaction.spec.ts`:

```typescript
import { TenancyContext } from '../src/services/tenancy-context';
import { TenancyService } from '../src/services/tenancy.service';
import { tenancyTransaction } from '../src/prisma/tenancy-transaction';

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

    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = { $executeRaw: jest.fn().mockResolvedValue(1) };
      return cb(mockTx);
    });

    await new Promise<void>((resolve, reject) => {
      context.run('tenant-123', async () => {
        try {
          const result = await tenancyTransaction(
            mockPrisma, service, async () => 'callback-result',
          );
          expect(result).toBe('callback-result');
          expect(mockTransaction).toHaveBeenCalledTimes(1);
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
            mockPrisma, service, async () => 'ok', { timeout: 5000 },
          );
          expect(mockTransaction).toHaveBeenCalledWith(
            expect.any(Function),
            { timeout: 5000 },
          );
          resolve();
        } catch (e) { reject(e); }
      });
    });
  });

  it('should use custom dbSettingKey', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();

    mockTransaction.mockImplementation(async (cb: any) => {
      const mockTx = { $executeRaw: jest.fn().mockResolvedValue(1) };
      const result = await cb(mockTx);
      expect(mockTx.$executeRaw).toHaveBeenCalledTimes(1);
      return result;
    });

    await new Promise<void>((resolve, reject) => {
      context.run('tenant-123', async () => {
        try {
          await tenancyTransaction(
            mockPrisma, service, async () => 'ok',
            { dbSettingKey: 'custom.tenant' },
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest test/tenancy-transaction.spec.ts -v`
Expected: FAIL — cannot resolve `../src/prisma/tenancy-transaction`

- [ ] **Step 3: Implement `tenancyTransaction()`**

Create `src/prisma/tenancy-transaction.ts`:

```typescript
import { TenancyService } from '../services/tenancy.service';
import { DEFAULT_DB_SETTING_KEY } from '../tenancy.constants';

export interface TenancyTransactionOptions {
  timeout?: number;
  isolationLevel?: string;
  dbSettingKey?: string;
}

/**
 * Executes a Prisma interactive transaction with RLS tenant context.
 *
 * Runs `set_config()` as the first statement inside the interactive
 * transaction, ensuring the PostgreSQL session variable is set on the
 * same connection that executes the callback queries.
 *
 * Usage:
 * ```typescript
 * await tenancyTransaction(prisma, tenancyService, async (tx) => {
 *   const user = await tx.user.findFirst();
 *   await tx.order.create({ data: { userId: user.id } });
 * });
 * ```
 *
 * @param prisma - PrismaClient instance (not extended — raw client)
 * @param tenancyService - TenancyService to read current tenant
 * @param callback - Function receiving the transaction client
 * @param options - Transaction timeout, isolation level, and DB setting key
 */
export async function tenancyTransaction<T>(
  prisma: any,
  tenancyService: TenancyService,
  callback: (tx: any) => Promise<T>,
  options?: TenancyTransactionOptions,
): Promise<T> {
  const tenantId = tenancyService.getCurrentTenantOrThrow();
  const settingKey = options?.dbSettingKey ?? DEFAULT_DB_SETTING_KEY;

  return prisma.$transaction(
    async (tx: any) => {
      await tx.$executeRaw`SELECT set_config(${settingKey}, ${tenantId}, TRUE)`;
      return callback(tx);
    },
    {
      ...(options?.timeout !== undefined && { timeout: options.timeout }),
      ...(options?.isolationLevel !== undefined && {
        isolationLevel: options.isolationLevel,
      }),
    },
  );
}
```

- [ ] **Step 4: Export from index.ts**

Add to `src/index.ts`:

```typescript
export { tenancyTransaction } from './prisma/tenancy-transaction';
export type { TenancyTransactionOptions } from './prisma/tenancy-transaction';
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx jest test/tenancy-transaction.spec.ts -v`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/prisma/tenancy-transaction.ts src/index.ts test/tenancy-transaction.spec.ts
git commit -m "feat: add tenancyTransaction() helper for interactive transactions"
```

---

## Task 5: `experimentalTransactionSupport` in Prisma extension

**Files:**
- Modify: `src/prisma/prisma-tenancy.extension.ts`
- Test: `test/prisma-tenancy.extension.spec.ts`

- [ ] **Step 1: Write failing tests for experimental mode**

Add to `test/prisma-tenancy.extension.spec.ts`:

```typescript
describe('experimentalTransactionSupport', () => {
  function getHandlerWithExperimental(mockPrisma: any) {
    capturedFactory = null;
    createPrismaTenancyExtension(service, {
      experimentalTransactionSupport: true,
    });
    const extensionConfig = capturedFactory!(mockPrisma);
    return extensionConfig.query.$allModels.$allOperations;
  }

  it('should detect interactive transaction via __internalParams', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();
    const handler = getHandlerWithExperimental(mockPrisma);

    const mockQuery = jest.fn().mockResolvedValue([{ id: 1 }]);

    await new Promise<void>((resolve, reject) => {
      context.run('tenant-id', async () => {
        try {
          await handler({
            model: 'User',
            operation: 'findMany',
            args: {},
            query: mockQuery,
            __internalParams: {
              transaction: { kind: 'itx', id: 'tx-123' },
            },
          });

          // When in itx mode, should NOT use batch transaction
          expect(mockTransaction).not.toHaveBeenCalled();
          resolve();
        } catch (e) { reject(e); }
      });
    });
  });

  it('should fall back to batch transaction when no __internalParams', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();
    const handler = getHandlerWithExperimental(mockPrisma);

    mockTransaction.mockResolvedValue([1, [{ id: 1 }]]);
    const mockQuery = jest.fn().mockReturnValue(Promise.resolve([{ id: 1 }]));

    await new Promise<void>((resolve, reject) => {
      context.run('tenant-id', async () => {
        try {
          await handler({
            model: 'User',
            operation: 'findMany',
            args: {},
            query: mockQuery,
          });

          expect(mockTransaction).toHaveBeenCalled();
          resolve();
        } catch (e) { reject(e); }
      });
    });
  });

  it('should not enable experimental mode by default', async () => {
    const { mockPrisma, mockTransaction } = buildMockPrisma();
    const handler = getHandler(mockPrisma);

    mockTransaction.mockResolvedValue([1, [{ id: 1 }]]);
    const mockQuery = jest.fn().mockReturnValue(Promise.resolve([{ id: 1 }]));

    await new Promise<void>((resolve, reject) => {
      context.run('tenant-id', async () => {
        try {
          await handler({
            model: 'User',
            operation: 'findMany',
            args: {},
            query: mockQuery,
            __internalParams: {
              transaction: { kind: 'itx', id: 'tx-123' },
            },
          });

          // Without experimental flag, should still use batch transaction
          expect(mockTransaction).toHaveBeenCalled();
          resolve();
        } catch (e) { reject(e); }
      });
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest test/prisma-tenancy.extension.spec.ts -v`
Expected: Tests expecting no batch transaction FAIL

- [ ] **Step 3: Implement experimental transaction support**

Modify `src/prisma/prisma-tenancy.extension.ts`:

Add `experimentalTransactionSupport` to `PrismaTenancyExtensionOptions`:

```typescript
export interface PrismaTenancyExtensionOptions {
  dbSettingKey?: string;
  autoInjectTenantId?: boolean;
  tenantIdField?: string;
  sharedModels?: string[];
  /**
   * EXPERIMENTAL: Enable transparent interactive transaction support.
   *
   * When enabled, the extension detects if a query runs inside an interactive
   * transaction and injects `set_config()` on the transaction's connection
   * instead of wrapping in a separate batch transaction.
   *
   * WARNING: This relies on undocumented Prisma internals (`__internalParams`).
   * It may break on Prisma version upgrades. A runtime warning is emitted if
   * the internal API is not detected.
   *
   * Tested with: Prisma 5.x, 6.x
   */
  experimentalTransactionSupport?: boolean;
}
```

First, update the `$allOperations` handler signature to accept `__internalParams`:

```typescript
async $allOperations({
  model,
  operation,
  args,
  query,
  ...rest
}: {
  model: string;
  operation: string;
  args: any;
  query: (args: any) => Promise<any>;
  [key: string]: any;
}) {
```

Add `let experimentalWarned = false;` at the top of the extension factory (inside `Prisma.defineExtension`). Then before the existing batch transaction:

```typescript
const experimentalTx = options?.experimentalTransactionSupport ?? false;

if (experimentalTx) {
  const txInfo = rest?.__internalParams?.transaction;

  if (txInfo?.kind === 'itx') {
    // Attempt to use Prisma's internal ITX client to inject set_config
    // on the same connection as the interactive transaction.
    // NOTE: _createItxClient is an undocumented internal API.
    // If unavailable (likely on most Prisma versions), falls back to
    // batch transaction with a runtime warning.
    try {
      const itxClient = (baseClient as any)._createItxClient?.(txInfo);
      if (itxClient) {
        await itxClient.$executeRaw`SELECT set_config(${settingKey}, ${tenantId}, TRUE)`;
        return query(args);
      }
    } catch {
      // Fall through to batch transaction
    }

    if (!experimentalWarned) {
      console.warn(
        '[@nestarc/tenancy] experimentalTransactionSupport: ' +
        'Prisma internal API (_createItxClient) not available for this Prisma version. ' +
        'Falling back to batch transaction. ' +
        'Use tenancyTransaction() helper for reliable interactive transaction support.',
      );
      experimentalWarned = true;
    }
  }
}
```

**Known limitation:** `_createItxClient` may not be available on current Prisma versions. The experimental flag is forward-looking — when Prisma exposes a public transaction context API, this branch will be updated. For reliable interactive transaction support today, use the `tenancyTransaction()` helper from Task 4.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest test/prisma-tenancy.extension.spec.ts -v`
Expected: ALL PASS

- [ ] **Step 5: Run full unit test suite**

Run: `npx jest --testPathIgnorePatterns=e2e`
Expected: ALL PASS

- [ ] **Step 6: Commit**

```bash
git add src/prisma/prisma-tenancy.extension.ts test/prisma-tenancy.extension.spec.ts
git commit -m "feat: add experimentalTransactionSupport to Prisma extension"
```

---

## Task 6: E2E tests — bypass + interactive transaction

**Files:**
- Modify: `test/e2e/prisma-extension.e2e-spec.ts`

- [ ] **Step 1: Add E2E test for `withoutTenant()` bypass**

Add to the existing `Prisma Extension + RLS Integration` describe block:

```typescript
it('should skip set_config when using withoutTenant()', async () => {
  const rows = await service.withoutTenant(async () => {
    return prisma.user.findMany();
  });

  // withoutTenant() makes tenantId null, extension skips set_config
  // RLS still applies (app_user role) — empty current_setting matches no rows
  expect(rows).toHaveLength(0);
});
```

- [ ] **Step 2: Add E2E test for `tenancyTransaction()` helper**

First, add import at the top of `test/e2e/prisma-extension.e2e-spec.ts`:

```typescript
import { tenancyTransaction } from '../../src/prisma/tenancy-transaction';
```

Add new describe block:

```typescript
describe('tenancyTransaction() E2E', () => {
  // Reuse constants TENANT_1, ADMIN_URL, APP_URL from top of file
  let adminClient: Client;
  let context: TenancyContext;
  let service: TenancyService;
  let basePrisma: any;

  beforeAll(async () => {
    adminClient = new Client({ connectionString: ADMIN_URL });
    await adminClient.connect();
    const setupSql = fs.readFileSync(path.join(__dirname, 'setup.sql'), 'utf-8');
    await adminClient.query(setupSql);

    const PrismaClient = require(path.join(__dirname, 'generated')).PrismaClient;
    context = new TenancyContext();
    service = new TenancyService(context);
    basePrisma = new PrismaClient({ datasourceUrl: APP_URL });
    await basePrisma.$connect();
  }, 30000);

  afterAll(async () => {
    await adminClient.query(`DELETE FROM users WHERE name = 'TxTest'`);
    if (basePrisma) await basePrisma.$disconnect();
    await adminClient.end();
  });

  it('should apply RLS inside interactive transaction', async () => {
    const rows = await new Promise<any[]>((resolve, reject) => {
      context.run(TENANT_1, async () => {
        try {
          resolve(await tenancyTransaction(basePrisma, service, async (tx) => {
            return tx.user.findMany();
          }));
        } catch (e) { reject(e); }
      });
    });
    expect(rows).toHaveLength(2);
    expect(rows.every((r: any) => r.tenant_id === TENANT_1)).toBe(true);
  });

  it('should support writes in interactive transaction', async () => {
    const user = await new Promise<any>((resolve, reject) => {
      context.run(TENANT_1, async () => {
        try {
          resolve(await tenancyTransaction(basePrisma, service, async (tx) => {
            return tx.user.create({
              data: { name: 'TxTest', email: 'tx@test.com', tenant_id: TENANT_1 },
            });
          }));
        } catch (e) { reject(e); }
      });
    });
    expect(user.name).toBe('TxTest');
    expect(user.tenant_id).toBe(TENANT_1);
  });
});
```

- [ ] **Step 3: Run E2E tests**

Run: `npm run test:e2e`
Expected: ALL PASS (requires Docker PostgreSQL)

- [ ] **Step 4: Commit**

```bash
git add test/e2e/prisma-extension.e2e-spec.ts
git commit -m "test: add E2E tests for withoutTenant() and tenancyTransaction()"
```

---

## Task 7: CLI — Prisma schema parser

**Files:**
- Create: `src/cli/prisma-schema-parser.ts`
- Test: `test/cli/prisma-schema-parser.spec.ts`

- [ ] **Step 1: Write failing tests for schema parser**

Create `test/cli/prisma-schema-parser.spec.ts`:

```typescript
import { parseModels } from '../../src/cli/prisma-schema-parser';

describe('parseModels', () => {
  it('should extract model names', () => {
    const schema = `
model User {
  id    Int    @id @default(autoincrement())
  name  String
}

model Order {
  id    Int    @id @default(autoincrement())
}
`;
    const models = parseModels(schema);
    expect(models).toEqual([
      { modelName: 'User', tableName: 'User' },
      { modelName: 'Order', tableName: 'Order' },
    ]);
  });

  it('should handle @@map for custom table names', () => {
    const schema = `
model User {
  id    Int    @id

  @@map("users")
}

model OrderItem {
  id    Int    @id

  @@map("order_items")
}
`;
    const models = parseModels(schema);
    expect(models).toEqual([
      { modelName: 'User', tableName: 'users' },
      { modelName: 'OrderItem', tableName: 'order_items' },
    ]);
  });

  it('should ignore enums and types', () => {
    const schema = `
enum Role {
  ADMIN
  USER
}

type Address {
  street String
  city   String
}

model User {
  id   Int  @id
  role Role
}
`;
    const models = parseModels(schema);
    expect(models).toEqual([
      { modelName: 'User', tableName: 'User' },
    ]);
  });

  it('should return empty array for empty schema', () => {
    expect(parseModels('')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest test/cli/prisma-schema-parser.spec.ts -v`
Expected: FAIL — cannot resolve module

- [ ] **Step 3: Implement schema parser**

Create `src/cli/prisma-schema-parser.ts`:

```typescript
export interface ParsedModel {
  modelName: string;
  tableName: string;
}

/**
 * Parse Prisma schema content to extract model names and table mappings.
 * Ignores enums, types, and views.
 */
export function parseModels(schemaContent: string): ParsedModel[] {
  const models: ParsedModel[] = [];
  const modelRegex = /^model\s+(\w+)\s*\{([^}]*)}/gm;

  let match: RegExpExecArray | null;
  while ((match = modelRegex.exec(schemaContent)) !== null) {
    const modelName = match[1];
    const body = match[2];
    const mapMatch = body.match(/@@map\("([^"]+)"\)/);
    const tableName = mapMatch ? mapMatch[1] : modelName;
    models.push({ modelName, tableName });
  }

  return models;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest test/cli/prisma-schema-parser.spec.ts -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/prisma-schema-parser.ts test/cli/prisma-schema-parser.spec.ts
git commit -m "feat: add Prisma schema parser for CLI"
```

---

## Task 8: CLI — SQL and module templates

**Files:**
- Create: `src/cli/templates/setup-sql.ts`
- Create: `src/cli/templates/module-setup.ts`

- [ ] **Step 1: Create SQL template generator**

Create `src/cli/templates/setup-sql.ts`:

```typescript
import { ParsedModel } from '../prisma-schema-parser';

export interface SetupSqlOptions {
  models: ParsedModel[];
  dbSettingKey: string;
  sharedModels: string[];
  tenantIdField: string;
}

export function generateSetupSql(options: SetupSqlOptions): string {
  const { models, dbSettingKey, sharedModels, tenantIdField } = options;
  const sharedSet = new Set(sharedModels);

  const lines: string[] = [
    '-- Generated by @nestarc/tenancy CLI',
    '-- Review and customize before running against your database.',
    '',
    '-- Create a non-superuser role for the application',
    `DO $$`,
    `BEGIN`,
    `  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN`,
    `    CREATE ROLE app_user LOGIN PASSWORD 'changeme';`,
    `  END IF;`,
    `END`,
    `$$;`,
    '',
    `GRANT USAGE ON SCHEMA public TO app_user;`,
    '',
  ];

  for (const model of models) {
    if (sharedSet.has(model.modelName)) {
      lines.push(`-- ${model.modelName} (shared model)`);
      lines.push(
        `GRANT SELECT, INSERT, UPDATE, DELETE ON "${model.tableName}" TO app_user;`,
      );
      lines.push('');
      continue;
    }

    lines.push(`-- ${model.modelName}`);
    lines.push(`ALTER TABLE "${model.tableName}" ENABLE ROW LEVEL SECURITY;`);
    lines.push(
      `CREATE POLICY tenant_isolation_${model.tableName} ON "${model.tableName}"`,
    );
    lines.push(
      `  USING (${tenantIdField} = current_setting('${dbSettingKey}', true)::text);`,
    );
    lines.push(
      `CREATE POLICY tenant_insert_${model.tableName} ON "${model.tableName}"`,
    );
    lines.push(
      `  FOR INSERT WITH CHECK (${tenantIdField} = current_setting('${dbSettingKey}', true)::text);`,
    );
    lines.push(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON "${model.tableName}" TO app_user;`,
    );
    lines.push('');
  }

  return lines.join('\n');
}
```

- [ ] **Step 2: Create module template generator**

Create `src/cli/templates/module-setup.ts`:

```typescript
export interface ModuleSetupOptions {
  extractorType: string;
  dbSettingKey: string;
  autoInjectTenantId: boolean;
  sharedModels: string[];
}

export function generateModuleSetup(options: ModuleSetupOptions): string {
  const lines: string[] = [
    '// Generated by @nestarc/tenancy CLI',
    '// Add to your AppModule imports array.',
    '',
    "import { TenancyModule } from '@nestarc/tenancy';",
    '',
    '// In your @Module({ imports: [...] })',
    'TenancyModule.forRoot({',
  ];

  switch (options.extractorType) {
    case 'Subdomain (tenant1.app.com)':
      lines.push('  tenantExtractor: new SubdomainTenantExtractor(),');
      break;
    case 'JWT Claim':
      lines.push(
        "  tenantExtractor: new JwtClaimTenantExtractor({ claimKey: 'tenant_id' }),",
      );
      break;
    case 'Path Parameter':
      lines.push(
        "  tenantExtractor: new PathTenantExtractor({ pattern: '/api/tenants/:tenantId' }),",
      );
      break;
    default:
      lines.push("  tenantExtractor: 'X-Tenant-Id',");
  }

  if (options.dbSettingKey !== 'app.current_tenant') {
    lines.push(`  dbSettingKey: '${options.dbSettingKey}',`);
  }

  lines.push('})');

  if (options.autoInjectTenantId || options.sharedModels.length > 0) {
    lines.push('');
    lines.push('// Prisma extension options:');
    lines.push('createPrismaTenancyExtension(tenancyService, {');
    if (options.autoInjectTenantId) {
      lines.push('  autoInjectTenantId: true,');
    }
    if (options.sharedModels.length > 0) {
      lines.push(
        `  sharedModels: [${options.sharedModels.map((m) => `'${m}'`).join(', ')}],`,
      );
    }
    lines.push('})');
  }

  return lines.join('\n');
}
```

- [ ] **Step 3: Commit**

```bash
git add src/cli/templates/setup-sql.ts src/cli/templates/module-setup.ts
git commit -m "feat: add SQL and module template generators for CLI"
```

---

## Task 9: CLI — `init` command + packaging

**Files:**
- Create: `src/cli/index.ts`
- Create: `src/cli/init.ts`
- Modify: `package.json`
- Test: `test/cli/init.spec.ts`

- [ ] **Step 1: Install dev dependency**

```bash
npm install --save-dev @types/prompts
npm install --save-optional prompts
```

- [ ] **Step 2: Write failing tests for init command**

Create `test/cli/init.spec.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';

jest.mock('prompts', () => jest.fn());

import { runInit } from '../../src/cli/init';

describe('CLI init', () => {
  const tmpDir = path.join(__dirname, 'tmp-init-test');

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should generate setup.sql with RLS policies', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'schema.prisma'),
      'model User {\n  id Int @id\n  tenant_id String\n}\n',
    );

    const prompts = require('prompts') as jest.Mock;
    prompts.mockResolvedValue({
      extractor: 'Header (X-Tenant-Id)',
      tenantFormat: 'UUID',
      dbSettingKey: 'app.current_tenant',
      autoInject: true,
      sharedModels: '',
    });

    await runInit({ cwd: tmpDir });

    const sqlPath = path.join(tmpDir, 'tenancy-setup.sql');
    expect(fs.existsSync(sqlPath)).toBe(true);

    const sql = fs.readFileSync(sqlPath, 'utf-8');
    expect(sql).toContain('ALTER TABLE "User" ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('app.current_tenant');
  });

  it('should generate module setup file', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'schema.prisma'),
      'model User {\n  id Int @id\n}\n',
    );

    const prompts = require('prompts') as jest.Mock;
    prompts.mockResolvedValue({
      extractor: 'Header (X-Tenant-Id)',
      tenantFormat: 'UUID',
      dbSettingKey: 'app.current_tenant',
      autoInject: false,
      sharedModels: '',
    });

    await runInit({ cwd: tmpDir });

    const modulePath = path.join(tmpDir, 'tenancy.module-setup.ts');
    expect(fs.existsSync(modulePath)).toBe(true);
    const content = fs.readFileSync(modulePath, 'utf-8');
    expect(content).toContain('TenancyModule.forRoot');
  });

  it('should handle @@map in schema', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'schema.prisma'),
      'model User {\n  id Int @id\n\n  @@map("users")\n}\n',
    );

    const prompts = require('prompts') as jest.Mock;
    prompts.mockResolvedValue({
      extractor: 'Header (X-Tenant-Id)',
      tenantFormat: 'UUID',
      dbSettingKey: 'app.current_tenant',
      autoInject: false,
      sharedModels: '',
    });

    await runInit({ cwd: tmpDir });

    const sql = fs.readFileSync(
      path.join(tmpDir, 'tenancy-setup.sql'), 'utf-8',
    );
    expect(sql).toContain('"users"');
    expect(sql).not.toContain('"User"');
  });

  it('should not overwrite without confirmation', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'schema.prisma'),
      'model User {\n  id Int @id\n}\n',
    );
    fs.writeFileSync(
      path.join(tmpDir, 'tenancy-setup.sql'), 'existing content',
    );

    const prompts = require('prompts') as jest.Mock;
    prompts
      .mockResolvedValueOnce({
        extractor: 'Header (X-Tenant-Id)',
        tenantFormat: 'UUID',
        dbSettingKey: 'app.current_tenant',
        autoInject: false,
        sharedModels: '',
      })
      .mockResolvedValueOnce({ overwrite: false });

    await runInit({ cwd: tmpDir });

    const sql = fs.readFileSync(
      path.join(tmpDir, 'tenancy-setup.sql'), 'utf-8',
    );
    expect(sql).toBe('existing content');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx jest test/cli/init.spec.ts -v`
Expected: FAIL — cannot resolve module

- [ ] **Step 4: Implement `init` command**

Create `src/cli/init.ts`:

```typescript
import * as fs from 'fs';
import * as path from 'path';
import { parseModels } from './prisma-schema-parser';
import { generateSetupSql } from './templates/setup-sql';
import { generateModuleSetup } from './templates/module-setup';

interface InitOptions {
  cwd?: string;
}

export async function runInit(options?: InitOptions): Promise<void> {
  let prompts: any;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    prompts = require('prompts');
  } catch {
    console.error(
      'The "prompts" package is required for the CLI.\n' +
      'Install it: npm install prompts',
    );
    process.exit(1);
  }

  const cwd = options?.cwd ?? process.cwd();

  const schemaPath = findSchemaFile(cwd);
  let models: ReturnType<typeof parseModels> = [];

  if (schemaPath) {
    const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
    models = parseModels(schemaContent);
    console.log(
      `Found ${models.length} model(s) in ${path.relative(cwd, schemaPath)}`,
    );
  } else {
    console.log('No schema.prisma found.');
  }

  const response = await prompts([
    {
      type: 'select',
      name: 'extractor',
      message: 'Tenant extraction strategy',
      choices: [
        { title: 'Header (X-Tenant-Id)', value: 'Header (X-Tenant-Id)' },
        { title: 'Subdomain (tenant1.app.com)', value: 'Subdomain (tenant1.app.com)' },
        { title: 'JWT Claim', value: 'JWT Claim' },
        { title: 'Path Parameter', value: 'Path Parameter' },
        { title: 'Composite (multiple)', value: 'Composite' },
      ],
    },
    {
      type: 'select',
      name: 'tenantFormat',
      message: 'Tenant ID format',
      choices: [
        { title: 'UUID', value: 'UUID' },
        { title: 'Custom', value: 'Custom' },
      ],
    },
    {
      type: 'text',
      name: 'dbSettingKey',
      message: 'Database setting key',
      initial: 'app.current_tenant',
    },
    {
      type: 'confirm',
      name: 'autoInject',
      message: 'Enable auto-inject tenant ID on writes?',
      initial: true,
    },
    {
      type: 'text',
      name: 'sharedModels',
      message: 'Shared models (comma-separated, e.g., Country,Currency)',
      initial: '',
    },
  ]);

  if (!response.extractor) return;

  const sharedModels = response.sharedModels
    ? response.sharedModels
        .split(',')
        .map((s: string) => s.trim())
        .filter(Boolean)
    : [];

  const sql = generateSetupSql({
    models,
    dbSettingKey: response.dbSettingKey,
    sharedModels,
    tenantIdField: 'tenant_id',
  });

  const moduleSetup = generateModuleSetup({
    extractorType: response.extractor,
    dbSettingKey: response.dbSettingKey,
    autoInjectTenantId: response.autoInject,
    sharedModels,
  });

  await writeFileWithConfirm(
    prompts, path.join(cwd, 'tenancy-setup.sql'), sql,
  );
  await writeFileWithConfirm(
    prompts, path.join(cwd, 'tenancy.module-setup.ts'), moduleSetup,
  );

  console.log('\nNext steps:');
  console.log('1. Add tenant_id column to your Prisma models');
  console.log('2. Run: npx prisma migrate dev');
  console.log('3. Run tenancy-setup.sql against your database');
  console.log('4. Copy the module setup into your AppModule');
}

async function writeFileWithConfirm(
  prompts: any,
  filePath: string,
  content: string,
): Promise<void> {
  if (fs.existsSync(filePath)) {
    const { overwrite } = await prompts({
      type: 'confirm',
      name: 'overwrite',
      message: `${path.basename(filePath)} already exists. Overwrite?`,
      initial: false,
    });
    if (!overwrite) {
      console.log(`Skipped ${path.basename(filePath)}`);
      return;
    }
  }
  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(`Created ${path.basename(filePath)}`);
}

function findSchemaFile(cwd: string): string | null {
  const candidates = [
    path.join(cwd, 'schema.prisma'),
    path.join(cwd, 'prisma', 'schema.prisma'),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}
```

- [ ] **Step 5: Create CLI entry point**

Create `src/cli/index.ts`:

```typescript
#!/usr/bin/env node

const args = process.argv.slice(2);
const command = args[0];

if (command === 'init') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./init')
    .runInit()
    .catch((err: Error) => {
      console.error(err.message);
      process.exit(1);
    });
} else {
  console.log('Usage: npx @nestarc/tenancy <command>');
  console.log('');
  console.log('Commands:');
  console.log('  init    Scaffold RLS policies and module configuration');
  process.exit(0);
}
```

- [ ] **Step 6: Update package.json**

Add `bin` field, `optionalDependencies`, and a `postbuild` script to inject the shebang (TypeScript strips `#!/usr/bin/env node` during compilation).

In `package.json`:
```json
{
  "bin": {
    "tenancy": "./dist/cli/index.js"
  },
  "scripts": {
    "postbuild": "echo '#!/usr/bin/env node' | cat - dist/cli/index.js > dist/cli/index.tmp && mv dist/cli/index.tmp dist/cli/index.js"
  },
  "optionalDependencies": {
    "psl": "^1.9.0",
    "prompts": "^2.4.2"
  }
}
```

Remove the `#!/usr/bin/env node` line from `src/cli/index.ts` — the postbuild script handles it.

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx jest test/cli/ -v`
Expected: ALL PASS

- [ ] **Step 8: Run full test suite + lint + build**

```bash
npm run lint && npm test && npm run build
```

Expected: ALL PASS, build succeeds, `dist/cli/index.js` exists

- [ ] **Step 9: Commit**

```bash
git add src/cli/ test/cli/ package.json package-lock.json
git commit -m "feat: add CLI tool (npx @nestarc/tenancy init)"
```

---

## Task 10: Version bump + documentation

**Files:**
- Modify: `package.json` (version)
- Modify: `CHANGELOG.md`
- Modify: `README.md`
- Modify: `docs/roadmap.md`

- [ ] **Step 1: Bump version to 0.3.0**

In `package.json`, change `"version": "0.2.0"` to `"version": "0.3.0"`.

- [ ] **Step 2: Update CHANGELOG.md**

Add v0.3.0 entry with: Added (withoutTenant, ccTLD, tenancyTransaction, experimentalTransactionSupport, CLI), Changed (SubdomainTenantExtractor requires psl), Migration Guide.

- [ ] **Step 3: Update README.md**

Add documentation for:
- `withoutTenant()` usage with code example in API Reference section
- `tenancyTransaction()` with code example
- `experimentalTransactionSupport` option with warning
- CLI usage (`npx @nestarc/tenancy init`) with example output
- ccTLD support mention in SubdomainTenantExtractor section
- **`SubdomainTenantExtractor` now requires `psl`** — add `npm install psl` instruction
- `@BypassTenancy()` + Prisma clarification (already works for HTTP endpoints)

- [ ] **Step 4: Update roadmap.md**

Mark v0.3.0 items as completed. Move remaining items to v0.4.0+.

- [ ] **Step 5: Run full test suite one final time**

```bash
npm run lint && npm run test:cov && npm run build
```

Expected: ALL PASS, coverage >= 90%, build succeeds

- [ ] **Step 6: Commit**

```bash
git add package.json CHANGELOG.md README.md docs/roadmap.md
git commit -m "docs: update README, CHANGELOG, roadmap for v0.3.0"
```

---

## Execution Summary

| Task | Feature | Steps |
|------|---------|-------|
| 1 | `runWithoutTenant()` on TenancyContext | 5 |
| 2 | `withoutTenant()` on TenancyService | 5 |
| 3 | Subdomain ccTLD with `psl` | 7 |
| 4 | `tenancyTransaction()` helper | 6 |
| 5 | `experimentalTransactionSupport` | 6 |
| 6 | E2E tests for bypass + transaction | 4 |
| 7 | CLI schema parser | 5 |
| 8 | CLI SQL + module templates | 3 |
| 9 | CLI `init` command + packaging | 9 |
| 10 | Version bump + docs | 6 |
| **Total** | | **56 steps** |
