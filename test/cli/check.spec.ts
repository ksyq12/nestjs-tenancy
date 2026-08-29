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

  it('should accept generated SQL with CRLF line endings', () => {
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
    writeSql(sql.replace(/\n/g, '\r\n'));

    expect(runCheck({ cwd: tmpDir }).inSync).toBe(true);
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
    expect(result.extraPolicies).toContain('"public"."DeletedModel"');
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

  it('should not treat a lone shared-model comment as complete setup', () => {
    writeSchema(`
model User {
  id String @id
  tenant_id String
}
    `);
    writeSql('-- User (shared model)');

    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(false);
    expect(result.missingPolicies).toContain('"User"');
  });

  it('should reject an unqualified shared-model grant in generated boundaries', () => {
    writeSchema(`
model Country {
  id String @id
  code String
}
    `);
    const sql = generateSetupSql({
      models: [{ modelName: 'Country', tableName: 'Country' }],
      dbSettingKey: 'app.current_tenant',
      sharedModels: ['Country'],
      tenantIdField: 'tenant_id',
    });
    writeSql(sql.split('"public"."Country"').join('"Country"'));

    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.stringContaining('unqualified generated table target'),
    );
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
  @@schema("tenant\"ops$tenancy_policy$$tenancy_identifier$")
  @@map("ledger;current_setting(fake, true)--archive\nnext")
}
    `);

    const sql = generateSetupSql({
      models: [{
        modelName: 'LedgerEntry',
        schemaName: 'tenant"ops$tenancy_policy$$tenancy_identifier$',
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

  it('should reject legacy lossy names inside a canonical generated section', () => {
    writeSchema(`
model AuditLog {
  id String @id
  tenant_id String
  @@map("audit-logs")
}
    `);
    const sql = generateSetupSql({
      models: [{ modelName: 'AuditLog', tableName: 'audit-logs' }],
      dbSettingKey: 'app.current_tenant',
      sharedModels: [],
      tenantIdField: 'tenant_id',
    })
      .split('tenancy_audit_logs_tenant_id_idx_07148afa054f')
      .join('tenancy_audit_logs_tenant_id_idx')
      .split('tenant_isolation_audit_logs_ae80b988a44e')
      .join('tenant_isolation_audit_logs')
      .split('tenant_insert_audit_logs_4aa2515f122e')
      .join('tenant_insert_audit_logs');
    writeSql(sql);

    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(false);
    expect(result.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('missing or invalid tenant_isolation policy'),
      expect.stringContaining('missing or invalid tenant_insert policy'),
      expect.stringContaining('missing tenant index'),
    ]));
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

  it('should reject unqualified public targets inside generated boundaries', () => {
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
    writeSql(sql.split('"public"."User"').join('"User"'));

    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.stringContaining('unqualified generated table target'),
    );
  });

  it.each([
    ['BEGIN', '\nBEGIN;\n'],
    ['COMMIT', '\nCOMMIT;\n'],
  ])('should reject generated SQL without its %s boundary', (_boundary, token) => {
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
    writeSql(sql.replace(token, '\n'));

    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.stringContaining('BEGIN/COMMIT transaction envelope'),
    );
  });

  it.each([
    ['start', '-- BEGIN GENERATED TENANCY SQL'],
    ['end', '-- END GENERATED TENANCY SQL'],
  ])('should reject a generated file missing its %s marker', (_label, marker) => {
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
    writeSql(sql
      .replace('COMMIT;', 'ALTER ROLE app_user BYPASSRLS;\nCOMMIT;')
      .replace(marker, ''));

    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.stringContaining('boundary markers'),
    );
  });

  it('should reject duplicate generated boundary markers', () => {
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
    const marker = '-- BEGIN GENERATED TENANCY SQL';
    writeSql(sql.replace(marker, `${marker}\n${marker}`));

    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.stringContaining('boundary markers'),
    );
  });

  it('should reject unguarded policies inside generated boundaries', () => {
    writeSchema(`
model User {
  id String @id
  tenant_id String
}
    `);
    writeSql([
      '-- BEGIN GENERATED TENANCY SQL',
      'BEGIN;',
      'ALTER TABLE "public"."User" ENABLE ROW LEVEL SECURITY;',
      'ALTER TABLE "public"."User" FORCE ROW LEVEL SECURITY;',
      'CREATE INDEX tenancy_User_tenant_id_idx ON "public"."User" ("tenant_id");',
      'CREATE POLICY tenant_isolation_User ON "public"."User"',
      "  USING (\"tenant_id\" = current_setting('app.current_tenant', true)::text);",
      'CREATE POLICY tenant_insert_User ON "public"."User" FOR INSERT',
      "  WITH CHECK (\"tenant_id\" = current_setting('app.current_tenant', true)::text);",
      'GRANT SELECT, INSERT, UPDATE, DELETE ON "public"."User" TO app_user;',
      'COMMIT;',
      '-- END GENERATED TENANCY SQL',
    ].join('\n'));

    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(false);
    expect(result.warnings).toContain(
      'Generated SQL: unguarded top-level CREATE POLICY',
    );
  });

  it('should reject an unqualified application grant in generated boundaries', () => {
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
      'GRANT SELECT, INSERT, UPDATE, DELETE ON "public"."User" TO app_user;',
      'GRANT SELECT, INSERT, UPDATE, DELETE ON "User" TO app_user;',
    ));

    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.stringContaining('unqualified generated table target'),
    );
    expect(result.warnings).toContain(
      '"public"."User": missing or invalid application table grant',
    );
  });

  it('should reject allowed statement shapes that target non-model objects', () => {
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
    const unexpectedTargets = [
      'GRANT USAGE ON SCHEMA "private" TO app_user;',
      'ALTER TABLE "private"."Secrets" FORCE ROW LEVEL SECURITY;',
      'CREATE INDEX IF NOT EXISTS tenancy_private_secrets_idx ON "private"."Secrets" ("tenant_id");',
      'GRANT SELECT, INSERT, UPDATE, DELETE ON "private"."Secrets" TO app_user;',
      'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "private" TO app_user;',
    ].join('\n');
    writeSql(sql.replace('COMMIT;', `${unexpectedTargets}\nCOMMIT;`));

    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(false);
    expect(result.warnings).toContain(
      'Generated SQL: unexpected table or schema target',
    );
  });

  it('should reject a generated section missing a required schema grant', () => {
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
      'GRANT USAGE ON SCHEMA "public" TO app_user;\n',
      '',
    ));

    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(false);
    expect(result.warnings).toContain(
      'Generated SQL: missing required schema grant',
    );
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

  it('should lex a valid tagged string before rejecting its unsupported statement', () => {
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
      'COMMIT;',
      'SELECT $tag$x$tag$;\nCOMMIT;',
    ));

    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(false);
    expect(result.warnings).not.toContain(
      'Invalid or unsupported SQL lexical structure',
    );
    expect(result.warnings).toContain(
      'Generated SQL: unsupported top-level statement',
    );
  });

  it.each([
    ['rollback', 'ROLLBACK;'],
    ['transaction split', 'commit;\nbegin;'],
  ])('should reject a generated-section %s command', (_label, command) => {
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
    writeSql(sql.replace('COMMIT;', `${command}\nCOMMIT;`));

    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(false);
    expect(result.warnings).toContain(
      'Generated SQL: unsupported top-level statement',
    );
  });

  it('should reject a function-hidden RLS mutation in generated SQL', () => {
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
    const hiddenMutation = [
      'CREATE OR REPLACE FUNCTION m16a_hidden_mutation() RETURNS void',
      'LANGUAGE plpgsql AS $hidden_function$',
      'BEGIN',
      '  EXECUTE \'ALTER TABLE "public"."User" DISABLE ROW LEVEL SECURITY\';',
      'END',
      '$hidden_function$;',
      'SELECT m16a_hidden_mutation();',
      'DROP FUNCTION m16a_hidden_mutation();',
    ].join('\n');
    writeSql(sql.replace('COMMIT;', `${hiddenMutation}\nCOMMIT;`));

    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(false);
    expect(result.warnings).toContain(
      'Generated SQL: unsupported top-level statement',
    );
  });

  it('should fail closed for a hidden mutation in an otherwise canonical DO block', () => {
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
    const hiddenMutation = [
      'DO $hidden_mutation$',
      'BEGIN',
      '  EXECUTE \'ALTER TABLE "public"."User" DISABLE ROW LEVEL SECURITY\';',
      'END',
      '$hidden_mutation$;',
    ].join('\n');
    writeSql(sql.replace(
      'COMMIT;',
      `${hiddenMutation}\nCOMMIT;`,
    ));

    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.stringContaining('unsupported or non-canonical DO block'),
    );
  });

  it('should not accept policy evidence from a non-canonical DO body', () => {
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
      'DO $unverified_policy$',
      'BEGIN',
      '  CREATE POLICY tenant_isolation_User ON "User"',
      "    USING (\"tenant_id\" = current_setting('app.current_tenant', true)::text);",
      '  CREATE POLICY tenant_insert_User ON "User"',
      "    FOR INSERT WITH CHECK (\"tenant_id\" = current_setting('app.current_tenant', true)::text);",
      'END',
      '$unverified_policy$;',
    ].join('\n'));

    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.stringContaining('unsupported or non-canonical DO block'),
    );
    expect(result.warnings).toContainEqual(
      expect.stringContaining('invalid tenant_isolation'),
    );
    expect(result.warnings).toContainEqual(
      expect.stringContaining('invalid tenant_insert'),
    );
  });

  it('should reject a generated policy guard targeting another schema', () => {
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
      'WHERE n.nspname = $tenancy_identifier$public$tenancy_identifier$',
      'WHERE n.nspname = $tenancy_identifier$other$tenancy_identifier$',
    ));

    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.stringContaining('unsupported or non-canonical DO block'),
    );
    expect(result.warnings).toContainEqual(
      expect.stringContaining('invalid tenant_isolation'),
    );
  });

  it('should reject standard-quoted schema identifiers inside a policy guard', () => {
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
      'WHERE n.nspname = $tenancy_identifier$public$tenancy_identifier$',
      "WHERE n.nspname = 'public'",
    ));

    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.stringContaining('unsupported or non-canonical DO block'),
    );
  });

  it('should reject a dollar-quoted policy name inside a policy guard', () => {
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
      "'tenant_isolation_user_940d88379add'::pg_catalog.name",
      '$policy$tenant_isolation_user_940d88379add$policy$::pg_catalog.name',
    ));

    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.stringContaining('unsupported or non-canonical DO block'),
    );
  });

  it('should reject a non-standard setting literal inside a policy guard', () => {
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
      "current_setting('app.current_tenant', true)",
      'current_setting($setting$app.current_tenant$setting$, true)',
    ));

    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.stringContaining('unsupported or non-canonical DO block'),
    );
    expect(result.warnings).toContainEqual(
      expect.stringContaining('invalid tenant_isolation'),
    );
  });

  it('should reject an overlong schema literal inside a policy guard', () => {
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
    const overlongSchema = 's'.repeat(64);
    writeSql(sql
      .replace(
        'WHERE n.nspname = $tenancy_identifier$public$tenancy_identifier$',
        `WHERE n.nspname = $tenancy_identifier$${overlongSchema}$tenancy_identifier$`,
      )
      .replace(
        'CREATE POLICY tenant_isolation_User_940d88379add ON "public"."User"',
        `CREATE POLICY tenant_isolation_User_940d88379add ON "${overlongSchema}"."User"`,
      ));

    const result = runCheck({ cwd: tmpDir });
    expect(result.inSync).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.stringContaining('unsupported or non-canonical DO block'),
    );
    expect(result.warnings).toContainEqual(
      expect.stringContaining('invalid tenant_isolation'),
    );
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
        'CREATE POLICY auxiliary_tenant_policy ON "public"."User" AS PERMISSIVE FOR SELECT',
        "  USING (\"tenant_id\" = current_setting('app.current_tenant', true)::text);",
      ].join('\n');
      writeSql(sql.replace(
        '-- END GENERATED TENANCY SQL',
        `${additionalPolicy}\n-- END GENERATED TENANCY SQL`,
      ));

      const result = runCheck({ cwd: tmpDir });
      expect(result.inSync).toBe(false);
      expect(result.warnings).toContain(
        '"public"."User": unexpected permissive policy',
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
