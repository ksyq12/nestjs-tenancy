import { TenancyRequest } from '../interfaces/tenancy-request.interface';
import { TenantExtractor } from '../interfaces/tenant-extractor.interface';

export class CompositeTenantExtractor implements TenantExtractor {
  private readonly extractors: TenantExtractor[];

  constructor(extractors: TenantExtractor[]) {
    this.extractors = extractors;
  }

  extract(request: TenancyRequest): string | null | Promise<string | null> {
    for (let i = 0; i < this.extractors.length; i++) {
      const result = this.extractors[i].extract(request);
      if (result instanceof Promise) {
        return this.extractAsync(request, i, result);
      }
      if (result != null) return result;
    }
    return null;
  }

  private async extractAsync(
    request: TenancyRequest,
    currentIndex: number,
    pendingResult: Promise<string | null>,
  ): Promise<string | null> {
    const firstResult = await pendingResult;
    if (firstResult != null) return firstResult;

    for (let i = currentIndex + 1; i < this.extractors.length; i++) {
      const result = await this.extractors[i].extract(request);
      if (result != null) return result;
    }
    return null;
  }
}
