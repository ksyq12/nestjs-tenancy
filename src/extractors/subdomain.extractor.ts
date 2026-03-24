import { Request } from 'express';
import { TenantExtractor } from '../interfaces/tenant-extractor.interface';

export interface SubdomainExtractorOptions {
  excludeSubdomains?: string[];
}

export class SubdomainTenantExtractor implements TenantExtractor {
  private readonly excludes: Set<string>;

  constructor(options?: SubdomainExtractorOptions) {
    this.excludes = new Set(
      (options?.excludeSubdomains ?? ['www']).map((s) => s.toLowerCase()),
    );
  }

  extract(request: Request): string | null {
    const hostname = request.hostname;
    const parts = hostname.split('.');

    if (parts.length < 3) return null;

    const subdomain = parts[0].toLowerCase();
    if (this.excludes.has(subdomain)) return null;

    return subdomain;
  }
}
