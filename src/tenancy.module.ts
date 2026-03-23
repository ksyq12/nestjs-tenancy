import {
  DynamicModule,
  MiddlewareConsumer,
  Module,
  NestModule,
  Provider,
  RequestMethod,
  Type,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import {
  TenancyModuleAsyncOptions,
  TenancyModuleOptions,
  TenancyModuleOptionsFactory,
} from './interfaces/tenancy-module-options.interface';
import { TenancyContext } from './services/tenancy-context';
import { TenancyService } from './services/tenancy.service';
import { TenantMiddleware } from './middleware/tenant.middleware';
import { TenancyGuard } from './guards/tenancy.guard';
import { TENANCY_MODULE_OPTIONS } from './tenancy.constants';

@Module({})
export class TenancyModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(TenantMiddleware)
      .forRoutes({ path: '(.*)', method: RequestMethod.ALL });
  }

  static forRoot(options: TenancyModuleOptions): DynamicModule {
    return {
      module: TenancyModule,
      global: true,
      providers: [
        { provide: TENANCY_MODULE_OPTIONS, useValue: options },
        TenancyContext,
        TenancyService,
        { provide: APP_GUARD, useClass: TenancyGuard },
      ],
      exports: [TenancyService, TENANCY_MODULE_OPTIONS],
    };
  }

  static forRootAsync(options: TenancyModuleAsyncOptions): DynamicModule {
    const asyncProviders = this.createAsyncProviders(options);

    return {
      module: TenancyModule,
      global: true,
      imports: options.imports || [],
      providers: [
        ...asyncProviders,
        TenancyContext,
        TenancyService,
        { provide: APP_GUARD, useClass: TenancyGuard },
      ],
      exports: [TenancyService, TENANCY_MODULE_OPTIONS],
    };
  }

  private static createAsyncProviders(
    options: TenancyModuleAsyncOptions,
  ): Provider[] {
    if (options.useFactory) {
      return [
        {
          provide: TENANCY_MODULE_OPTIONS,
          useFactory: options.useFactory,
          inject: options.inject || [],
        },
      ];
    }

    const useClass = options.useClass as Type<TenancyModuleOptionsFactory>;
    if (useClass) {
      return [
        {
          provide: TENANCY_MODULE_OPTIONS,
          useFactory: async (factory: TenancyModuleOptionsFactory) =>
            factory.createTenancyOptions(),
          inject: [useClass],
        },
        { provide: useClass, useClass },
      ];
    }

    if (options.useExisting) {
      return [
        {
          provide: TENANCY_MODULE_OPTIONS,
          useFactory: async (factory: TenancyModuleOptionsFactory) =>
            factory.createTenancyOptions(),
          inject: [options.useExisting],
        },
      ];
    }

    return [];
  }
}
