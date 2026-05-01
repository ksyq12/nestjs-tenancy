import { TenantContextMissingError } from '../src/errors/tenant-context-missing.error';
import { TenancyContextRequiredError } from '../src/errors/tenancy-context-required.error';

describe('TenantContextMissingError', () => {
  it('should have correct name', () => {
    const error = new TenantContextMissingError();
    expect(error.name).toBe('TenantContextMissingError');
  });

  it('should have default message', () => {
    const error = new TenantContextMissingError();
    expect(error.message).toBe('No tenant context available');
  });

  it('should accept custom message', () => {
    const error = new TenantContextMissingError('Custom message');
    expect(error.message).toBe('Custom message');
  });

  it('should be instanceof Error', () => {
    const error = new TenantContextMissingError();
    expect(error).toBeInstanceOf(Error);
  });

  it('should restore its prototype chain explicitly', () => {
    const error = new TenantContextMissingError();
    expect(Object.getPrototypeOf(error)).toBe(TenantContextMissingError.prototype);
  });

  it('should capture stack trace with the concrete constructor when available', () => {
    const captureStackTrace = jest
      .spyOn(
        Error as ErrorConstructor & {
          captureStackTrace: (targetObject: object, constructorOpt?: Function) => void;
        },
        'captureStackTrace',
      )
      .mockImplementation(() => undefined);

    const error = new TenantContextMissingError();

    expect(captureStackTrace).toHaveBeenCalledWith(error, TenantContextMissingError);
    captureStackTrace.mockRestore();
  });

  it('should be parent of TenancyContextRequiredError', () => {
    const error = new TenancyContextRequiredError('User', 'findMany');
    expect(error).toBeInstanceOf(TenantContextMissingError);
  });

  it('should NOT be instanceof TenancyContextRequiredError', () => {
    const error = new TenantContextMissingError();
    expect(error).not.toBeInstanceOf(TenancyContextRequiredError);
  });
});
