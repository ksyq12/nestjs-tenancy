import { Request } from 'express';
import { TenantExtractor } from '../interfaces/tenant-extractor.interface';

export class HeaderTenantExtractor implements TenantExtractor {
  private readonly headerName: string;

  constructor(headerName: string) {
    this.headerName = headerName.toLowerCase();
  }

  extract(request: Request): string | null {
    const value = request.headers[this.headerName];
    if (!value) return null;
    return Array.isArray(value) ? value[0] : value;
  }
}
