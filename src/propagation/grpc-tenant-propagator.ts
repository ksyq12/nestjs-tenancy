import { TenancyContext } from '../services/tenancy-context';
import { TenantContextCarrier } from '../interfaces/tenant-context-carrier.interface';
import { DEFAULT_GRPC_METADATA_KEY } from '../tenancy.constants';
import type { TenantContextDiagnostics } from '../diagnostics/tenant-context-diagnostics';

export interface GrpcPropagationOptions {
  /** Metadata key for tenant ID. Defaults to 'x-tenant-id' (lowercase per gRPC convention). */
  metadataKey?: string;
  /** Opt-in missing-context diagnostics. */
  diagnostics?: TenantContextDiagnostics;
  /** Stable service or method name included in diagnostics. */
  resource?: string;
}

/**
 * Structural type for gRPC Metadata — no dependency on @grpc/grpc-js.
 *
 * Matches the subset of `@grpc/grpc-js` `Metadata` used for tenant propagation.
 */
export interface GrpcMetadataLike {
  set(key: string, value: string): void;
  get(key: string): (string | Buffer)[];
}

/**
 * gRPC tenant propagator.
 *
 * Injects tenant ID into gRPC call metadata on the client side,
 * and extracts it on the server side.
 *
 * Uses lowercase metadata keys per gRPC convention (keys are case-insensitive
 * but lowercase is standard).
 *
 * No runtime dependency on `@grpc/grpc-js` — uses structural types.
 *
 * @example
 * ```typescript
 * const propagator = new GrpcTenantPropagator(new TenancyContext());
 *
 * // Client: inject tenant into outgoing metadata
 * const metadata = new Metadata();
 * propagator.inject(metadata);
 *
 * // Server: extract tenant from incoming metadata
 * const tenantId = propagator.extract(call.metadata);
 * ```
 */
export class GrpcTenantPropagator
  implements TenantContextCarrier<GrpcMetadataLike>
{
  private readonly metadataKey: string;
  private readonly diagnostics?: TenantContextDiagnostics;
  private readonly resource?: string;

  constructor(
    private readonly context: TenancyContext,
    options?: GrpcPropagationOptions,
  ) {
    this.metadataKey = options?.metadataKey ?? DEFAULT_GRPC_METADATA_KEY;
    this.diagnostics = options?.diagnostics;
    this.resource = options?.resource;
  }

  inject(metadata: GrpcMetadataLike): GrpcMetadataLike {
    const tenantId = this.context.getTenantId();
    if (!tenantId) {
      this.reportMissing('inject');
      return metadata;
    }
    metadata.set(this.metadataKey, tenantId);
    return metadata;
  }

  extract(metadata: GrpcMetadataLike): string | null {
    const values = metadata.get(this.metadataKey);
    if (values && values.length > 0) {
      const first = values[0];
      if (typeof first === 'string' && first.length > 0) return first;
      if (Buffer.isBuffer(first)) {
        const decoded = first.toString('utf-8');
        if (decoded.length > 0) return decoded;
      }
    }
    this.reportMissing('extract');
    return null;
  }

  private reportMissing(operation: 'inject' | 'extract'): void {
    this.diagnostics?.report({
      transport: 'grpc',
      operation,
      ...(this.resource ? { resource: this.resource } : {}),
    });
  }
}
