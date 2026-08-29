import type { ParsedField, ParsedModel } from './prisma-schema-parser';

export type TenantColumnPolicyType = 'text' | 'uuid';

export interface TenantColumnResolution {
  fieldName: string;
  columnName: string;
  policyType: TenantColumnPolicyType;
}

const TEXT_NATIVE_TYPES = new Set(['Text', 'VarChar', 'Char']);

function supportedTypeDescription(): string {
  return 'Use a required Prisma String field (TEXT by default, @db.Text, ' +
    '@db.VarChar, or @db.Char) or String @db.Uuid for UUID.';
}

function fieldDescription(field: ParsedField): string {
  const arity = field.arity === 'optional'
    ? '?'
    : field.arity === 'list'
      ? '[]'
      : '';
  const natives = field.nativeTypes
    .map((native) => `@${native.namespace}.${native.name}`)
    .join(' ');
  const ignored = field.ignored ? ' @ignore' : '';
  return `${field.fieldName} ${field.scalarType}${arity}` +
    `${natives ? ` ${natives}` : ''}${ignored}`;
}

/**
 * Resolve the physical PostgreSQL tenant column to the policy cast emitted by
 * the CLI. Parser-origin models are strict. Legacy direct template callers
 * that provide no field metadata keep the historical TEXT output.
 */
export function resolveTenantColumn(
  model: ParsedModel,
  tenantColumn: string,
): TenantColumnResolution {
  if (model.fields === undefined) {
    return {
      fieldName: tenantColumn,
      columnName: tenantColumn,
      policyType: 'text',
    };
  }

  const candidates = model.fields.filter(
    (field) => field.columnName === tenantColumn,
  );
  if (candidates.length === 0) {
    throw new Error(
      `Model ${model.modelName} does not map a field to tenant column ` +
      `"${tenantColumn}". ${supportedTypeDescription()} ` +
      'If the model is shared, add it to sharedModels.',
    );
  }
  if (candidates.length > 1) {
    throw new Error(
      `Model ${model.modelName} maps multiple fields to tenant column ` +
      `"${tenantColumn}" (${candidates.map((field) => field.fieldName).join(', ')}). ` +
      'Keep exactly one tenant field.',
    );
  }

  const field = candidates[0];
  if (field.ignored) {
    throw new Error(
      `Model ${model.modelName} tenant field ${fieldDescription(field)} is ` +
      'marked @ignore. Remove @ignore so tenant isolation can address the ' +
      'field, or add the model to sharedModels if it is intentionally shared.',
    );
  }
  if (field.arity !== 'required') {
    throw new Error(
      `Model ${model.modelName} tenant field ${fieldDescription(field)} is ` +
      `${field.arity}. Tenant fields must be required scalar values. ` +
      supportedTypeDescription(),
    );
  }
  if (field.scalarType !== 'String') {
    throw new Error(
      `Model ${model.modelName} tenant field ${fieldDescription(field)} has ` +
      `unsupported scalar type ${field.scalarType}. ${supportedTypeDescription()}`,
    );
  }
  if (field.nativeTypes.length > 1) {
    throw new Error(
      `Model ${model.modelName} tenant field ${field.fieldName} has multiple ` +
      `native types (${field.nativeTypes.map((native) =>
        `@${native.namespace}.${native.name}`).join(', ')}). ` +
      supportedTypeDescription(),
    );
  }

  const nativeType = field.nativeTypes[0];
  let policyType: TenantColumnPolicyType;
  if (nativeType === undefined || TEXT_NATIVE_TYPES.has(nativeType.name)) {
    policyType = 'text';
  } else if (nativeType.name === 'Uuid') {
    policyType = 'uuid';
  } else {
    throw new Error(
      `Model ${model.modelName} tenant field ${fieldDescription(field)} has ` +
      `unsupported native type @${nativeType.namespace}.${nativeType.name}. ` +
      supportedTypeDescription(),
    );
  }

  return {
    fieldName: field.fieldName,
    columnName: field.columnName,
    policyType,
  };
}
