import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NestMiddleware,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { TenancyModuleOptions } from '../interfaces/tenancy-module-options.interface';
import { TenantExtractor } from '../interfaces/tenant-extractor.interface';
import { TenancyContext } from '../services/tenancy-context';
import { TenancyEventService } from '../events/tenancy-event.service';
import { TenancyEvents } from '../events/tenancy-events';
import { HeaderTenantExtractor } from '../extractors/header.extractor';
import { TenancyTelemetryService } from '../telemetry/tenancy-telemetry.service';
import { TENANCY_MODULE_OPTIONS, UUID_REGEX } from '../tenancy.constants';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly extractor: TenantExtractor;
  private readonly validate: (id: string) => boolean | Promise<boolean>;
  private readonly crossChecker: TenantExtractor | null;
  private readonly onCrossCheckFailed: 'reject' | 'log';
  private readonly logger = new Logger(TenantMiddleware.name);

  constructor(
    @Inject(TENANCY_MODULE_OPTIONS)
    private readonly options: TenancyModuleOptions,
    private readonly context: TenancyContext,
    private readonly eventService: TenancyEventService,
    private readonly telemetryService: TenancyTelemetryService,
  ) {
    this.extractor =
      typeof options.tenantExtractor === 'string'
        ? new HeaderTenantExtractor(options.tenantExtractor)
        : options.tenantExtractor;

    this.validate =
      options.validateTenantId ?? ((id: string) => UUID_REGEX.test(id));

    this.crossChecker = options.crossCheckExtractor ?? null;
    this.onCrossCheckFailed = options.onCrossCheckFailed ?? 'reject';
  }

  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const tenantId = await this.extractor.extract(req);

    if (!tenantId) {
      this.eventService.emit(TenancyEvents.NOT_FOUND, { request: req });
      const result = await this.options.onTenantNotFound?.(req, _res);
      if (result !== 'skip') {
        next();
      }
      return;
    }

    const isValid = await this.validate(tenantId);
    if (!isValid) {
      this.eventService.emit(TenancyEvents.VALIDATION_FAILED, { tenantId, request: req });
      throw new BadRequestException('Invalid tenant ID format');
    }

    // Cross-check: compare primary extractor result with secondary source
    if (this.crossChecker) {
      const crossCheckId = await this.crossChecker.extract(req);
      if (crossCheckId && crossCheckId !== tenantId) {
        this.eventService.emit(TenancyEvents.CROSS_CHECK_FAILED, {
          extractedTenantId: tenantId,
          crossCheckTenantId: crossCheckId,
          request: req,
        });
        if (this.onCrossCheckFailed === 'reject') {
          throw new ForbiddenException('Tenant ID mismatch');
        }
        this.logger.warn(
          `Tenant ID mismatch: extractor="${tenantId}", crossCheck="${crossCheckId}"`,
        );
      }
    }

    await this.context.run(tenantId, async () => {
      this.telemetryService.setTenantAttribute(tenantId);
      const span = this.telemetryService.startSpan('tenant.resolved');

      await this.options.onTenantResolved?.(tenantId, req);
      this.eventService.emit(TenancyEvents.RESOLVED, { tenantId, request: req });

      this.telemetryService.endSpan(span);
      next();
    });
  }
}
