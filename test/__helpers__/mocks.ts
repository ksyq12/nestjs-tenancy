import type { TenancyEventService } from '../../src/events/tenancy-event.service';

export type MockTenancyEventService = TenancyEventService & {
  emit: jest.Mock;
  onModuleInit: jest.Mock;
};

export function createMockEventService(): MockTenancyEventService {
  return {
    emit: jest.fn(),
    onModuleInit: jest.fn(),
  } as unknown as MockTenancyEventService;
}
