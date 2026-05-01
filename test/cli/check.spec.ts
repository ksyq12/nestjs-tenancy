import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { runCheck } from '../../src/cli/check';
import { generateSetupSql } from '../../src/cli/templates/setup-sql';

describe('runCheck', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tenancy-check-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeSchema(content: string): void {
    fs.writeFileSync(path.join(tmpDir, 'schema.prisma'), content, 'utf-8');
  }

  function writeSql(content: string): void {
    fs.writeFileSync(path.join(tmpDir, 'tenancy-setup.sql'), content, 'utf-8');
  }

  it('should report in sync when SQL matches schema', () => {
    writeSchema(`
model User {
  id String @id
  tenant_id String
  @@map("users")
}
model Post {
  id String @id
  tenant_id String
}
    `);

    const sql = generateSetupSql({
      models: [
        { modelName: 'User', tableName: 'users' },
        { modelName: 'Post', tableName: 'Post' },
      ],
      dbSettingKey: 'app.current_tenant',
      sharedModels: [],
      tenantIdField: 'tenant_id',
    });
    writeSql(sql);

    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(true);
    expect(result.missingPolicies).toHaveLength(0);
    expect(result.extraPolicies).toHaveLength(0);
  });

  it('should detect missing policies', () => {
    writeSchema(`
model User {
  id String @id
  tenant_id String
}
model Post {
  id String @id
  tenant_id String
}
    `);

    // SQL only has User, not Post
    const sql = generateSetupSql({
      models: [{ modelName: 'User', tableName: 'User' }],
      dbSettingKey: 'app.current_tenant',
      sharedModels: [],
      tenantIdField: 'tenant_id',
    });
    writeSql(sql);

    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(false);
    expect(result.missingPolicies).toContain('"Post"');
  });

  it('should detect extra policies', () => {
    writeSchema(`
model User {
  id String @id
  tenant_id String
}
    `);

    // SQL has both User and DeletedModel
    const sql = generateSetupSql({
      models: [
        { modelName: 'User', tableName: 'User' },
        { modelName: 'DeletedModel', tableName: 'DeletedModel' },
      ],
      dbSettingKey: 'app.current_tenant',
      sharedModels: [],
      tenantIdField: 'tenant_id',
    });
    writeSql(sql);

    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(false);
    expect(result.extraPolicies).toContain('"DeletedModel"');
  });

  it('should handle shared models correctly', () => {
    writeSchema(`
model User {
  id String @id
  tenant_id String
}
model Country {
  id String @id
  code String
}
    `);

    const sql = generateSetupSql({
      models: [
        { modelName: 'User', tableName: 'User' },
        { modelName: 'Country', tableName: 'Country' },
      ],
      dbSettingKey: 'app.current_tenant',
      sharedModels: ['Country'],
      tenantIdField: 'tenant_id',
    });
    writeSql(sql);

    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(true);
  });

  it('should handle schema-qualified names', () => {
    writeSchema(`
model User {
  id String @id
  tenant_id String
  @@schema("auth")
  @@map("users")
}
    `);

    const sql = generateSetupSql({
      models: [{ modelName: 'User', tableName: 'users', schemaName: 'auth' }],
      dbSettingKey: 'app.current_tenant',
      sharedModels: [],
      tenantIdField: 'tenant_id',
    });
    writeSql(sql);

    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(true);
  });

  it('should ignore user-managed SQL outside generated boundaries', () => {
    writeSchema(`
model User {
  id String @id
  tenant_id String
}
    `);

    const sql = generateSetupSql({
      models: [{ modelName: 'User', tableName: 'User' }],
      dbSettingKey: 'app.current_tenant',
      sharedModels: [],
      tenantIdField: 'tenant_id',
    });
    writeSql(`${sql}\n\n-- user-managed SQL\nALTER TABLE "ManualAudit" ENABLE ROW LEVEL SECURITY;`);

    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(true);
    expect(result.extraPolicies).toHaveLength(0);
  });

  it('should not parse SQL comments as part of RLS table names', () => {
    writeSchema(`
model User {
  id String @id
  tenant_id String
}
    `);

    writeSql([
      'ALTER TABLE "User" -- operator note',
      '  ENABLE ROW LEVEL SECURITY;',
      'ALTER TABLE "User" FORCE ROW LEVEL SECURITY;',
      "CREATE POLICY tenant_isolation_User ON \"User\"",
      "  USING (tenant_id = current_setting('app.current_tenant', true)::text);",
      "CREATE POLICY tenant_insert_User ON \"User\"",
      "  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::text);",
    ].join('\n'));

    const result = runCheck({ cwd: tmpDir });
    expect(result.extraPolicies).not.toContain('"User" -- operator note');
    expect(result.missingPolicies).toHaveLength(0);
    expect(result.inSync).toBe(true);
  });

  it('should return not in sync when schema.prisma is missing', () => {
    writeSql('-- some sql');
    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(false);
  });

  it('should return not in sync when tenancy-setup.sql is missing', () => {
    writeSchema('model User {\nid String @id\n}');
    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(false);
  });

  describe('deep checks', () => {
    it('should warn when FORCE ROW LEVEL SECURITY is missing', () => {
      writeSchema(`
model User {
  id String @id
  tenant_id String
}
      `);

      // Manually craft SQL missing FORCE
      const sql = [
        'ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;',
        // Missing: ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
        "CREATE POLICY tenant_isolation_User ON \"User\"",
        "  USING (tenant_id = current_setting('app.current_tenant', true)::text);",
        "CREATE POLICY tenant_insert_User ON \"User\"",
        "  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::text);",
      ].join('\n');
      writeSql(sql);

      const result = runCheck({ cwd: tmpDir });
      expect(result.inSync).toBe(false);
      expect(result.warnings).toContainEqual(
        expect.stringContaining('FORCE ROW LEVEL SECURITY'),
      );
    });

    it('should warn when isolation policy is missing', () => {
      writeSchema(`
model User {
  id String @id
  tenant_id String
}
      `);

      const sql = [
        'ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;',
        'ALTER TABLE "User" FORCE ROW LEVEL SECURITY;',
        // Missing: CREATE POLICY tenant_isolation_User
        "CREATE POLICY tenant_insert_User ON \"User\"",
        "  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::text);",
      ].join('\n');
      writeSql(sql);

      const result = runCheck({ cwd: tmpDir });
      expect(result.inSync).toBe(false);
      expect(result.warnings).toContainEqual(
        expect.stringContaining('tenant_isolation'),
      );
    });

    it('should warn when insert policy is missing', () => {
      writeSchema(`
model User {
  id String @id
  tenant_id String
}
      `);

      const sql = [
        'ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;',
        'ALTER TABLE "User" FORCE ROW LEVEL SECURITY;',
        "CREATE POLICY tenant_isolation_User ON \"User\"",
        "  USING (tenant_id = current_setting('app.current_tenant', true)::text);",
        // Missing: CREATE POLICY tenant_insert_User
      ].join('\n');
      writeSql(sql);

      const result = runCheck({ cwd: tmpDir });
      expect(result.inSync).toBe(false);
      expect(result.warnings).toContainEqual(
        expect.stringContaining('tenant_insert'),
      );
    });

    it('should warn when setting key does not match', () => {
      writeSchema(`
model User {
  id String @id
  tenant_id String
}
      `);

      const sql = generateSetupSql({
        models: [{ modelName: 'User', tableName: 'User' }],
        dbSettingKey: 'app.wrong_key',
        sharedModels: [],
        tenantIdField: 'tenant_id',
      });
      writeSql(sql);

      const result = runCheck({ cwd: tmpDir, dbSettingKey: 'app.current_tenant' });
      expect(result.inSync).toBe(false);
      expect(result.warnings).toContainEqual(
        expect.stringContaining('Setting key mismatch'),
      );
    });

    it('should detect mixed setting keys (first correct, second wrong)', () => {
      writeSchema(`
model User {
  id String @id
  tenant_id String
}
model Post {
  id String @id
  tenant_id String
}
      `);

      // Manually craft SQL: User has correct key, Post has wrong key
      const sql = [
        'ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;',
        'ALTER TABLE "User" FORCE ROW LEVEL SECURITY;',
        "CREATE POLICY tenant_isolation_User ON \"User\"",
        "  USING (tenant_id = current_setting('app.current_tenant', true)::text);",
        "CREATE POLICY tenant_insert_User ON \"User\"",
        "  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::text);",
        'ALTER TABLE "Post" ENABLE ROW LEVEL SECURITY;',
        'ALTER TABLE "Post" FORCE ROW LEVEL SECURITY;',
        "CREATE POLICY tenant_isolation_Post ON \"Post\"",
        "  USING (tenant_id = current_setting('app.wrong_key', true)::text);",
        "CREATE POLICY tenant_insert_Post ON \"Post\"",
        "  FOR INSERT WITH CHECK (tenant_id = current_setting('app.wrong_key', true)::text);",
      ].join('\n');
      writeSql(sql);

      const result = runCheck({ cwd: tmpDir });
      expect(result.inSync).toBe(false);
      expect(result.warnings).toContainEqual(
        expect.stringContaining('Setting key mismatch'),
      );
      // Should find at least 2 mismatches (isolation + insert policy for Post)
      const keyWarnings = result.warnings.filter(w => w.includes('Setting key mismatch'));
      expect(keyWarnings.length).toBeGreaterThanOrEqual(2);
    });

    it('should accept custom dbSettingKey and validate against it', () => {
      writeSchema(`
model User {
  id String @id
  tenant_id String
}
      `);

      const sql = generateSetupSql({
        models: [{ modelName: 'User', tableName: 'User' }],
        dbSettingKey: 'custom.tenant_key',
        sharedModels: [],
        tenantIdField: 'tenant_id',
      });
      writeSql(sql);

      // With matching custom key — should be in sync
      const result = runCheck({ cwd: tmpDir, dbSettingKey: 'custom.tenant_key' });
      expect(result.inSync).toBe(true);
      expect(result.warnings).toHaveLength(0);

      // With default key — should report mismatch
      const resultDefault = runCheck({ cwd: tmpDir });
      expect(resultDefault.inSync).toBe(false);
      expect(resultDefault.warnings).toContainEqual(
        expect.stringContaining('Setting key mismatch'),
      );
    });

    it('should return no warnings for properly generated SQL', () => {
      writeSchema(`
model User {
  id String @id
  tenant_id String
}
      `);

      const sql = generateSetupSql({
        models: [{ modelName: 'User', tableName: 'User' }],
        dbSettingKey: 'app.current_tenant',
        sharedModels: [],
        tenantIdField: 'tenant_id',
      });
      writeSql(sql);

      const result = runCheck({ cwd: tmpDir });
      expect(result.warnings).toHaveLength(0);
      expect(result.inSync).toBe(true);
    });
  });
});
