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
});
