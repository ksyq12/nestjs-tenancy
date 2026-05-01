import { CompositeTenantExtractor } from '../src/extractors/composite.extractor';
import { TenantExtractor } from '../src/interfaces/tenant-extractor.interface';

const mockExtractor = (value: string | null): TenantExtractor => ({
  extract: jest.fn().mockReturnValue(value),
});

const mockAsyncExtractor = (value: string | null): TenantExtractor => ({
  extract: jest.fn().mockResolvedValue(value),
});

describe('CompositeTenantExtractor', () => {
  it('should return first non-null result', async () => {
    const extractor = new CompositeTenantExtractor([
      mockExtractor(null),
      mockExtractor('tenant-b'),
      mockExtractor('tenant-c'),
    ]);
    const req = {} as any;
    expect(await extractor.extract(req)).toBe('tenant-b');
  });

  it('should return synchronously when all extractors are synchronous', () => {
    const extractor = new CompositeTenantExtractor([
      mockExtractor(null),
      mockExtractor('sync-tenant'),
    ]);
    const result = extractor.extract({} as any);
    expect(result).toBe('sync-tenant');
    expect(result).not.toBeInstanceOf(Promise);
  });

  it('should return null when all extractors return null', async () => {
    const extractor = new CompositeTenantExtractor([
      mockExtractor(null),
      mockExtractor(null),
    ]);
    const req = {} as any;
    expect(await extractor.extract(req)).toBeNull();
  });

  it('should not call later extractors after first match', async () => {
    const third = mockExtractor('tenant-c');
    const extractor = new CompositeTenantExtractor([
      mockExtractor('tenant-a'),
      mockExtractor(null),
      third,
    ]);
    await extractor.extract({} as any);
    expect(third.extract).not.toHaveBeenCalled();
  });

  it('should support async extractors', async () => {
    const extractor = new CompositeTenantExtractor([
      mockAsyncExtractor(null),
      mockAsyncExtractor('async-tenant'),
    ]);
    expect(await extractor.extract({} as any)).toBe('async-tenant');
  });

  it('should work with single extractor', async () => {
    const extractor = new CompositeTenantExtractor([
      mockExtractor('only-one'),
    ]);
    expect(await extractor.extract({} as any)).toBe('only-one');
  });

  it('should return null with empty extractor array', async () => {
    const extractor = new CompositeTenantExtractor([]);
    expect(await extractor.extract({} as any)).toBeNull();
  });
});
