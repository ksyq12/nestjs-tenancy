import { parseModels } from '../../src/cli/prisma-schema-parser';

function parseModelIdentities(schema: string): Array<{
  modelName: string;
  tableName: string;
  schemaName?: string;
}> {
  return parseModels(schema).map((model) => ({
    modelName: model.modelName,
    tableName: model.tableName,
    ...(model.schemaName === undefined ? {} : { schemaName: model.schemaName }),
  }));
}

describe('parseModels', () => {
  it('should extract model names', () => {
    const schema = `
model User {
  id    Int    @id @default(autoincrement())
  name  String
}

model Order {
  id    Int    @id @default(autoincrement())
}
`;
    const models = parseModelIdentities(schema);
    expect(models).toEqual([
      { modelName: 'User', tableName: 'User' },
      { modelName: 'Order', tableName: 'Order' },
    ]);
  });

  it('should handle @@map for custom table names', () => {
    const schema = `
model User {
  id    Int    @id

  @@map("users")
}

model OrderItem {
  id    Int    @id

  @@map("order_items")
}
`;
    const models = parseModelIdentities(schema);
    expect(models).toEqual([
      { modelName: 'User', tableName: 'users' },
      { modelName: 'OrderItem', tableName: 'order_items' },
    ]);
  });

  it('should ignore enums and types', () => {
    const schema = `
enum Role {
  ADMIN
  USER
}

type Address {
  street String
  city   String
}

model User {
  id   Int  @id
  role Role
}
`;
    const models = parseModelIdentities(schema);
    expect(models).toEqual([
      { modelName: 'User', tableName: 'User' },
    ]);
  });

  it('should parse @@schema directive', () => {
    const schema = `
model Tenant {
  id    Int    @id

  @@schema("auth")
  @@map("tenants")
}
`;
    const models = parseModelIdentities(schema);
    expect(models).toEqual([
      { modelName: 'Tenant', tableName: 'tenants', schemaName: 'auth' },
    ]);
  });

  it('should decode escaped mapped schema and table names', () => {
    const schema = String.raw`
model LedgerEntry {
  id Int @id

  @@schema("tenant\"ops")
  @@map("ledger;\narchive")
}
`;

    expect(parseModelIdentities(schema)).toEqual([{
      modelName: 'LedgerEntry',
      tableName: 'ledger;\narchive',
      schemaName: 'tenant"ops',
    }]);
  });

  it('should reject an invalid escaped mapping string', () => {
    const schema = String.raw`
model LedgerEntry {
  id Int @id

  @@map("ledger\qarchive")
}
`;

    expect(() => parseModels(schema)).toThrow(
      /Invalid Prisma @@map string literal/,
    );
  });

  it('should decode Prisma string escapes with JSON semantics', () => {
    const schema = String.raw`
model EscapedName {
  id Int @id

  @@schema("solidus\/unicode\u0063")
  @@map("line\nquote\"slash\\X")
}
`;

    expect(parseModelIdentities(schema)).toEqual([{
      modelName: 'EscapedName',
      tableName: 'line\nquote"slash\\X',
      schemaName: 'solidus/unicodec',
    }]);
  });

  it('should validate unicode surrogate escapes with PSL semantics', () => {
    const validSchema = String.raw`
model PairName {
  id Int @id
  @@map("pair\uD83D\uDE00")
}
`;
    const invalidSchema = String.raw`
model LoneName {
  id Int @id
  @@map("lone\uD800")
}
`;

    expect(parseModelIdentities(validSchema)).toEqual([
      { modelName: 'PairName', tableName: 'pair😀' },
    ]);
    expect(() => parseModels(invalidSchema)).toThrow(
      /Invalid Prisma @@map string literal/,
    );
  });

  it('should ignore braces inside mapped names and continue parsing models', () => {
    const schema = `
model OpenLedger {
  id Int @id
  @@map("ledger{")
}

model ClosedLedger {
  id Int @id
  @@map("ledger}")
}
`;

    expect(parseModelIdentities(schema)).toEqual([
      { modelName: 'OpenLedger', tableName: 'ledger{' },
      { modelName: 'ClosedLedger', tableName: 'ledger}' },
    ]);
  });

  it('should ignore commented mapping directives', () => {
    const schema = `
model User {
  id Int @id
  // @@map("old_users")
  @@map("users")
}
`;

    expect(parseModelIdentities(schema)).toEqual([
      { modelName: 'User', tableName: 'users' },
    ]);
  });

  it('should ignore mapping directives and braces in block comments', () => {
    const schema = `
model User {
  id Int @id
  /* @@map("audit_log") */
  @@map("users")
}

model Ledger {
  id Int @id
  /*
    }
    @@map("old_ledger")
  */
  @@map("ledger")
}
`;

    expect(parseModelIdentities(schema)).toEqual([
      { modelName: 'User', tableName: 'users' },
      { modelName: 'Ledger', tableName: 'ledger' },
    ]);
  });

  it('should reject a malformed mapping directive instead of falling back', () => {
    const schema = `
model User {
  id Int @id
  @@map(123)
}
`;

    expect(() => parseModels(schema)).toThrow(/Invalid Prisma @@map directive/);
  });

  it('should ignore directive-like text inside field strings', () => {
    const schema = `
model Note {
  id Int @id
  note String @default("prefix @@map suffix")
}
`;

    expect(parseModelIdentities(schema)).toEqual([
      { modelName: 'Note', tableName: 'Note' },
    ]);
  });

  it('should return undefined schemaName when @@schema is absent', () => {
    const schema = `
model User {
  id    Int    @id
}
`;
    const models = parseModelIdentities(schema);
    expect(models[0].schemaName).toBeUndefined();
  });

  it('should return empty array for empty schema', () => {
    expect(parseModels('')).toEqual([]);
  });

  it('should handle fields with brace-containing defaults', () => {
    const schema = `
model Config {
  id       Int    @id @default(autoincrement())
  metadata Json   @default("{}")
  settings Json   @default("{\\"key\\": \\"value\\"}")

  @@map("configs")
  @@schema("public")
}
`;
    const models = parseModelIdentities(schema);
    expect(models).toEqual([
      { modelName: 'Config', tableName: 'configs', schemaName: 'public' },
    ]);
  });

  it('should handle dbgenerated defaults with nested parentheses', () => {
    const schema = `
model User {
  id   String @id @default(dbgenerated("gen_random_uuid()"))
  name String

  @@map("users")
}
`;
    const models = parseModelIdentities(schema);
    expect(models).toEqual([
      { modelName: 'User', tableName: 'users' },
    ]);
  });

  it('should preserve field mappings, scalar types, native arguments, and arity', () => {
    const schema = String.raw`
model Account {
  id          Int                    @id
  tenantId    String                 @db.Uuid @map("tenant_id")
  displayCode String?                @db.VarChar( 64 )
  aliases     String[]               @db.Char(12)
  legacyKey   Unsupported("citext")
}
`;

    expect(parseModels(schema)[0]?.fields).toEqual([
      {
        fieldName: 'id',
        columnName: 'id',
        scalarType: 'Int',
        arity: 'required',
        nativeTypes: [],
      },
      {
        fieldName: 'tenantId',
        columnName: 'tenant_id',
        scalarType: 'String',
        arity: 'required',
        nativeTypes: [{ namespace: 'db', name: 'Uuid' }],
      },
      {
        fieldName: 'displayCode',
        columnName: 'displayCode',
        scalarType: 'String',
        arity: 'optional',
        nativeTypes: [{ namespace: 'db', name: 'VarChar', args: '64' }],
      },
      {
        fieldName: 'aliases',
        columnName: 'aliases',
        scalarType: 'String',
        arity: 'list',
        nativeTypes: [{ namespace: 'db', name: 'Char', args: '12' }],
      },
      {
        fieldName: 'legacyKey',
        columnName: 'legacyKey',
        scalarType: 'Unsupported',
        arity: 'required',
        nativeTypes: [],
      },
    ]);
  });

  it('should decode an escaped field mapping and preserve its native namespace', () => {
    const schema = String.raw`
model Account {
  tenantId String @database.Uuid @map("tenant\"id")
}
`;

    expect(parseModels(schema)[0]?.fields).toEqual([{
      fieldName: 'tenantId',
      columnName: 'tenant"id',
      scalarType: 'String',
      arity: 'required',
      nativeTypes: [{ namespace: 'database', name: 'Uuid' }],
    }]);
  });

  it('should preserve Unicode model, field, and datasource identifiers', () => {
    const schema = `
datasource 데이터 {
  provider = "postgresql"
}

model 계정 {
  식별자   Int    @id
  tenant가 String @데이터.Uuid @map("tenant_id")
}
`;

    expect(parseModels(schema)).toEqual([{
      modelName: '계정',
      tableName: '계정',
      schemaName: undefined,
      fields: [
        {
          fieldName: '식별자',
          columnName: '식별자',
          scalarType: 'Int',
          arity: 'required',
          nativeTypes: [],
        },
        {
          fieldName: 'tenant가',
          columnName: 'tenant_id',
          scalarType: 'String',
          arity: 'required',
          nativeTypes: [{ namespace: '데이터', name: 'Uuid' }],
        },
      ],
    }]);
  });

  it('should preserve Unsupported types containing parentheses in their string', () => {
    const schema = `
model Account {
  tenant_id Unsupported("geography(Point,4326)")
}
`;

    expect(parseModels(schema)[0]?.fields).toEqual([{
      fieldName: 'tenant_id',
      columnName: 'tenant_id',
      scalarType: 'Unsupported',
      arity: 'required',
      nativeTypes: [],
    }]);
  });

  it('should preserve escaped Unsupported type text and reject an unterminated declaration', () => {
    const escaped = String.raw`
model Account {
  tenant_id Unsupported("geography\n(Point,4326)")
}
`;
    const unterminated = `
model Account {
  tenant_id Unsupported("geography(Point,4326)"
}
`;

    expect(parseModels(escaped)[0]?.fields).toEqual([{
      fieldName: 'tenant_id',
      columnName: 'tenant_id',
      scalarType: 'Unsupported',
      arity: 'required',
      nativeTypes: [],
    }]);
    expect(parseModels(unterminated)[0]?.fields).toEqual([]);
  });

  it('should treat a bare Unsupported identifier conservatively', () => {
    const schema = `
model Account {
  tenant_id Unsupported
}
`;

    expect(parseModels(schema)[0]?.fields).toEqual([{
      fieldName: 'tenant_id',
      columnName: 'tenant_id',
      scalarType: 'Unsupported',
      arity: 'required',
      nativeTypes: [],
    }]);
  });

  it('should reject a lone low surrogate in a field mapping', () => {
    const schema = String.raw`
model Account {
  tenantId String @map("\uDE00")
}
`;

    expect(() => parseModels(schema)).toThrow(
      /Invalid Prisma field @map string literal/,
    );
  });

  it('should ignore malformed field type suffixes instead of inferring metadata', () => {
    const schema = `
model Account {
  tenant_id String! @db.Text
}
`;

    expect(parseModels(schema)[0]?.fields).toEqual([]);
  });

  it('should preserve @ignore without matching directive text in strings', () => {
    const schema = `
model Account {
  note      String @default("@ignore")
  tenant_id String @db.Uuid @ignore
}
`;

    expect(parseModels(schema)[0]?.fields).toEqual([
      {
        fieldName: 'note',
        columnName: 'note',
        scalarType: 'String',
        arity: 'required',
        nativeTypes: [],
      },
      {
        fieldName: 'tenant_id',
        columnName: 'tenant_id',
        scalarType: 'String',
        arity: 'required',
        nativeTypes: [{ namespace: 'db', name: 'Uuid' }],
        ignored: true,
      },
    ]);
  });

  it('should ignore field directives inside comments and string defaults', () => {
    const schema = String.raw`
model Account {
  // ignored String @db.Uuid @map("tenant_id")
  note      String @default("@map(\"tenant_id\") @db.Uuid")
  tenant_id String @db.Text
}
`;

    expect(parseModels(schema)[0]?.fields).toEqual([
      {
        fieldName: 'note',
        columnName: 'note',
        scalarType: 'String',
        arity: 'required',
        nativeTypes: [],
      },
      {
        fieldName: 'tenant_id',
        columnName: 'tenant_id',
        scalarType: 'String',
        arity: 'required',
        nativeTypes: [{ namespace: 'db', name: 'Text' }],
      },
    ]);
  });

  it('should attach native type and mapping attributes continued on following lines', () => {
    const schema = `
model Account {
  tenantId String
    @map("tenant_id")
    @db.Uuid
}
`;

    expect(parseModels(schema)[0]?.fields).toEqual([{
      fieldName: 'tenantId',
      columnName: 'tenant_id',
      scalarType: 'String',
      arity: 'required',
      nativeTypes: [{ namespace: 'db', name: 'Uuid' }],
    }]);
  });

  it('should reject duplicate field mapping directives', () => {
    const schema = `
model Account {
  tenantId String @map("tenant_id") @map("other_tenant_id")
}
`;

    expect(() => parseModels(schema)).toThrow(
      /cannot declare more than one @map directive/i,
    );
  });
});
