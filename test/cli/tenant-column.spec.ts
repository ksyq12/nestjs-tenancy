import { parseModels } from '../../src/cli/prisma-schema-parser';
import type { ParsedModel } from '../../src/cli/prisma-schema-parser';
import { resolveTenantColumn } from '../../src/cli/tenant-column';

function parsedModel(...fieldDefinitions: string[]): ParsedModel {
  const model = parseModels(`
model Account {
  id Int @id
  ${fieldDefinitions.join('\n  ')}
}
`)[0];

  if (!model) throw new Error('Test schema did not produce an Account model.');
  return model;
}

describe('resolveTenantColumn', () => {
  it.each([
    ['the default PostgreSQL String mapping', 'tenant_id String'],
    ['@db.Text', 'tenant_id String @db.Text'],
    ['@db.VarChar', 'tenant_id String @db.VarChar(64)'],
    ['@db.Char', 'tenant_id String @db.Char(36)'],
  ])('should resolve %s as a TEXT policy', (_label, fieldDefinition) => {
    expect(resolveTenantColumn(
      parsedModel(fieldDefinition),
      'tenant_id',
    )).toEqual({
      fieldName: 'tenant_id',
      columnName: 'tenant_id',
      policyType: 'text',
    });
  });

  it('should resolve @db.Uuid as a UUID policy', () => {
    expect(resolveTenantColumn(
      parsedModel('tenant_id String @db.Uuid'),
      'tenant_id',
    )).toEqual({
      fieldName: 'tenant_id',
      columnName: 'tenant_id',
      policyType: 'uuid',
    });
  });

  it('should accept a supported native type from an arbitrarily named datasource', () => {
    expect(resolveTenantColumn(
      parsedModel('tenant_id String @database.Uuid'),
      'tenant_id',
    )).toEqual({
      fieldName: 'tenant_id',
      columnName: 'tenant_id',
      policyType: 'uuid',
    });
  });

  it('should resolve a Unicode logical field and datasource namespace as UUID', () => {
    expect(resolveTenantColumn(
      parsedModel('tenant가 String @map("tenant_id") @데이터.Uuid'),
      'tenant_id',
    )).toEqual({
      fieldName: 'tenant가',
      columnName: 'tenant_id',
      policyType: 'uuid',
    });
  });

  it('should resolve a mapped physical tenant column and retain its Prisma field name', () => {
    expect(resolveTenantColumn(
      parsedModel('tenantId String @map("tenant_id") @db.Uuid'),
      'tenant_id',
    )).toEqual({
      fieldName: 'tenantId',
      columnName: 'tenant_id',
      policyType: 'uuid',
    });
  });

  it('should preserve the legacy TEXT fallback when field metadata is absent', () => {
    expect(resolveTenantColumn({
      modelName: 'LegacyAccount',
      tableName: 'legacy_accounts',
    }, 'tenant_id')).toEqual({
      fieldName: 'tenant_id',
      columnName: 'tenant_id',
      policyType: 'text',
    });
  });

  it('should reject a missing tenant column with sharedModels guidance', () => {
    expect(() => resolveTenantColumn(
      parsedModel('account_key String'),
      'tenant_id',
    )).toThrow(
      /Model Account does not map a field to tenant column "tenant_id"[\s\S]+sharedModels/,
    );
  });

  it('should reject duplicate physical tenant-column mappings', () => {
    expect(() => resolveTenantColumn(
      parsedModel(
        'primaryTenant String @map("tenant_id")',
        'backupTenant String @map("tenant_id")',
      ),
      'tenant_id',
    )).toThrow(
      /Model Account maps multiple fields to tenant column "tenant_id" \(primaryTenant, backupTenant\)/,
    );
  });

  it.each([
    ['optional', 'tenant_id String?', /optional[\s\S]+required scalar/],
    ['list', 'tenant_id String[]', /list[\s\S]+required scalar/],
  ])('should reject a %s tenant field', (_label, fieldDefinition, error) => {
    expect(() => resolveTenantColumn(
      parsedModel(fieldDefinition),
      'tenant_id',
    )).toThrow(error);
  });

  it.each([
    ['a non-String scalar', 'tenant_id Int', /unsupported scalar type Int/],
    [
      'an Unsupported field',
      'tenant_id Unsupported("citext")',
      /unsupported scalar type Unsupported/,
    ],
    [
      'an Unsupported field whose type text contains parentheses',
      'tenant_id Unsupported("geography(Point,4326)")',
      /unsupported scalar type Unsupported/,
    ],
  ])('should reject %s', (_label, fieldDefinition, error) => {
    expect(() => resolveTenantColumn(
      parsedModel(fieldDefinition),
      'tenant_id',
    )).toThrow(error);
  });

  it('should reject an unknown PostgreSQL native type', () => {
    expect(() => resolveTenantColumn(
      parsedModel('tenant_id String @db.Inet'),
      'tenant_id',
    )).toThrow(
      /unsupported native type @db\.Inet/,
    );
  });

  it('should reject an ignored tenant field with remediation guidance', () => {
    expect(() => resolveTenantColumn(
      parsedModel('tenant_id String @db.Uuid @ignore'),
      'tenant_id',
    )).toThrow(
      /tenant field tenant_id String @db\.Uuid @ignore is marked @ignore[\s\S]+Remove @ignore[\s\S]+sharedModels/,
    );
  });

  it('should reject multiple native type annotations instead of guessing', () => {
    expect(() => resolveTenantColumn(
      parsedModel('tenant_id String @db.Text @db.Uuid'),
      'tenant_id',
    )).toThrow(
      /multiple native types \(@db.Text, @db.Uuid\)/,
    );
  });
});
