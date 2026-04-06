import { TenancyRequest } from './tenancy-request.interface';

export interface TenantExtractor {
  extract(request: TenancyRequest): string | null | Promise<string | null>;
}
