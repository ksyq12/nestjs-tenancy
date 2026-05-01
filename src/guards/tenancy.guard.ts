import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { TenancyContext } from '../services/tenancy-context';
import { TenancyEventService } from '../events/tenancy-event.service';
import { summarizeTenancyRequest, TenancyEvents } from '../events/tenancy-events';
import { BYPASS_TENANCY_KEY } from '../tenancy.constants';
import { TenancyRequest } from '../interfaces/tenancy-request.interface';

@Injectable()
export class TenancyGuard implements CanActivate {
  constructor(
    private readonly context: TenancyContext,
    private readonly reflector: Reflector,
    private readonly eventService: TenancyEventService,
  ) {}

  canActivate(executionContext: ExecutionContext): boolean {
    // TenancyGuard enforces tenant presence for HTTP only. RPC transports
    // restore tenant context via TenantContextInterceptor before handlers run.
    if (executionContext.getType() !== 'http') {
      return true;
    }

    const isBypassed = this.reflector.getAllAndOverride<boolean>(
      BYPASS_TENANCY_KEY,
      [executionContext.getHandler(), executionContext.getClass()],
    );
    if (isBypassed) {
      const request = executionContext.switchToHttp().getRequest<TenancyRequest>();
      this.eventService.emit(TenancyEvents.CONTEXT_BYPASSED, {
        reason: 'decorator',
        requestSummary: summarizeTenancyRequest(request),
      });
      return true;
    }

    const tenantId = this.context.getTenantId();
    if (!tenantId) {
      throw new ForbiddenException('Tenant ID is required');
    }

    return true;
  }
}
