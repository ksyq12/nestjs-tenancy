import { Request } from 'express';
import { TenantExtractor } from '../interfaces/tenant-extractor.interface';

export class CompositeTenantExtractor implements TenantExtractor {
  private readonly extractors: TenantExtractor[];

  constructor(extractors: TenantExtractor[]) {
    this.extractors = extractors;
  }

  async extract(request: Request): Promise<string | null> {
    for (const extractor of this.extractors) {
      const result = await extractor.extract(request);
      if (result != null) return result;
    }
    return null;
  }
}
