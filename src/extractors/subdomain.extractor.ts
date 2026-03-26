import { Request } from 'express';
import { TenantExtractor } from '../interfaces/tenant-extractor.interface';

export interface SubdomainExtractorOptions {
  excludeSubdomains?: string[];
}

let pslModule: typeof import('psl') | null = null;

function loadPsl(): typeof import('psl') {
  if (pslModule) return pslModule;
  try {
     
    pslModule = require('psl');
    return pslModule!;
  } catch {
    throw new Error(
      'SubdomainTenantExtractor requires the "psl" package. Install it: npm install psl',
    );
  }
}

export class SubdomainTenantExtractor implements TenantExtractor {
  private readonly excludes: Set<string>;
  private readonly psl: typeof import('psl');

  constructor(options?: SubdomainExtractorOptions) {
    this.excludes = new Set(
      (options?.excludeSubdomains ?? ['www']).map((s) => s.toLowerCase()),
    );
    this.psl = loadPsl();
  }

  extract(request: Request): string | null {
    const hostname = request.hostname;

    // Reject IP addresses — psl treats octets as domain segments
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
      return null;
    }

    const parsed = this.psl.parse(hostname);

    if ('error' in parsed) {
      return null;
    }

    let subdomain: string | null = null;

    if ('subdomain' in parsed && parsed.subdomain) {
      // psl successfully parsed a known TLD — use its subdomain
      subdomain = parsed.subdomain.split('.')[0].toLowerCase();
    } else if (!parsed.listed) {
      // Internal/private domain (e.g. .local, .internal) — psl cannot parse it.
      // Fall back to simple split: treat the first segment as subdomain if there
      // are at least 3 labels (subdomain.domain.tld).
      const labels = hostname.split('.');
      if (labels.length >= 3) {
        subdomain = labels[0].toLowerCase();
      }
    }

    if (!subdomain) return null;
    if (this.excludes.has(subdomain)) return null;
    return subdomain;
  }
}
