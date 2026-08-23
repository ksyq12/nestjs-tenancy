import { TenancyContext } from '../src/services/tenancy-context';
import { GrpcTenantPropagator, GrpcMetadataLike } from '../src/propagation/grpc-tenant-propagator';
import { TenantContextDiagnostics } from '../src/diagnostics/tenant-context-diagnostics';

/** Mock gRPC Metadata that matches the structural type. */
function createMockMetadata(): GrpcMetadataLike & { store: Map<string, (string | Buffer)[]> } {
  const store = new Map<string, (string | Buffer)[]>();
  return {
    store,
    set(key: string, value: string) {
      store.set(key, [value]);
    },
    get(key: string): (string | Buffer)[] {
      return store.get(key) ?? [];
    },
  };
}

describe('GrpcTenantPropagator', () => {
  let context: TenancyContext;

  beforeEach(() => {
    context = new TenancyContext();
  });

  describe('inject', () => {
    it('should set tenant in metadata with default key', (done) => {
      const propagator = new GrpcTenantPropagator(context);
      const metadata = createMockMetadata();
      context.run('tenant-abc', () => {
        const result = propagator.inject(metadata);
        expect(result.get('x-tenant-id')).toEqual(['tenant-abc']);
        expect(result).toBe(metadata);
        done();
      });
    });

    it('should use custom metadata key', (done) => {
      const propagator = new GrpcTenantPropagator(context, { metadataKey: 'tenant-id' });
      const metadata = createMockMetadata();
      context.run('tenant-xyz', () => {
        propagator.inject(metadata);
        expect(metadata.get('tenant-id')).toEqual(['tenant-xyz']);
        done();
      });
    });

    it('should return metadata unchanged when no tenant context', () => {
      const propagator = new GrpcTenantPropagator(context);
      const metadata = createMockMetadata();
      const result = propagator.inject(metadata);
      expect(result).toBe(metadata);
      expect(metadata.store.size).toBe(0);
    });

    it('should diagnose missing client context', () => {
      const onMissing = jest.fn();
      const propagator = new GrpcTenantPropagator(context, {
        resource: 'orders.Process',
        diagnostics: new TenantContextDiagnostics({ policy: 'warn', onMissing }),
      });

      propagator.inject(createMockMetadata());
      expect(onMissing).toHaveBeenCalledWith({
        transport: 'grpc', operation: 'inject', resource: 'orders.Process',
      });
    });

    it('should return metadata unchanged inside withoutTenant()', async () => {
      const propagator = new GrpcTenantPropagator(context);
      const metadata = createMockMetadata();
      await context.runWithoutTenant(() => {
        propagator.inject(metadata);
        expect(metadata.store.size).toBe(0);
      });
    });
  });

  describe('extract', () => {
    it('should extract tenant from string value', () => {
      const propagator = new GrpcTenantPropagator(context);
      const metadata = createMockMetadata();
      metadata.set('x-tenant-id', 'tenant-abc');
      expect(propagator.extract(metadata)).toBe('tenant-abc');
    });

    it('should extract tenant from Buffer value', () => {
      const propagator = new GrpcTenantPropagator(context);
      const metadata = createMockMetadata();
      metadata.store.set('x-tenant-id', [Buffer.from('tenant-abc')]);
      expect(propagator.extract(metadata)).toBe('tenant-abc');
    });

    it('should use custom metadata key for extraction', () => {
      const propagator = new GrpcTenantPropagator(context, { metadataKey: 'tenant-id' });
      const metadata = createMockMetadata();
      metadata.set('tenant-id', 'tenant-xyz');
      expect(propagator.extract(metadata)).toBe('tenant-xyz');
    });

    it('should return null when key is missing', () => {
      const propagator = new GrpcTenantPropagator(context);
      const metadata = createMockMetadata();
      expect(propagator.extract(metadata)).toBeNull();
    });

    it('should diagnose missing server metadata context', () => {
      const onMissing = jest.fn();
      const propagator = new GrpcTenantPropagator(context, {
        diagnostics: new TenantContextDiagnostics({ policy: 'warn', onMissing }),
      });

      expect(propagator.extract(createMockMetadata())).toBeNull();
      expect(onMissing).toHaveBeenCalledWith({
        transport: 'grpc', operation: 'extract',
      });
    });

    it('should return null for empty Buffer', () => {
      const propagator = new GrpcTenantPropagator(context);
      const metadata = createMockMetadata();
      metadata.store.set('x-tenant-id', [Buffer.from('')]);
      expect(propagator.extract(metadata)).toBeNull();
    });

    it('should return null for empty string', () => {
      const propagator = new GrpcTenantPropagator(context);
      const metadata = createMockMetadata();
      metadata.store.set('x-tenant-id', ['']);
      expect(propagator.extract(metadata)).toBeNull();
    });

    it('should return first value when multiple values exist', () => {
      const propagator = new GrpcTenantPropagator(context);
      const metadata = createMockMetadata();
      metadata.store.set('x-tenant-id', ['tenant-first', 'tenant-second']);
      expect(propagator.extract(metadata)).toBe('tenant-first');
    });
  });
});
