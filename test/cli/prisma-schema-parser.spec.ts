import { parseModels } from '../../src/cli/prisma-schema-parser';

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
    const models = parseModels(schema);
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
    const models = parseModels(schema);
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
    const models = parseModels(schema);
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
    const models = parseModels(schema);
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

    expect(parseModels(schema)).toEqual([{
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

    expect(parseModels(schema)).toEqual([{
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

    expect(parseModels(validSchema)).toEqual([
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

    expect(parseModels(schema)).toEqual([
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

    expect(parseModels(schema)).toEqual([
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

    expect(parseModels(schema)).toEqual([
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

    expect(parseModels(schema)).toEqual([
      { modelName: 'Note', tableName: 'Note' },
    ]);
  });

  it('should return undefined schemaName when @@schema is absent', () => {
    const schema = `
model User {
  id    Int    @id
}
`;
    const models = parseModels(schema);
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
    const models = parseModels(schema);
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
    const models = parseModels(schema);
    expect(models).toEqual([
      { modelName: 'User', tableName: 'users' },
    ]);
  });
});
