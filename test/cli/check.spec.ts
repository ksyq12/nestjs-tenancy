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

  it('should recognize safely quoted mapped names from generated SQL', () => {
    writeSchema(String.raw`
model LedgerEntry {
  id String @id
  tenant_id String
  @@schema("tenant\"ops")
  @@map("ledger;current_setting(fake, true)--archive\nnext")
}
    `);

    const sql = generateSetupSql({
      models: [{
        modelName: 'LedgerEntry',
        schemaName: 'tenant"ops',
        tableName: 'ledger;current_setting(fake, true)--archive\nnext',
      }],
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
      'CREATE INDEX IF NOT EXISTS tenancy_User_tenant_id_idx ON "User" (tenant_id);',
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

  it('should not accept policy evidence inside a block comment', () => {
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
    writeSql('/*\n' + sql + '\n*/');

    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(false);
    expect(result.missingPolicies).toContain('"User"');
  });

  it('should ignore statement-like text inside an escape string', () => {
    writeSchema(`
model User {
  id String @id
  tenant_id String
}
    `);
    writeSql(String.raw`SELECT E'note\' ALTER TABLE "User" ENABLE ROW LEVEL SECURITY';`);

    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(false);
    expect(result.missingPolicies).toContain('"User"');
  });

  it('should keep generated markers visible after identifier dollar characters', () => {
    writeSchema(`
model User {
  id String @id
  tenant_id String
}
    `);
    const generated = generateSetupSql({
      models: [{ modelName: 'User', tableName: 'User' }],
      dbSettingKey: 'app.current_tenant',
      sharedModels: [],
      tenantIdField: 'tenant_id',
    });
    const outside = generated
      .replace('-- BEGIN GENERATED TENANCY SQL\n', '')
      .replace('-- END GENERATED TENANCY SQL', '');
    const tenantPredicate =
      '"tenant_id" = current_setting(\'app.current_tenant\', true)::text';
    const driftedGenerated = generated.split(tenantPredicate).join('true');
    writeSql([
      outside,
      'SELECT prefix$tag$;',
      driftedGenerated,
      'SELECT $tag$;',
    ].join('\n'));

    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.stringContaining('invalid tenant_isolation'),
    );
  });

  it('should recognize a valid tagged dollar-quoted string', () => {
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
    writeSql(sql.replace(
      '-- END GENERATED TENANCY SQL',
      'SELECT $tag$x$tag$;\n-- END GENERATED TENANCY SQL',
    ));

    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(true);
    expect(result.warnings).toHaveLength(0);
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
        'CREATE INDEX IF NOT EXISTS tenancy_User_tenant_id_idx ON "User" (tenant_id);',
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
        'CREATE INDEX IF NOT EXISTS tenancy_User_tenant_id_idx ON "User" (tenant_id);',
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
        'CREATE INDEX IF NOT EXISTS tenancy_User_tenant_id_idx ON "User" (tenant_id);',
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

    it('should reject policies that do not enforce the tenant predicate', () => {
      writeSchema(`
model User {
  id String @id
  tenant_id String
}
      `);
      writeSql([
        'ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;',
        'ALTER TABLE "User" FORCE ROW LEVEL SECURITY;',
        'CREATE INDEX tenancy_User_tenant_id_idx ON "User" ("tenant_id");',
        'CREATE POLICY tenant_isolation_User ON "User" USING (true);',
        'CREATE POLICY tenant_insert_User ON "User" FOR INSERT WITH CHECK (true);',
      ].join('\n'));

      const result = runCheck({ cwd: tmpDir });
      expect(result.inSync).toBe(false);
      expect(result.warnings).toContainEqual(
        expect.stringContaining('invalid tenant_isolation'),
      );
      expect(result.warnings).toContainEqual(
        expect.stringContaining('invalid tenant_insert'),
      );
    });

    it('should reject clauses appended to an expected policy statement', () => {
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
      const tenantPredicate =
        '"tenant_id" = current_setting(\'app.current_tenant\', true)::text';
      writeSql(sql.replace(
        `  USING (${tenantPredicate});`,
        `  USING (${tenantPredicate}) WITH CHECK (${tenantPredicate});`,
      ));

      const result = runCheck({ cwd: tmpDir });
      expect(result.inSync).toBe(false);
      expect(result.warnings).toContainEqual(
        expect.stringContaining('invalid tenant_isolation'),
      );
    });

    it('should reject unexpected permissive policies in generated SQL', () => {
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
      const additionalPolicy = [
        'CREATE POLICY auxiliary_tenant_policy ON "User" AS PERMISSIVE FOR SELECT',
        "  USING (\"tenant_id\" = current_setting('app.current_tenant', true)::text);",
      ].join('\n');
      writeSql(sql.replace(
        '-- END GENERATED TENANCY SQL',
        `${additionalPolicy}\n-- END GENERATED TENANCY SQL`,
      ));

      const result = runCheck({ cwd: tmpDir });
      expect(result.inSync).toBe(false);
      expect(result.warnings).toContainEqual(
        expect.stringContaining('unexpected permissive policy'),
      );
    });

    it('should not confuse SQL identifiers with internal string tokens', () => {
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
      const withIdentifierKeys = sql.split("'app.current_tenant'").join(
        '__TENANCY_SQL_STRING_0__',
      );
      writeSql(withIdentifierKeys.replace(
        '-- Create a non-superuser role for the application',
        "SELECT 'app.current_tenant';\n\n-- Create a non-superuser role for the application",
      ));

      const result = runCheck({ cwd: tmpDir });
      expect(result.inSync).toBe(false);
      expect(result.warnings).toContainEqual(
        expect.stringContaining('invalid tenant_isolation'),
      );
    });

    it.each([
      ["E'app.current_tenant'"],
      ["U&'app.current_tenant'"],
      ['$key$app.current_tenant$key$'],
    ])('should reject non-standard current_setting argument %s', (argument) => {
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
      writeSql(sql.replace(
        '-- END GENERATED TENANCY SQL',
        `SELECT current_setting(${argument}, true);\n-- END GENERATED TENANCY SQL`,
      ));

      const result = runCheck({ cwd: tmpDir });
      expect(result.inSync).toBe(false);
      expect(result.warnings).toContainEqual(
        expect.stringContaining('unsupported current_setting() argument'),
      );
    });

    it.each([
      [
        'policy alteration',
        'ALTER POLICY tenant_isolation_User ON "User" RENAME TO renamed_policy;',
      ],
      [
        'policy removal',
        'DROP POLICY tenant_isolation_User ON "User";',
      ],
      [
        'RLS disablement',
        'ALTER TABLE "User" DISABLE ROW LEVEL SECURITY;',
      ],
      [
        'FORCE removal',
        'ALTER TABLE "User" NO FORCE ROW LEVEL SECURITY;',
      ],
    ])('should reject generated-section %s', (_label, mutation) => {
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
      writeSql(sql.replace(
        '-- END GENERATED TENANCY SQL',
        `${mutation}\n-- END GENERATED TENANCY SQL`,
      ));

      const result = runCheck({ cwd: tmpDir });
      expect(result.inSync).toBe(false);
      expect(result.warnings).toContainEqual(
        expect.stringContaining('unexpected policy or RLS mutation'),
      );
    });

    it.each([
      'ALTER TABLE users DISABLE ROW LEVEL SECURITY;',
      'ALTER TABLE public.users DISABLE ROW LEVEL SECURITY;',
      'ALTER TABLE U&"users" NO FORCE ROW LEVEL SECURITY;',
      'ALTER TABLE users DISABLE ROW LEVEL SECURITY, ADD COLUMN harmless integer;',
      'ALTER TABLE users ADD COLUMN first integer, DISABLE ROW LEVEL SECURITY, ADD COLUMN last integer;',
      'ALTER TABLE users ADD COLUMN harmless integer, NO FORCE ROW LEVEL SECURITY;',
      'ALTER TABLE users ADD COLUMN first integer,DISABLE ROW LEVEL SECURITY,ADD COLUMN last integer;',
      'ALTER TABLE users ADD COLUMN harmless integer,NO FORCE ROW LEVEL SECURITY;',
      'ALTER POLICY U&"tenant_isolation_User" ON users RENAME TO changed_policy;',
      'CREATE POLICY π ON users USING (true);',
    ])('should fail closed for alternate identifier syntax: %s', (statement) => {
      writeSchema(`
model User {
  id String @id
  tenant_id String

  @@map("users")
}
      `);
      const sql = generateSetupSql({
        models: [{ modelName: 'User', tableName: 'users' }],
        dbSettingKey: 'app.current_tenant',
        sharedModels: [],
        tenantIdField: 'tenant_id',
      });
      writeSql(sql.replace(
        '-- END GENERATED TENANCY SQL',
        `${statement}\n-- END GENERATED TENANCY SQL`,
      ));

      const result = runCheck({ cwd: tmpDir });
      expect(result.inSync).toBe(false);
      expect(result.warnings).toContainEqual(
        expect.stringMatching(/unexpected|unsupported/),
      );
    });

    it('should ignore mutation keywords that occur only inside an identifier', () => {
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
      writeSql(sql.replace(
        '-- END GENERATED TENANCY SQL',
        'ALTER TABLE "User" RENAME COLUMN "old" TO "DISABLE ROW LEVEL SECURITY";\n-- END GENERATED TENANCY SQL',
      ));

      expect(runCheck({ cwd: tmpDir }).warnings).not.toContainEqual(
        expect.stringContaining('unexpected policy or RLS mutation'),
      );
    });

    it('should require quoted syntax for non-simple tenant identifiers', () => {
      writeSchema(`
model User {
  id String @id
  tenant_id String
}
      `);
      writeSql([
        'ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;',
        'ALTER TABLE "User" FORCE ROW LEVEL SECURITY;',
        'CREATE INDEX tenancy_User_tenant_idx ON "User" (tenant-id);',
        'CREATE POLICY tenant_isolation_User ON "User"',
        "  USING (tenant-id = current_setting('app.current_tenant', true)::text);",
        'CREATE POLICY tenant_insert_User ON "User" FOR INSERT',
        "  WITH CHECK (tenant-id = current_setting('app.current_tenant', true)::text);",
      ].join('\n'));

      const result = runCheck({ cwd: tmpDir, tenantIdField: 'tenant-id' });
      expect(result.inSync).toBe(false);
      expect(result.warnings).toContainEqual(
        expect.stringContaining('invalid tenant_isolation'),
      );
      expect(result.warnings).toContainEqual(
        expect.stringContaining('invalid tenant_insert'),
      );
      expect(result.warnings).toContainEqual(
        expect.stringContaining('missing tenant index'),
      );
    });

    it('should warn when tenant index is missing', () => {
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
        "CREATE POLICY tenant_insert_User ON \"User\"",
        "  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::text);",
      ].join('\n');
      writeSql(sql);

      const result = runCheck({ cwd: tmpDir });
      expect(result.inSync).toBe(false);
      expect(result.warnings).toContainEqual(
        expect.stringContaining('missing tenant index'),
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
        'CREATE INDEX IF NOT EXISTS tenancy_User_tenant_id_idx ON "User" (tenant_id);',
        "CREATE POLICY tenant_isolation_User ON \"User\"",
        "  USING (tenant_id = current_setting('app.current_tenant', true)::text);",
        "CREATE POLICY tenant_insert_User ON \"User\"",
        "  FOR INSERT WITH CHECK (tenant_id = current_setting('app.current_tenant', true)::text);",
        'ALTER TABLE "Post" ENABLE ROW LEVEL SECURITY;',
        'ALTER TABLE "Post" FORCE ROW LEVEL SECURITY;',
        'CREATE INDEX IF NOT EXISTS tenancy_Post_tenant_id_idx ON "Post" (tenant_id);',
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

    it('should reject an invalid expected database setting key', () => {
      const result = runCheck({ cwd: tmpDir, dbSettingKey: 'not_dotted' });

      expect(result.inSync).toBe(false);
      expect(result.warnings).toContainEqual(
        expect.stringContaining('Invalid database setting key'),
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
