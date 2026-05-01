// Module & DI
export { TenancyModule } from './tenancy.module';
export { TENANCY_MODULE_OPTIONS } from './tenancy.constants';
export type {
  TenancyModuleOptions,
  TenancyModuleAsyncOptions,
  TenancyModuleOptionsFactory,
  TelemetryOptions,
} from './interfaces/tenancy-module-options.interface';

// Services
export { TenancyService } from './services/tenancy.service';
export { TenancyContext } from './services/tenancy-context';

// Decorators
export { CurrentTenant } from './decorators/current-tenant.decorator';
export { BypassTenancy } from './decorators/bypass-tenancy.decorator';

// Extractors
export type { TenantExtractor } from './interfaces/tenant-extractor.interface';
export { HeaderTenantExtractor } from './extractors/header.extractor';
export { SubdomainTenantExtractor } from './extractors/subdomain.extractor';
export { JwtClaimTenantExtractor } from './extractors/jwt-claim.extractor';
export { PathTenantExtractor } from './extractors/path.extractor';
export { CompositeTenantExtractor } from './extractors/composite.extractor';
export type { SubdomainExtractorOptions } from './extractors/subdomain.extractor';
export type { JwtClaimExtractorOptions } from './extractors/jwt-claim.extractor';
export type { PathExtractorOptions } from './extractors/path.extractor';

// Prisma integration
export { createPrismaTenancyExtension } from './prisma/prisma-tenancy.extension';
export type { PrismaTenancyExtensionOptions } from './prisma/prisma-tenancy.extension';
export { tenancyTransaction } from './prisma/tenancy-transaction';
export type { TenancyTransactionOptions, PrismaTransactionClient } from './prisma/tenancy-transaction';

// Errors
export { TenantContextMissingError } from './errors/tenant-context-missing.error';
export { TenancyContextRequiredError } from './errors/tenancy-context-required.error';

// Propagation
export type { TenantPropagator } from './interfaces/tenant-propagator.interface';
export type { TenantContextCarrier } from './interfaces/tenant-context-carrier.interface';
export { HttpTenantPropagator } from './propagation/http-tenant-propagator';
export type { HttpPropagationOptions } from './propagation/http-tenant-propagator';
export { propagateTenantHeaders } from './propagation/propagate-tenant-headers';
export { BullTenantPropagator } from './propagation/bull-tenant-propagator';
export type { BullPropagationOptions } from './propagation/bull-tenant-propagator';
export { KafkaTenantPropagator } from './propagation/kafka-tenant-propagator';
export type { KafkaPropagationOptions, KafkaMessageLike } from './propagation/kafka-tenant-propagator';
export { GrpcTenantPropagator } from './propagation/grpc-tenant-propagator';
export type { GrpcPropagationOptions, GrpcMetadataLike } from './propagation/grpc-tenant-propagator';
export { TenantContextInterceptor } from './propagation/tenant-context.interceptor';
export type { TenantContextInterceptorOptions } from './propagation/tenant-context.interceptor';

// Events & telemetry
export { TenancyEventService } from './events/tenancy-event.service';
export { TenancyTelemetryService } from './telemetry/tenancy-telemetry.service';
export { TenancyEvents } from './events/tenancy-events';
export type {
  TenancyEventRequestSummary,
  TenantResolvedEvent,
  TenantNotFoundEvent,
  TenantExtractionFailedEvent,
  TenantValidationFailedEvent,
  TenantContextBypassedEvent,
  TenantCrossCheckFailedEvent,
  TenancyEventMap,
} from './events/tenancy-events';

// HTTP types
export type { TenancyRequest, TenancyResponse } from './interfaces/tenancy-request.interface';
