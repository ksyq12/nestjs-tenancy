import { createHash } from 'crypto';
import { POSTGRES_IDENTIFIER_MAX_BYTES } from '../postgres-safety';

const HASH_HEX_LENGTH = 12;

export interface GeneratedRelationNameSource {
  schemaName?: string;
  tableName: string;
  tenantIdField: string;
}

export interface GeneratedRelationNames {
  index: string;
  isolationPolicy: string;
  insertPolicy: string;
}

type GeneratedNameKind = keyof GeneratedRelationNames;

interface GeneratedNameDescriptor {
  fingerprint: string;
  legacyCompatible: boolean;
  legacyName: string;
}

function safeIdentifier(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, '_');
}

function isLegacyCompatible(value: string): boolean {
  return /^[a-z0-9_]+$/.test(value);
}

function resolvedSchema(source: GeneratedRelationNameSource): string {
  return source.schemaName ?? 'public';
}

function relationSuffix(source: GeneratedRelationNameSource): string {
  const schema = resolvedSchema(source);
  const value = schema === 'public'
    ? source.tableName
    : `${schema}_${source.tableName}`;
  return safeIdentifier(value);
}

function descriptors(
  source: GeneratedRelationNameSource,
): Record<GeneratedNameKind, GeneratedNameDescriptor> {
  const schema = resolvedSchema(source);
  const suffix = relationSuffix(source);
  const tenantField = safeIdentifier(source.tenantIdField);
  const descriptor = (
    kind: GeneratedNameKind,
    legacyName: string,
    fingerprintParts: string[],
    legacyCompatible: boolean,
  ): GeneratedNameDescriptor => ({
    fingerprint: JSON.stringify([kind, ...fingerprintParts]),
    legacyCompatible,
    legacyName,
  });
  const relationIsLegacyCompatible =
    isLegacyCompatible(schema) && isLegacyCompatible(source.tableName);

  return {
    index: descriptor(
      'index',
      `tenancy_${suffix}_${tenantField}_idx`,
      [schema, source.tableName, source.tenantIdField],
      relationIsLegacyCompatible && isLegacyCompatible(source.tenantIdField),
    ),
    isolationPolicy: descriptor(
      'isolationPolicy',
      `tenant_isolation_${suffix}`,
      [schema, source.tableName],
      relationIsLegacyCompatible,
    ),
    insertPolicy: descriptor(
      'insertPolicy',
      `tenant_insert_${suffix}`,
      [schema, source.tableName],
      relationIsLegacyCompatible,
    ),
  };
}

function stableHashedIdentifier(descriptor: GeneratedNameDescriptor): string {
  const hash = createHash('sha256')
    .update(descriptor.fingerprint)
    .digest('hex')
    .slice(0, HASH_HEX_LENGTH);
  const readableBytes = POSTGRES_IDENTIFIER_MAX_BYTES - HASH_HEX_LENGTH - 1;
  const readable = descriptor.legacyName.slice(0, readableBytes);
  return `${readable}_${hash}`;
}

export function postgresCatalogIdentifier(
  identifier: string,
  maxBytes = POSTGRES_IDENTIFIER_MAX_BYTES,
): string {
  const safeMaxBytes = Number.isInteger(maxBytes) && maxBytes > 0
    ? maxBytes
    : POSTGRES_IDENTIFIER_MAX_BYTES;
  return identifier.slice(0, safeMaxBytes).toLowerCase();
}

function resolveDescriptor(descriptor: GeneratedNameDescriptor): string {
  const exceedsLimit = Buffer.byteLength(descriptor.legacyName, 'utf8') >
    POSTGRES_IDENTIFIER_MAX_BYTES;
  return descriptor.legacyCompatible && !exceedsLimit
    ? descriptor.legacyName
    : stableHashedIdentifier(descriptor);
}

export function generateRelationNames(
  source: GeneratedRelationNameSource,
): GeneratedRelationNames {
  const relationDescriptors = descriptors(source);
  return {
    index: resolveDescriptor(relationDescriptors.index),
    isolationPolicy: resolveDescriptor(relationDescriptors.isolationPolicy),
    insertPolicy: resolveDescriptor(relationDescriptors.insertPolicy),
  };
}
