import { BadRequestException } from '@nestjs/common';
import { TenancyContext } from '../src/services/tenancy-context';
import { TenantMiddleware } from '../src/middleware/tenant.middleware';
import { HeaderTenantExtractor } from '../src/extractors/header.extractor';
import { TenancyModuleOptions } from '../src/interfaces/tenancy-module-options.interface';

function createMiddleware(overrides: Partial<TenancyModuleOptions> = {}): TenantMiddleware {
  const options: TenancyModuleOptions = { tenantExtractor: 'x-tenant-id', ...overrides };
  return new TenantMiddleware(options, new TenancyContext());
}

const mockReq = (headers: Record<string, string> = {}) => ({ headers }) as any;
const mockRes = () => ({}) as any;

describe('TenantMiddleware', () => {
  it('should extract tenant and set context', (done) => {
    const mw = createMiddleware();
    mw.use(mockReq({ 'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000' }), mockRes(), () => {
      expect(new TenancyContext().getTenantId()).toBe('550e8400-e29b-41d4-a716-446655440000');
      done();
    });
  });

  it('should call next without context when header missing', (done) => {
    const mw = createMiddleware();
    mw.use(mockReq(), mockRes(), () => {
      expect(new TenancyContext().getTenantId()).toBeNull();
      done();
    });
  });

  it('should throw BadRequestException for invalid tenant ID', async () => {
    const mw = createMiddleware();
    await expect(
      new Promise((resolve, reject) => {
        mw.use(mockReq({ 'x-tenant-id': 'not-a-uuid' }), mockRes(), resolve).catch(reject);
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('should accept custom sync validator', (done) => {
    const mw = createMiddleware({ validateTenantId: (id) => id.startsWith('org_') });
    mw.use(mockReq({ 'x-tenant-id': 'org_123' }), mockRes(), () => {
      expect(new TenancyContext().getTenantId()).toBe('org_123');
      done();
    });
  });

  it('should accept async validator', (done) => {
    const mw = createMiddleware({ validateTenantId: async (id) => id.startsWith('org_') });
    mw.use(mockReq({ 'x-tenant-id': 'org_456' }), mockRes(), () => {
      expect(new TenancyContext().getTenantId()).toBe('org_456');
      done();
    });
  });

  it('should propagate error when async validator throws', async () => {
    const mw = createMiddleware({
      validateTenantId: async () => { throw new Error('db connection failed'); },
    });
    await expect(
      new Promise((resolve, reject) => {
        mw.use(mockReq({ 'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000' }), mockRes(), resolve).catch(reject);
      }),
    ).rejects.toThrow('db connection failed');
  });

  it('should accept TenantExtractor object', (done) => {
    const mw = createMiddleware({ tenantExtractor: new HeaderTenantExtractor('x-custom') });
    mw.use(mockReq({ 'x-custom': '550e8400-e29b-41d4-a716-446655440000' }), mockRes(), () => {
      expect(new TenancyContext().getTenantId()).toBe('550e8400-e29b-41d4-a716-446655440000');
      done();
    });
  });

  describe('Lifecycle Hooks', () => {
    it('should call onTenantResolved after successful extraction', (done) => {
      const onTenantResolved = jest.fn();
      const mw = createMiddleware({ onTenantResolved });
      const req = mockReq({ 'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000' });

      mw.use(req, mockRes(), () => {
        expect(onTenantResolved).toHaveBeenCalledWith(
          '550e8400-e29b-41d4-a716-446655440000',
          req,
        );
        done();
      });
    });

    it('should call onTenantResolved inside context.run (getCurrentTenant available)', (done) => {
      const onTenantResolved = jest.fn((tenantId: string) => {
        expect(new TenancyContext().getTenantId()).toBe(tenantId);
      });
      const mw = createMiddleware({ onTenantResolved });

      mw.use(
        mockReq({ 'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000' }),
        mockRes(),
        () => { done(); },
      );
    });

    it('should call onTenantNotFound when no tenant header', (done) => {
      const onTenantNotFound = jest.fn();
      const mw = createMiddleware({ onTenantNotFound });
      const req = mockReq();
      const res = mockRes();

      mw.use(req, res, () => {
        expect(onTenantNotFound).toHaveBeenCalledWith(req, res);
        done();
      });
    });

    it('should support async hooks', (done) => {
      const onTenantResolved = jest.fn().mockResolvedValue(undefined);
      const mw = createMiddleware({ onTenantResolved });

      mw.use(
        mockReq({ 'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000' }),
        mockRes(),
        () => {
          expect(onTenantResolved).toHaveBeenCalled();
          done();
        },
      );
    });

    it('should propagate error from hook', async () => {
      const mw = createMiddleware({
        onTenantResolved: async () => { throw new Error('audit failed'); },
      });

      await expect(
        new Promise((resolve, reject) => {
          mw.use(
            mockReq({ 'x-tenant-id': '550e8400-e29b-41d4-a716-446655440000' }),
            mockRes(),
            resolve,
          ).catch(reject);
        }),
      ).rejects.toThrow('audit failed');
    });

    it('should NOT call next() when onTenantNotFound returns "skip"', async () => {
      const onTenantNotFound = jest.fn().mockReturnValue('skip');
      const mw = createMiddleware({ onTenantNotFound });
      const next = jest.fn();
      const req = mockReq();
      const res = mockRes();

      await mw.use(req, res, next);

      expect(onTenantNotFound).toHaveBeenCalledWith(req, res);
      expect(next).not.toHaveBeenCalled();
    });

    it('should NOT call next() when async onTenantNotFound resolves "skip"', async () => {
      const onTenantNotFound = jest.fn().mockResolvedValue('skip');
      const mw = createMiddleware({ onTenantNotFound });
      const next = jest.fn();
      const req = mockReq();
      const res = mockRes();

      await mw.use(req, res, next);

      expect(onTenantNotFound).toHaveBeenCalledWith(req, res);
      expect(next).not.toHaveBeenCalled();
    });

    it('should call next() when onTenantNotFound returns void', (done) => {
      const onTenantNotFound = jest.fn();  // returns undefined
      const mw = createMiddleware({ onTenantNotFound });
      const req = mockReq();
      const res = mockRes();

      mw.use(req, res, () => {
        expect(onTenantNotFound).toHaveBeenCalledWith(req, res);
        done();
      });
    });

    it('should not call onTenantResolved when validation fails', async () => {
      const onTenantResolved = jest.fn();
      const mw = createMiddleware({ onTenantResolved });

      await expect(
        new Promise((resolve, reject) => {
          mw.use(mockReq({ 'x-tenant-id': 'invalid' }), mockRes(), resolve).catch(reject);
        }),
      ).rejects.toThrow(BadRequestException);

      expect(onTenantResolved).not.toHaveBeenCalled();
    });
  });
});
