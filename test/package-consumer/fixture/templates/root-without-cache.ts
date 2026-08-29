import 'reflect-metadata';
import {
  TenancyContext,
  TenancyService,
  type TenancyModuleOptions,
} from '@nestarc/tenancy';
import {
  TestTenancyModule,
  withTenant,
  type TestTenancyModuleOptions,
} from '@nestarc/tenancy/testing';

const moduleOptions: TenancyModuleOptions = {
  tenantExtractor: 'x-tenant-id',
};
const testModuleOptions: TestTenancyModuleOptions = moduleOptions;

async function main(): Promise<void> {
  if (
    typeof TenancyContext !== 'function' ||
    typeof TenancyService !== 'function' ||
    typeof TestTenancyModule !== 'function' ||
    typeof withTenant !== 'function'
  ) {
    throw new Error('Root/testing import requires an optional cache peer');
  }

  const context = new TenancyContext();
  const service = new TenancyService(context);
  const observedTenant = await withTenant(
    'tenant-without-cache',
    () => service.getCurrentTenantOrThrow(),
    context,
  );
  if (observedTenant !== 'tenant-without-cache') {
    throw new Error(`Unexpected tenant context: ${observedTenant}`);
  }

  const testModule = TestTenancyModule.register(testModuleOptions);
  if (testModule.module !== TestTenancyModule) {
    throw new Error('Testing subpath returned an invalid dynamic module');
  }

  console.log('root/testing package smoke passed without cache peers');
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
