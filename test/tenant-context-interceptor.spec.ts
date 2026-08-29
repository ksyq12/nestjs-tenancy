import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Observable, of, Subscription, take } from 'rxjs';
import { TenancyContext } from '../src/services/tenancy-context';
import { TenantContextInterceptor } from '../src/propagation/tenant-context.interceptor';
import { TenantContextDiagnostics } from '../src/diagnostics/tenant-context-diagnostics';

function createMockCallHandler(returnValue: unknown = 'result'): CallHandler {
  return { handle: () => of(returnValue) };
}

function createHttpContext(headers: Record<string, string>): ExecutionContext {
  return {
    getType: () => 'http',
    switchToHttp: () => ({
      getRequest: () => ({ headers }),
      getResponse: () => ({}),
      getNext: () => ({}),
    }),
    switchToRpc: () => ({}),
    switchToWs: () => ({}),
    getClass: () => Object,
    getHandler: () => Object,
    getArgs: () => [],
    getArgByIndex: () => ({}),
  } as unknown as ExecutionContext;
}

function createKafkaContext(messageHeaders: Record<string, unknown>): ExecutionContext {
  return {
    getType: () => 'rpc',
    switchToRpc: () => ({
      getData: () => ({ value: 'payload' }),
      getContext: () => ({
        getMessage: () => ({ headers: messageHeaders }),
      }),
    }),
    switchToHttp: () => ({}),
    switchToWs: () => ({}),
    getClass: () => Object,
    getHandler: () => Object,
    getArgs: () => [],
    getArgByIndex: () => ({}),
  } as unknown as ExecutionContext;
}

function createBullContext(jobData: Record<string, unknown>): ExecutionContext {
  return {
    getType: () => 'rpc',
    switchToRpc: () => ({
      getData: () => jobData,
      getContext: () => ({}),
    }),
    switchToHttp: () => ({}),
    switchToWs: () => ({}),
    getClass: () => Object,
    getHandler: () => Object,
    getArgs: () => [],
    getArgByIndex: () => ({}),
  } as unknown as ExecutionContext;
}

function createGrpcContext(metadataStore: Map<string, (string | Buffer)[]>): ExecutionContext {
  return {
    getType: () => 'rpc',
    switchToRpc: () => ({
      getData: () => ({ field: 'value' }),
      getContext: () => ({
        get: (key: string) => metadataStore.get(key) ?? [],
        set: (key: string, value: string) => metadataStore.set(key, [value]),
      }),
    }),
    switchToHttp: () => ({}),
    switchToWs: () => ({}),
    getClass: () => Object,
    getHandler: () => Object,
    getArgs: () => [],
    getArgByIndex: () => ({}),
  } as unknown as ExecutionContext;
}

describe('TenantContextInterceptor', () => {
  let context: TenancyContext;
  let interceptor: TenantContextInterceptor;

  beforeEach(() => {
    context = new TenancyContext();
    interceptor = new TenantContextInterceptor(context);
  });

  describe('HTTP transport (skipped — handled by middleware)', () => {
    it('should pass through HTTP requests without extracting tenant', (done) => {
      const execCtx = createHttpContext({ 'x-tenant-id': 'tenant-abc' });
      const handler = {
        handle: () => new Observable((subscriber) => {
          // Tenant should NOT be set — HTTP is handled by middleware
          expect(context.getTenantId()).toBeNull();
          subscriber.next('result');
          subscriber.complete();
        }),
      };

      interceptor.intercept(execCtx, handler).subscribe({
        next: (val) => expect(val).toBe('result'),
        complete: () => done(),
      });
    });

    it('should preserve an HTTP tenant already established by middleware', () => {
      const execCtx = createHttpContext({});
      let observedTenant: string | null = null;

      context.run('http-tenant', () => {
        interceptor.intercept(execCtx, {
          handle: () => new Observable((subscriber) => {
            observedTenant = context.getTenantId();
            subscriber.complete();
          }),
        }).subscribe();

        expect(context.getTenantId()).toBe('http-tenant');
      });

      expect(observedTenant).toBe('http-tenant');
      expect(context.getTenantId()).toBeNull();
    });

    it('should not diagnose HTTP even when an RPC transport option is configured', (done) => {
      const onMissing = jest.fn();
      const configuredInterceptor = new TenantContextInterceptor(context, {
        transport: 'bull',
        diagnostics: new TenantContextDiagnostics({ policy: 'warn', onMissing }),
      });

      configuredInterceptor.intercept(
        createHttpContext({}),
        createMockCallHandler('result'),
      ).subscribe({
        complete: () => {
          expect(onMissing).not.toHaveBeenCalled();
          done();
        },
      });
    });
  });

  describe('Kafka transport (duck-typing)', () => {
    it('should extract tenant from Kafka message header', (done) => {
      const execCtx = createKafkaContext({ 'X-Tenant-Id': 'tenant-kafka' });
      const handler = {
        handle: () => new Observable((subscriber) => {
          expect(context.getTenantId()).toBe('tenant-kafka');
          subscriber.next('result');
          subscriber.complete();
        }),
      };

      interceptor.intercept(execCtx, handler).subscribe({
        complete: () => done(),
      });
    });

    it('should extract tenant from Buffer Kafka header', (done) => {
      const execCtx = createKafkaContext({ 'X-Tenant-Id': Buffer.from('tenant-buf') });
      const handler = {
        handle: () => new Observable((subscriber) => {
          expect(context.getTenantId()).toBe('tenant-buf');
          subscriber.next('result');
          subscriber.complete();
        }),
      };

      interceptor.intercept(execCtx, handler).subscribe({
        complete: () => done(),
      });
    });
  });

  describe('Bull transport (duck-typing)', () => {
    it('should extract tenant from Bull job data', (done) => {
      const execCtx = createBullContext({ __tenantId: 'tenant-bull', orderId: '123' });
      const handler = {
        handle: () => new Observable((subscriber) => {
          expect(context.getTenantId()).toBe('tenant-bull');
          subscriber.next('result');
          subscriber.complete();
        }),
      };

      interceptor.intercept(execCtx, handler).subscribe({
        complete: () => done(),
      });
    });
  });

  describe('gRPC transport (duck-typing)', () => {
    it('should extract tenant from gRPC metadata', (done) => {
      const store = new Map<string, (string | Buffer)[]>();
      store.set('x-tenant-id', ['tenant-grpc']);
      const execCtx = createGrpcContext(store);
      const handler = {
        handle: () => new Observable((subscriber) => {
          expect(context.getTenantId()).toBe('tenant-grpc');
          subscriber.next('result');
          subscriber.complete();
        }),
      };

      interceptor.intercept(execCtx, handler).subscribe({
        complete: () => done(),
      });
    });
  });

  describe('explicit transport option', () => {
    it('should use Kafka extraction when transport is kafka', (done) => {
      const kafkaInterceptor = new TenantContextInterceptor(context, { transport: 'kafka' });
      const execCtx = createKafkaContext({ 'X-Tenant-Id': 'tenant-explicit' });
      const handler = {
        handle: () => new Observable((subscriber) => {
          expect(context.getTenantId()).toBe('tenant-explicit');
          subscriber.next('ok');
          subscriber.complete();
        }),
      };

      kafkaInterceptor.intercept(execCtx, handler).subscribe({
        complete: () => done(),
      });
    });

    it('should use Bull extraction when transport is bull', (done) => {
      const bullInterceptor = new TenantContextInterceptor(context, { transport: 'bull' });
      const execCtx = createBullContext({ __tenantId: 'tenant-bull-explicit' });
      const handler = {
        handle: () => new Observable((subscriber) => {
          expect(context.getTenantId()).toBe('tenant-bull-explicit');
          subscriber.next('ok');
          subscriber.complete();
        }),
      };

      bullInterceptor.intercept(execCtx, handler).subscribe({
        complete: () => done(),
      });
    });

    it('should use gRPC extraction when transport is grpc', (done) => {
      const grpcInterceptor = new TenantContextInterceptor(context, { transport: 'grpc' });
      const store = new Map<string, (string | Buffer)[]>();
      store.set('x-tenant-id', ['tenant-grpc-explicit']);
      const execCtx = createGrpcContext(store);
      const handler = {
        handle: () => new Observable((subscriber) => {
          expect(context.getTenantId()).toBe('tenant-grpc-explicit');
          subscriber.next('ok');
          subscriber.complete();
        }),
      };

      grpcInterceptor.intercept(execCtx, handler).subscribe({
        complete: () => done(),
      });
    });

    it('should diagnose a missing Bull consumer context and continue on warn', (done) => {
      const onMissing = jest.fn();
      const bullInterceptor = new TenantContextInterceptor(context, {
        transport: 'bull',
        resource: 'orders',
        diagnostics: new TenantContextDiagnostics({ policy: 'warn', onMissing }),
      });

      bullInterceptor.intercept(
        createBullContext({ orderId: '123' }),
        createMockCallHandler('ok'),
      ).subscribe({
        next: (value) => expect(value).toBe('ok'),
        complete: () => {
          expect(onMissing).toHaveBeenCalledWith({
            transport: 'bull', operation: 'consume', resource: 'orders',
          });
          done();
        },
      });
    });

    it('should reject before invoking a Kafka handler on throw', () => {
      const handle = jest.fn(() => of('should-not-run'));
      const kafkaInterceptor = new TenantContextInterceptor(context, {
        transport: 'kafka',
        diagnostics: new TenantContextDiagnostics({ policy: 'throw' }),
      });

      expect(() => kafkaInterceptor.intercept(
        createKafkaContext({}),
        { handle },
      )).toThrow('Tenant context is missing during kafka.consume');
      expect(handle).not.toHaveBeenCalled();
    });
  });

  describe('inbound context isolation', () => {
    const OUTER_TENANT = 'ambient-tenant-a';

    it.each([
      {
        transport: 'kafka' as const,
        executionContext: () => createKafkaContext({}),
      },
      {
        transport: 'grpc' as const,
        executionContext: () => createGrpcContext(new Map()),
      },
      {
        transport: 'bull' as const,
        executionContext: () => createBullContext({ orderId: '123' }),
      },
    ])('should neutralize ambient context for tenant-missing $transport subscriptions', ({
      transport,
      executionContext,
    }) => {
      const configuredInterceptor = new TenantContextInterceptor(context, { transport });
      let observedError: unknown;
      const handle = jest.fn(() => new Observable((subscriber) => {
        expect(context.getTenantId()).toBeNull();
        expect(context.isBypassed()).toBe(false);
        subscriber.next('ok');
        subscriber.complete();
      }));

      context.run(OUTER_TENANT, () => {
        configuredInterceptor.intercept(executionContext(), { handle }).subscribe({
          error: (error) => { observedError = error; },
        });

        expect(observedError).toBeUndefined();
        expect(context.getTenantId()).toBe(OUTER_TENANT);
        expect(context.isBypassed()).toBe(false);
      });

      expect(handle).toHaveBeenCalledTimes(1);
      expect(context.getTenantId()).toBeNull();
    });

    it('should nest a valid inbound tenant and restore the outer tenant after completion', () => {
      const execCtx = createKafkaContext({ 'X-Tenant-Id': 'inbound-tenant-b' });
      let observedError: unknown;
      const handle = jest.fn(() => new Observable((subscriber) => {
        expect(context.getTenantId()).toBe('inbound-tenant-b');
        expect(context.isBypassed()).toBe(false);
        subscriber.next('ok');
        subscriber.complete();
      }));

      context.run(OUTER_TENANT, () => {
        interceptor.intercept(execCtx, { handle }).subscribe({
          error: (error) => { observedError = error; },
        });

        expect(observedError).toBeUndefined();
        expect(context.getTenantId()).toBe(OUTER_TENANT);
      });

      expect(handle).toHaveBeenCalledTimes(1);
    });

    it('should neutralize an unclassified RPC and restore an outer explicit bypass', () => {
      let observedError: unknown;
      const handle = jest.fn(() => new Observable((subscriber) => {
        expect(context.getTenantId()).toBeNull();
        expect(context.isBypassed()).toBe(false);
        subscriber.complete();
      }));

      context.runWithoutTenant(() => {
        interceptor.intercept(
          createBullContext({ orderId: '123' }),
          { handle },
        ).subscribe({ error: (error) => { observedError = error; } });

        expect(observedError).toBeUndefined();
        expect(context.getTenantId()).toBeNull();
        expect(context.isBypassed()).toBe(true);
      });

      expect(handle).toHaveBeenCalledTimes(1);
      expect(context.getTenantId()).toBeNull();
      expect(context.isBypassed()).toBe(false);
    });

    it('should run missing-context diagnostics without the ambient tenant or bypass', () => {
      const observations: Array<[string | null, boolean]> = [];
      const configuredInterceptor = new TenantContextInterceptor(context, {
        transport: 'kafka',
        diagnostics: new TenantContextDiagnostics({
          policy: 'warn',
          onMissing: () => {
            observations.push([context.getTenantId(), context.isBypassed()]);
          },
        }),
      });

      context.run(OUTER_TENANT, () => {
        configuredInterceptor.intercept(
          createKafkaContext({}),
          createMockCallHandler('ok'),
        ).subscribe();

        expect(context.getTenantId()).toBe(OUTER_TENANT);
      });

      expect(observations).toEqual([[null, false]]);
    });

    it('should isolate concurrent inbound tenant subscriptions', async () => {
      const observeTenant = (tenantId: string, delay: number) => {
        const execCtx = createKafkaContext({ 'X-Tenant-Id': tenantId });
        return new Promise<string>((resolve, reject) => {
          interceptor.intercept(execCtx, {
            handle: () => new Observable((subscriber) => {
              const timer = setTimeout(() => {
                subscriber.next(context.getTenantId());
                subscriber.complete();
              }, delay);
              return () => clearTimeout(timer);
            }),
          }).subscribe({
            next: (value) => resolve(value as string),
            error: reject,
          });
        });
      };

      await context.run(OUTER_TENANT, async () => {
        const tenants = await Promise.all([
          observeTenant('inbound-tenant-a', 10),
          observeTenant('inbound-tenant-b', 1),
        ]);

        expect(tenants).toEqual(['inbound-tenant-a', 'inbound-tenant-b']);
        expect(context.getTenantId()).toBe(OUTER_TENANT);
      });
    });

    it('should restore the outer tenant after handler throw and unsubscribe', () => {
      const execCtx = createKafkaContext({ 'X-Tenant-Id': 'inbound-tenant-b' });
      const handlerError = new Error('handler failed');
      let observedError: unknown;

      context.run(OUTER_TENANT, () => {
        interceptor.intercept(execCtx, {
          handle: () => {
            expect(context.getTenantId()).toBe('inbound-tenant-b');
            throw handlerError;
          },
        } as CallHandler).subscribe({ error: (error) => { observedError = error; } });

        expect(observedError).toBe(handlerError);
        expect(context.getTenantId()).toBe(OUTER_TENANT);

        const subscription = interceptor.intercept(execCtx, {
          handle: () => new Observable(() => undefined),
        }).subscribe();
        expect(context.getTenantId()).toBe(OUTER_TENANT);

        subscription.unsubscribe();
        expect(context.getTenantId()).toBe(OUTER_TENANT);
      });
    });

    it('should neutralize missing-handler throw and teardown before restoring the outer tenant', () => {
      const missingInterceptor = new TenantContextInterceptor(context, { transport: 'kafka' });
      const execCtx = createKafkaContext({});
      const handlerError = new Error('missing handler failed');
      let observedError: unknown;
      let teardownContext: [string | null, boolean] | undefined;

      context.run(OUTER_TENANT, () => {
        missingInterceptor.intercept(execCtx, {
          handle: () => {
            expect(context.getTenantId()).toBeNull();
            expect(context.isBypassed()).toBe(false);
            throw handlerError;
          },
        } as CallHandler).subscribe({ error: (error) => { observedError = error; } });

        expect(observedError).toBe(handlerError);
        expect(context.getTenantId()).toBe(OUTER_TENANT);

        const subscription = missingInterceptor.intercept(execCtx, {
          handle: () => new Observable(() => () => {
            teardownContext = [context.getTenantId(), context.isBypassed()];
          }),
        }).subscribe();

        expect(context.getTenantId()).toBe(OUTER_TENANT);
        subscription.unsubscribe();
        expect(teardownContext).toEqual([null, false]);
        expect(context.getTenantId()).toBe(OUTER_TENANT);
      });
    });

    it('should stop a synchronous inner source when downstream unsubscribes', () => {
      const execCtx = createKafkaContext({ 'X-Tenant-Id': 'inbound-tenant-b' });
      const produced: number[] = [];
      const received: unknown[] = [];

      context.run(OUTER_TENANT, () => {
        interceptor.intercept(execCtx, {
          handle: () => new Observable((subscriber) => {
            for (const value of [1, 2, 3]) {
              if (subscriber.closed) break;
              produced.push(value);
              subscriber.next(value);
            }
            subscriber.complete();
          }),
        }).pipe(take(1)).subscribe((value) => received.push(value));

        expect(context.getTenantId()).toBe(OUTER_TENANT);
      });

      expect(received).toEqual([1]);
      expect(produced).toEqual([1]);
      expect(context.getTenantId()).toBeNull();
    });
  });

  describe('Observable teardown', () => {
    it('should unsubscribe inner subscription on teardown', (done) => {
      const execCtx = createKafkaContext({ 'X-Tenant-Id': 'tenant-teardown' });
      let innerUnsubscribed = false;

      const handler = {
        handle: () => new Observable((subscriber) => {
          // Long-lived observable
          const interval = setInterval(() => subscriber.next('tick'), 10);
          return () => {
            clearInterval(interval);
            innerUnsubscribed = true;
          };
        }),
      };

      const sub: Subscription = interceptor.intercept(execCtx, handler).subscribe({
        next: () => {
          // After first emission, unsubscribe
          sub.unsubscribe();
          // Inner observable should be cleaned up
          setTimeout(() => {
            expect(innerUnsubscribed).toBe(true);
            done();
          }, 50);
        },
      });
    });

    it('should catch synchronous throw from handler and propagate as error', (done) => {
      const execCtx = createKafkaContext({ 'X-Tenant-Id': 'tenant-sync-throw' });
      const syncError = new Error('sync handler throw');

      const handler = {
        handle: () => { throw syncError; },
      };

      interceptor.intercept(execCtx, handler as any).subscribe({
        error: (err) => {
          expect(err).toBe(syncError);
          done();
        },
      });
    });

    it('should propagate errors from inner observable', (done) => {
      const execCtx = createKafkaContext({ 'X-Tenant-Id': 'tenant-error' });
      const testError = new Error('test error');

      const handler = {
        handle: () => new Observable((subscriber) => {
          subscriber.error(testError);
        }),
      };

      interceptor.intercept(execCtx, handler).subscribe({
        error: (err) => {
          expect(err).toBe(testError);
          done();
        },
      });
    });
  });

  describe('duck-typing false positive prevention', () => {
    it('should NOT treat scalar get/set RPC context as gRPC metadata', (done) => {
      const execCtx = {
        getType: () => 'rpc',
        switchToRpc: () => ({
          getData: () => ({ field: 'value' }),
          getContext: () => ({
            get: () => 'tenant-url',
            set: () => undefined,
          }),
        }),
        switchToHttp: () => ({}),
        switchToWs: () => ({}),
        getClass: () => Object,
        getHandler: () => Object,
        getArgs: () => [],
        getArgByIndex: () => ({}),
      } as unknown as ExecutionContext;

      const handler = {
        handle: () => new Observable((subscriber) => {
          expect(context.getTenantId()).toBeNull();
          subscriber.next('result');
          subscriber.complete();
        }),
      };

      interceptor.intercept(execCtx, handler).subscribe({
        next: (val) => expect(val).toBe('result'),
        complete: () => done(),
      });
    });

    it('should NOT match Bull when data has no tenant key', (done) => {
      // Arbitrary RPC payload without __tenantId — should NOT be treated as Bull
      const execCtx = createBullContext({ orderId: '123', amount: 100 });
      const handler = {
        handle: () => new Observable((subscriber) => {
          expect(context.getTenantId()).toBeNull();
          subscriber.next('result');
          subscriber.complete();
        }),
      };

      interceptor.intercept(execCtx, handler).subscribe({
        next: (val) => expect(val).toBe('result'),
        complete: () => done(),
      });
    });

    it('should still match Bull when tenant key exists in data', (done) => {
      const execCtx = createBullContext({ __tenantId: 'tenant-real', orderId: '123' });
      const handler = {
        handle: () => new Observable((subscriber) => {
          expect(context.getTenantId()).toBe('tenant-real');
          subscriber.next('ok');
          subscriber.complete();
        }),
      };

      interceptor.intercept(execCtx, handler).subscribe({
        complete: () => done(),
      });
    });
  });

  describe('Buffer extraction branches', () => {
    it('should extract tenant from gRPC metadata with Buffer value', (done) => {
      const grpcInterceptor = new TenantContextInterceptor(context, { transport: 'grpc' });
      const store = new Map<string, (string | Buffer)[]>();
      store.set('x-tenant-id', [Buffer.from('tenant-grpc-buf')]);
      const execCtx = createGrpcContext(store);
      const handler = {
        handle: () => new Observable((subscriber) => {
          expect(context.getTenantId()).toBe('tenant-grpc-buf');
          subscriber.next('ok');
          subscriber.complete();
        }),
      };

      grpcInterceptor.intercept(execCtx, handler).subscribe({
        complete: () => done(),
      });
    });

    it('should return null for gRPC metadata with empty Buffer', (done) => {
      const grpcInterceptor = new TenantContextInterceptor(context, { transport: 'grpc' });
      const store = new Map<string, (string | Buffer)[]>();
      store.set('x-tenant-id', [Buffer.from('')]);
      const execCtx = createGrpcContext(store);
      const handler = {
        handle: () => new Observable((subscriber) => {
          expect(context.getTenantId()).toBeNull();
          subscriber.next('ok');
          subscriber.complete();
        }),
      };

      grpcInterceptor.intercept(execCtx, handler).subscribe({
        complete: () => done(),
      });
    });

    it('should return null for gRPC metadata with empty values array', (done) => {
      const grpcInterceptor = new TenantContextInterceptor(context, { transport: 'grpc' });
      const store = new Map<string, (string | Buffer)[]>();
      // Key exists but has empty array
      store.set('x-tenant-id', []);
      const execCtx = createGrpcContext(store);
      const handler = {
        handle: () => new Observable((subscriber) => {
          expect(context.getTenantId()).toBeNull();
          subscriber.next('ok');
          subscriber.complete();
        }),
      };

      grpcInterceptor.intercept(execCtx, handler).subscribe({
        complete: () => done(),
      });
    });

    it('should return null for Kafka header with non-string non-Buffer value', (done) => {
      const kafkaInterceptor = new TenantContextInterceptor(context, { transport: 'kafka' });
      // numeric value — neither string nor Buffer
      const execCtx = createKafkaContext({ 'X-Tenant-Id': 12345 });
      const handler = {
        handle: () => new Observable((subscriber) => {
          expect(context.getTenantId()).toBeNull();
          subscriber.next('ok');
          subscriber.complete();
        }),
      };

      kafkaInterceptor.intercept(execCtx, handler).subscribe({
        complete: () => done(),
      });
    });

    it('should return null for Kafka message with empty Buffer header', (done) => {
      const kafkaInterceptor = new TenantContextInterceptor(context, { transport: 'kafka' });
      const execCtx = createKafkaContext({ 'X-Tenant-Id': Buffer.from('') });
      const handler = {
        handle: () => new Observable((subscriber) => {
          expect(context.getTenantId()).toBeNull();
          subscriber.next('ok');
          subscriber.complete();
        }),
      };

      kafkaInterceptor.intercept(execCtx, handler).subscribe({
        complete: () => done(),
      });
    });
  });

  describe('gRPC edge cases', () => {
    it('should return null for gRPC metadata with non-string non-Buffer value', (done) => {
      const grpcInterceptor = new TenantContextInterceptor(context, { transport: 'grpc' });
      const store = new Map<string, (string | Buffer)[]>();
      // numeric value cast — neither string nor Buffer
      store.set('x-tenant-id', [42 as any]);
      const execCtx = createGrpcContext(store);
      const handler = {
        handle: () => new Observable((subscriber) => {
          expect(context.getTenantId()).toBeNull();
          subscriber.next('ok');
          subscriber.complete();
        }),
      };

      grpcInterceptor.intercept(execCtx, handler).subscribe({
        complete: () => done(),
      });
    });
  });

  describe('explicit transport edge cases', () => {
    it('should pass through when transport is bull but data is null', (done) => {
      const bullInterceptor = new TenantContextInterceptor(context, { transport: 'bull' });
      const execCtx = {
        getType: () => 'rpc',
        switchToRpc: () => ({
          getData: () => null,
          getContext: () => ({}),
        }),
        switchToHttp: () => ({}),
        switchToWs: () => ({}),
        getClass: () => Object,
        getHandler: () => Object,
        getArgs: () => [],
        getArgByIndex: () => ({}),
      } as unknown as ExecutionContext;

      const handler = {
        handle: () => new Observable((subscriber) => {
          expect(context.getTenantId()).toBeNull();
          subscriber.next('ok');
          subscriber.complete();
        }),
      };

      bullInterceptor.intercept(execCtx, handler).subscribe({
        complete: () => done(),
      });
    });

    it('should pass through when transport is bull but data is a string', (done) => {
      const bullInterceptor = new TenantContextInterceptor(context, { transport: 'bull' });
      const execCtx = {
        getType: () => 'rpc',
        switchToRpc: () => ({
          getData: () => 'plain-string',
          getContext: () => ({}),
        }),
        switchToHttp: () => ({}),
        switchToWs: () => ({}),
        getClass: () => Object,
        getHandler: () => Object,
        getArgs: () => [],
        getArgByIndex: () => ({}),
      } as unknown as ExecutionContext;

      const handler = {
        handle: () => new Observable((subscriber) => {
          expect(context.getTenantId()).toBeNull();
          subscriber.next('ok');
          subscriber.complete();
        }),
      };

      bullInterceptor.intercept(execCtx, handler).subscribe({
        complete: () => done(),
      });
    });
  });

  describe('unknown transport', () => {
    it('should pass through for unknown transport types', (done) => {
      const execCtx = {
        getType: () => 'ws',
        switchToHttp: () => ({}),
        switchToRpc: () => ({}),
        switchToWs: () => ({}),
        getClass: () => Object,
        getHandler: () => Object,
        getArgs: () => [],
        getArgByIndex: () => ({}),
      } as unknown as ExecutionContext;

      const handler = createMockCallHandler('ws-result');
      interceptor.intercept(execCtx, handler).subscribe({
        next: (val) => expect(val).toBe('ws-result'),
        complete: () => done(),
      });
    });
  });
});
