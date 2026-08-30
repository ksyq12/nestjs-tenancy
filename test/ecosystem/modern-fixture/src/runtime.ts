import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import {
  ApiKeysService,
  InMemoryApiKeyStorage,
  Sha256Hasher,
} from '@nestarc/api-keys';
import { TenancyContext } from '@nestarc/tenancy';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../prisma/generated/client';

export const TENANT_A = '11111111-1111-1111-1111-111111111111';
export const TENANT_B = '22222222-2222-2222-2222-222222222222';
export const API_KEY_PEPPER = 'ecosystem-compatibility-pepper';

const appDatabaseUrl = process.env.APP_DATABASE_URL;
if (!appDatabaseUrl) {
  throw new Error('APP_DATABASE_URL is required for the Prisma 7 adapter');
}

export const apiKeyStorage = new InMemoryApiKeyStorage();
export const tenancyContext = new TenancyContext();
export const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: appDatabaseUrl }),
});

export const extractorApiKeys = new ApiKeysService({
  storage: apiKeyStorage,
  hasher: new Sha256Hasher({
    peppers: { 1: API_KEY_PEPPER },
    currentVersion: 1,
  }),
  namespace: 'nk',
  debounceMs: 0,
});

export const apiKeyTenantExtractor = {
  async extract(request: {
    headers?: Record<string, string | string[] | undefined>;
  }): Promise<string> {
    const authorization = request.headers?.authorization;
    if (typeof authorization !== 'string') {
      throw new UnauthorizedException('API key is required');
    }

    const rawKey = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : authorization;
    let context;
    try {
      context = await extractorApiKeys.verify(rawKey);
    } catch {
      throw new UnauthorizedException('API key is invalid');
    }

    const assertedTenant = request.headers?.['x-tenant-id'];
    if (
      typeof assertedTenant === 'string' &&
      assertedTenant !== context.tenantId
    ) {
      throw new ForbiddenException('API key tenant mismatch');
    }

    return context.tenantId;
  },
};
