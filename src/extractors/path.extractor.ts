import { Request } from 'express';
import { TenantExtractor } from '../interfaces/tenant-extractor.interface';

export interface PathExtractorOptions {
  pattern: string;
  paramName: string;
}

export class PathTenantExtractor implements TenantExtractor {
  private readonly patternSegments: string[];
  private readonly paramIndex: number;

  constructor(options: PathExtractorOptions) {
    this.patternSegments = options.pattern.split('/').filter(Boolean);
    this.paramIndex = this.patternSegments.findIndex(
      (seg) => seg === `:${options.paramName}`,
    );
  }

  extract(request: Request): string | null {
    if (this.paramIndex === -1) return null;

    const pathSegments = request.path.split('/').filter(Boolean);

    if (pathSegments.length < this.patternSegments.length) return null;

    for (let i = 0; i < this.patternSegments.length; i++) {
      if (i === this.paramIndex) continue;
      if (this.patternSegments[i] !== pathSegments[i]) return null;
    }

    return pathSegments[this.paramIndex];
  }
}
