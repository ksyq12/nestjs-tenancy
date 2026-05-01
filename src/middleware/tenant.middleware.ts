import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { NestMiddleware } from '@nestjs/common';
import type { TenancyRequest, TenancyResponse } from '../interfaces/tenancy-request.interface';
import type { TenancyModuleOptions } from '../interfaces/tenancy-module-options.interface';
import type { TenantExtractor } from '../interfaces/tenant-extractor.interface';
import { TenancyContext } from '../services/tenancy-context';
import { TenancyEventService } from '../events/tenancy-event.service';
import { summarizeTenancyRequest, TenancyEvents } from '../events/tenancy-events';
import { HeaderTenantExtractor } from '../extractors/header.extractor';
import { TenancyTelemetryService } from '../telemetry/tenancy-telemetry.service';
import { TENANCY_MODULE_OPTIONS, UUID_REGEX } from '../tenancy.constants';

@Injectable()
export class TenantMiddleware implements NestMiddleware {
  private readonly extractor: TenantExtractor;
  private readonly validate: (id: string) => boolean | Promise<boolean>;
  private readonly crossChecker: TenantExtractor | null;
  private readonly onCrossCheckFailed: 'reject' | 'log';
  private readonly crossCheckRequired: boolean;
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

    if (options.crossCheck) {
      this.crossChecker = options.crossCheck.extractor;
      this.onCrossCheckFailed = options.crossCheck.onFailed ?? 'reject';
      this.crossCheckRequired = options.crossCheck.required ?? false;
    } else if (options.crossCheckExtractor) {
      this.logger.warn(
        '`crossCheckExtractor` and `onCrossCheckFailed` are deprecated. ' +
        'Use `crossCheck: { extractor, onFailed }` instead. ' +
        'The old fields will be removed in v2.0.',
      );
      this.crossChecker = options.crossCheckExtractor;
      this.onCrossCheckFailed = options.onCrossCheckFailed ?? 'reject';
      this.crossCheckRequired = false;
    } else {
      this.crossChecker = null;
      this.onCrossCheckFailed = 'reject';
      this.crossCheckRequired = false;
    }
  }

  async use(req: TenancyRequest, res: TenancyResponse, next: (error?: any) => void): Promise<void> {
    const requestSummary = summarizeTenancyRequest(req);
    let tenantId: string | null;

    try {
      tenantId = await this.extractor.extract(req);
    } catch (err) {
      this.eventService.emit(TenancyEvents.EXTRACTION_FAILED, {
        ...this.describeExtractionError(err),
        requestSummary,
      });
      throw err;
    }

    if (!tenantId) {
      this.eventService.emit(TenancyEvents.NOT_FOUND, { requestSummary });
      const result = await this.options.onTenantNotFound?.(req, res);
      if (result !== 'skip') {
        next();
      }
      return;
    }

    const isValid = await this.validate(tenantId);
    if (!isValid) {
      this.eventService.emit(TenancyEvents.VALIDATION_FAILED, { tenantId, requestSummary });
      throw new BadRequestException('Invalid tenant ID format');
    }

    // Cross-check: compare primary extractor result with secondary source
    if (this.crossChecker) {
      const crossCheckId = await this.crossChecker.extract(req);
      if (!crossCheckId && this.crossCheckRequired) {
        throw new ForbiddenException('Cross-check source is required but returned null');
      }
      if (crossCheckId && crossCheckId !== tenantId) {
        this.eventService.emit(TenancyEvents.CROSS_CHECK_FAILED, {
          extractedTenantId: tenantId,
          crossCheckTenantId: crossCheckId,
          requestSummary,
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
      await this.telemetryService.withTenantSpan('tenant.resolved', tenantId, async () => {
        await this.options.onTenantResolved?.(tenantId, req);
        this.eventService.emit(TenancyEvents.RESOLVED, { tenantId, requestSummary });
        next();
      });
    });
  }

  private describeExtractionError(err: unknown): { errorName: string; errorMessage: string } {
    if (err instanceof Error) {
      return {
        errorName: err.name,
        errorMessage: err.message,
      };
    }

    return {
      errorName: 'NonErrorThrown',
      errorMessage: String(err),
    };
  }
}
