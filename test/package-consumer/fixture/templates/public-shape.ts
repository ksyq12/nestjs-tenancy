import 'reflect-metadata';
import {
  TenancyContext,
  TenantContextDiagnostics,
  TenantContextInterceptor,
  TenancyEvents,
  TenancyService,
  type InvalidTenantContextDiagnostic,
  type TenantContextInterceptorOptions,
  type TenantIdValidator,
  type TenancyModuleOptions,
} from '@nestarc/tenancy';
import {
  TENANT_CACHE_INTERCEPTOR_OPTIONS,
  TenantCacheInterceptor,
  type TenantCacheInterceptorOptions,
} from '@nestarc/tenancy/cache';
import {
  expectTenantIsolation,
  TestTenancyModule,
  withTenant,
  type IsolationTestOptions,
  type TestTenancyModuleOptions,
} from '@nestarc/tenancy/testing';

const validateTenantId: TenantIdValidator =
  (tenantId) => tenantId.startsWith('tenant-');
const moduleOptions: TenancyModuleOptions = {
  tenantExtractor: 'x-tenant-id',
  validateTenantId,
};
const diagnostics = new TenantContextDiagnostics();
const interceptorOptions: TenantContextInterceptorOptions = {
  transport: 'kafka',
  validateTenantId,
  diagnostics,
  resource: 'package-smoke',
};
const invalidDiagnostic: InvalidTenantContextDiagnostic = {
  transport: 'kafka',
  operation: 'consume',
  resource: 'package-smoke',
};
const testModuleOptions: TestTenancyModuleOptions = moduleOptions;
const cacheOptions: TenantCacheInterceptorOptions = {
  tenantPrefix: 'package-smoke',
};
const isolationOptions: IsolationTestOptions = {
  tenantIdField: 'tenant_id',
};

async function main(): Promise<void> {
  if (
    typeof TenancyContext !== 'function' ||
    typeof TenancyService !== 'function' ||
    typeof TenantCacheInterceptor !== 'function' ||
    typeof TENANT_CACHE_INTERCEPTOR_OPTIONS !== 'symbol' ||
    typeof TestTenancyModule !== 'function' ||
    typeof withTenant !== 'function' ||
    typeof expectTenantIsolation !== 'function'
  ) {
    throw new Error('A public package runtime export is missing');
  }

  if (cacheOptions.tenantPrefix !== 'package-smoke') {
    throw new Error('Cache declaration contract was not preserved');
  }

  const context = new TenancyContext();
  const interceptor = new TenantContextInterceptor(context, interceptorOptions);
  if (
    typeof interceptor.intercept !== 'function' ||
    invalidDiagnostic.transport !== 'kafka' ||
    TenancyEvents.CONTEXT_INVALID !== 'tenant.context_invalid'
  ) {
    throw new Error('RPC validator declaration contract was not preserved');
  }
  const service = new TenancyService(context);
  const observedTenant = await withTenant(
    'tenant-package-smoke',
    () => service.getCurrentTenantOrThrow(),
    context,
  );
  if (observedTenant !== 'tenant-package-smoke') {
    throw new Error(`Unexpected tenant context: ${observedTenant}`);
  }

  const testModule = TestTenancyModule.register(testModuleOptions);
  if (testModule.module !== TestTenancyModule) {
    throw new Error('Testing subpath returned an invalid dynamic module');
  }

  await expectTenantIsolation(
    {
      async findMany() {
        return [{ tenant_id: TenancyContext.getCurrentTenantId() }];
      },
    },
    'tenant-a',
    'tenant-b',
    isolationOptions,
  );

  console.log('root/cache/testing package smoke passed');
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
