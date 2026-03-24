import {
  BadRequestException,
  Inject,
  Injectable,
  NestMiddleware,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenancyModuleOptions } from '../interfaces/tenancy-module-options.interface';
import { TenantExtractor } from '../interfaces/tenant-extractor.interface';
import { TenancyContext } from '../services/tenancy-context';
import { HeaderTenantExtractor } from '../extractors/header.extractor';
import { TENANCY_MODULE_OPTIONS, UUID_REGEX } from '../tenancy.constants';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly extractor: TenantExtractor;
  private readonly validate: (id: string) => boolean | Promise<boolean>;

  constructor(
    @Inject(TENANCY_MODULE_OPTIONS)
    private readonly options: TenancyModuleOptions,
    private readonly context: TenancyContext,
  ) {
    this.extractor =
      typeof options.tenantExtractor === 'string'
        ? new HeaderTenantExtractor(options.tenantExtractor)
        : options.tenantExtractor;

    this.validate =
      options.validateTenantId ?? ((id: string) => UUID_REGEX.test(id));
  }

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const tenantId = await this.extractor.extract(req);

    if (!tenantId) {
      await this.options.onTenantNotFound?.(req);
      next();
      return;
    }

    const isValid = await this.validate(tenantId);
    if (!isValid) {
      throw new BadRequestException('Invalid tenant ID format');
    }

    await this.context.run(tenantId, async () => {
      await this.options.onTenantResolved?.(tenantId, req);
      next();
    });
  }
}
