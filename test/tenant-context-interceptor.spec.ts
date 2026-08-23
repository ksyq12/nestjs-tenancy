import { CallHandler, ExecutionContext } from '@nestjs/common';
import { Observable, of, Subscription } from 'rxjs';
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
