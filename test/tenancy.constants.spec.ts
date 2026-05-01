import {
  BYPASS_TENANCY_KEY,
  TENANCY_MODULE_OPTIONS,
} from '../src/tenancy.constants';

describe('tenancy constants', () => {
  it('uses namespaced global symbols for duplicated package instances', () => {
    expect(TENANCY_MODULE_OPTIONS).toBe(
      Symbol.for('@nestarc/tenancy/TENANCY_MODULE_OPTIONS'),
    );
    expect(BYPASS_TENANCY_KEY).toBe(
      Symbol.for('@nestarc/tenancy/BYPASS_TENANCY_KEY'),
    );
  });
});
