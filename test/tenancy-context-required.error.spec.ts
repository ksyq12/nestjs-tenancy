import { TenancyContextRequiredError } from '../src/errors/tenancy-context-required.error';
import { TenantContextMissingError } from '../src/errors/tenant-context-missing.error';

describe('TenancyContextRequiredError', () => {
  it('should have correct name', () => {
    const error = new TenancyContextRequiredError('User', 'findMany');
    expect(error.name).toBe('TenancyContextRequiredError');
  });

  it('should store model and operation', () => {
    const error = new TenancyContextRequiredError('Order', 'create');
    expect(error.model).toBe('Order');
    expect(error.operation).toBe('create');
  });

  it('should include model name in message', () => {
    const error = new TenancyContextRequiredError('Order', 'findMany');
    expect(error.message).toContain('Order');
    expect(error.message).toContain('findMany');
    expect(error.message).toContain('withoutTenant()');
    expect(error.message).toContain('sharedModels');
  });

  it('should be an instance of Error', () => {
    const error = new TenancyContextRequiredError('User', 'findMany');
    expect(error).toBeInstanceOf(Error);
  });

  it('should restore its subclass prototype chain explicitly', () => {
    const error = new TenancyContextRequiredError('User', 'findMany');
    expect(Object.getPrototypeOf(error)).toBe(TenancyContextRequiredError.prototype);
  });

  it('should be an instance of TenantContextMissingError', () => {
    const error = new TenancyContextRequiredError('User', 'findMany');
    expect(error).toBeInstanceOf(TenantContextMissingError);
  });

  it('should serialize structured fields including message', () => {
    const error = new TenancyContextRequiredError('Order', 'create');
    expect(error.toJSON()).toEqual({
      name: 'TenancyContextRequiredError',
      message: error.message,
      model: 'Order',
      operation: 'create',
    });
  });
});
