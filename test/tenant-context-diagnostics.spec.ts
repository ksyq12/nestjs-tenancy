import { Logger } from '@nestjs/common';
import { TenantContextDiagnostics } from '../src/diagnostics/tenant-context-diagnostics';
import { TenantContextMissingError } from '../src/errors/tenant-context-missing.error';
import { TenancyEvents } from '../src/events/tenancy-events';

const diagnostic = {
  transport: 'bull' as const,
  operation: 'consume' as const,
  resource: 'orders',
};

describe('TenantContextDiagnostics', () => {
  afterEach(() => jest.restoreAllMocks());

  it('preserves silent behavior for the default ignore policy', () => {
    const eventService = { emit: jest.fn() };
    const telemetryService = { recordMissingContext: jest.fn() };
    const onMissing = jest.fn();
    const diagnostics = new TenantContextDiagnostics(
      { onMissing },
      eventService,
      telemetryService,
    );

    expect(() => diagnostics.report(diagnostic)).not.toThrow();
    expect(diagnostics.policy).toBe('ignore');
    expect(eventService.emit).not.toHaveBeenCalled();
    expect(telemetryService.recordMissingContext).not.toHaveBeenCalled();
    expect(onMissing).not.toHaveBeenCalled();
  });

  it('emits an event, records telemetry, invokes the hook, and warns', () => {
    const eventService = { emit: jest.fn() };
    const telemetryService = { recordMissingContext: jest.fn() };
    const onMissing = jest.fn();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const diagnostics = new TenantContextDiagnostics(
      { policy: 'warn', onMissing },
      eventService,
      telemetryService,
    );

    diagnostics.report(diagnostic);

    expect(eventService.emit).toHaveBeenCalledWith(
      TenancyEvents.CONTEXT_MISSING,
      diagnostic,
    );
    expect(telemetryService.recordMissingContext).toHaveBeenCalledWith(diagnostic);
    expect(onMissing).toHaveBeenCalledWith(diagnostic);
    expect(warn).toHaveBeenCalledWith(
      'Tenant context is missing during bull.consume for resource "orders"',
    );
  });

  it('reports before throwing TenantContextMissingError', () => {
    const order: string[] = [];
    const diagnostics = new TenantContextDiagnostics(
      {
        policy: 'throw',
        onMissing: () => order.push('hook'),
      },
      { emit: () => order.push('event') } as any,
      { recordMissingContext: () => order.push('telemetry') },
    );

    expect(() => diagnostics.report({
      transport: 'redis',
      operation: 'key',
    })).toThrow(TenantContextMissingError);
    expect(order).toEqual(['event', 'telemetry', 'hook']);
  });

  it('contains hook failures and still applies the selected policy', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const diagnostics = new TenantContextDiagnostics({
      policy: 'warn',
      onMissing: () => { throw new Error('hook failed'); },
    });

    expect(() => diagnostics.report(diagnostic)).not.toThrow();
    expect(error).toHaveBeenCalledWith(
      'Missing-context diagnostic hook failed',
      expect.stringContaining('hook failed'),
    );
  });

  it('contains event and telemetry reporter failures before throwing', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const diagnostics = new TenantContextDiagnostics(
      { policy: 'throw' },
      { emit: () => { throw new Error('event failed'); } } as any,
      { recordMissingContext: () => { throw new Error('telemetry failed'); } },
    );

    expect(() => diagnostics.report(diagnostic)).toThrow(TenantContextMissingError);
    expect(error).toHaveBeenCalledWith(
      'Missing-context event reporter failed',
      expect.stringContaining('event failed'),
    );
    expect(error).toHaveBeenCalledWith(
      'Missing-context telemetry reporter failed',
      expect.stringContaining('telemetry failed'),
    );
  });

  it('reports invalid inbound context independently of the missing-context policy', () => {
    const eventService = { emit: jest.fn() };
    const telemetryService = {
      recordMissingContext: jest.fn(),
      recordInvalidContext: jest.fn(),
    };
    const diagnostics = new TenantContextDiagnostics(
      { policy: 'ignore' },
      eventService,
      telemetryService,
    );
    const invalidDiagnostic = {
      transport: 'kafka' as const,
      operation: 'consume' as const,
      resource: 'orders',
    };

    diagnostics.reportInvalid(invalidDiagnostic);

    expect(eventService.emit).toHaveBeenCalledWith(
      TenancyEvents.CONTEXT_INVALID,
      invalidDiagnostic,
    );
    expect(telemetryService.recordInvalidContext).toHaveBeenCalledWith(
      invalidDiagnostic,
    );
    expect(Object.keys(invalidDiagnostic)).toEqual([
      'transport',
      'operation',
      'resource',
    ]);
  });

  it('contains invalid-context reporter failures', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const diagnostics = new TenantContextDiagnostics(
      {},
      { emit: () => { throw new Error('event failed'); } } as any,
      {
        recordMissingContext: jest.fn(),
        recordInvalidContext: () => { throw new Error('telemetry failed'); },
      },
    );

    expect(() => diagnostics.reportInvalid({
      transport: 'grpc',
      operation: 'consume',
    })).not.toThrow();
    expect(error).toHaveBeenCalledWith(
      'Invalid-context event reporter failed',
      expect.stringContaining('event failed'),
    );
    expect(error).toHaveBeenCalledWith(
      'Invalid-context telemetry reporter failed',
      expect.stringContaining('telemetry failed'),
    );
  });
});
