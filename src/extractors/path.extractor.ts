import { TenancyRequest } from '../interfaces/tenancy-request.interface';
import { TenantExtractor } from '../interfaces/tenant-extractor.interface';

export interface PathExtractorOptions {
  pattern: string;
  paramName: string;
}

function pathWithoutQueryOrHash(path: string): string {
  return path.split('?')[0].split('#')[0];
}

export class PathTenantExtractor implements TenantExtractor {
  private readonly patternSegments: string[];
  private readonly paramIndex: number;

  constructor(options: PathExtractorOptions) {
    this.patternSegments = options.pattern.split('/').filter(Boolean);
    this.paramIndex = this.patternSegments.findIndex(
      (seg) => seg === `:${options.paramName}`,
    );
    if (this.paramIndex === -1) {
      throw new Error(
        `PathTenantExtractor: ":${options.paramName}" not found in pattern "${options.pattern}"`,
      );
    }
  }

  extract(request: TenancyRequest): string | null {
    if (!request.path) return null;

    const pathSegments = pathWithoutQueryOrHash(request.path).split('/').filter(Boolean);

    if (pathSegments.length < this.patternSegments.length) return null;

    for (let i = 0; i < this.patternSegments.length; i++) {
      if (i === this.paramIndex) continue;
      if (this.patternSegments[i] !== pathSegments[i]) return null;
    }

    try {
      return decodeURIComponent(pathSegments[this.paramIndex]);
    } catch {
      return null;
    }
  }
}
