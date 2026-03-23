import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { TenancyContext } from '../services/tenancy-context';

const tenancyContext = new TenancyContext();

export const CurrentTenant = createParamDecorator(
  (_data: unknown, _ctx: ExecutionContext): string | null => {
    return tenancyContext.getTenantId();
  },
);
