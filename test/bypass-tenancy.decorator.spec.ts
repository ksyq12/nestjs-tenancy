import 'reflect-metadata';
import { BYPASS_TENANCY_KEY } from '../src/tenancy.constants';
import { BypassTenancy } from '../src/decorators/bypass-tenancy.decorator';

describe('BypassTenancy', () => {
  it('should set BYPASS_TENANCY_KEY metadata to true', () => {
    class TestController {
      @BypassTenancy()
      handler() {}
    }
    const metadata = Reflect.getMetadata(BYPASS_TENANCY_KEY, TestController.prototype.handler);
    expect(metadata).toBe(true);
  });
});
