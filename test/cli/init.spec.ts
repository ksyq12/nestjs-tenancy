import * as fs from 'fs';
import * as path from 'path';

jest.mock('prompts', () => jest.fn());

import { runInit } from '../../src/cli/init';
import { runCli } from '../../src/cli';

describe('CLI init', () => {
  const tmpDir = path.join(__dirname, 'tmp-init-test');

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should generate setup.sql with RLS policies', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'schema.prisma'),
      'model User {\n  id Int @id\n  tenant_id String\n}\n',
    );

    const prompts = require('prompts') as jest.Mock;
    prompts.mockClear();
    prompts.mockResolvedValue({
      extractor: 'Header (X-Tenant-Id)',
      tenantFormat: 'UUID',
      dbSettingKey: 'app.current_tenant',
      autoInject: true,
      sharedModels: '',
    });

    await runInit({ cwd: tmpDir });

    const sqlPath = path.join(tmpDir, 'tenancy-setup.sql');
    expect(fs.existsSync(sqlPath)).toBe(true);

    const sql = fs.readFileSync(sqlPath, 'utf-8');
    expect(sql).toContain('ALTER TABLE "User" ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('app.current_tenant');
  });

  it('should generate module setup file', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'schema.prisma'),
      'model User {\n  id Int @id\n}\n',
    );

    const prompts = require('prompts') as jest.Mock;
    prompts.mockResolvedValue({
      extractor: 'Header (X-Tenant-Id)',
      tenantFormat: 'UUID',
      dbSettingKey: 'app.current_tenant',
      autoInject: false,
      sharedModels: '',
    });

    await runInit({ cwd: tmpDir });

    const modulePath = path.join(tmpDir, 'tenancy.module-setup.ts');
    expect(fs.existsSync(modulePath)).toBe(true);
    const content = fs.readFileSync(modulePath, 'utf-8');
    expect(content).toContain('TenancyModule.forRoot');
  });

  it('should handle @@map in schema', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'schema.prisma'),
      'model User {\n  id Int @id\n\n  @@map("users")\n}\n',
    );

    const prompts = require('prompts') as jest.Mock;
    prompts.mockResolvedValue({
      extractor: 'Header (X-Tenant-Id)',
      tenantFormat: 'UUID',
      dbSettingKey: 'app.current_tenant',
      autoInject: false,
      sharedModels: '',
    });

    await runInit({ cwd: tmpDir });

    const sql = fs.readFileSync(path.join(tmpDir, 'tenancy-setup.sql'), 'utf-8');
    expect(sql).toContain('"users"');
    expect(sql).not.toContain('"User"');
  });

  it('should safely encode escaped mapped schema and table names', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'schema.prisma'),
      String.raw`model LedgerEntry {
  id Int @id
  tenant_id String

  @@schema("tenant\"ops")
  @@map("ledger;\narchive")
}
`,
    );

    const prompts = require('prompts') as jest.Mock;
    prompts.mockResolvedValue({
      extractor: 'Header (X-Tenant-Id)',
      tenantFormat: 'UUID',
      dbSettingKey: 'app.current_tenant',
      autoInject: false,
      sharedModels: '',
    });

    await runInit({ cwd: tmpDir });

    const sql = fs.readFileSync(path.join(tmpDir, 'tenancy-setup.sql'), 'utf-8');
    expect(sql).toContain(
      'ALTER TABLE "tenant""ops"."ledger;\narchive" ENABLE ROW LEVEL SECURITY;',
    );
  });

  it('should generate proper imports for non-Header extractor (Subdomain)', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'schema.prisma'),
      'model User {\n  id Int @id\n  tenant_id String\n}\n',
    );

    const prompts = require('prompts') as jest.Mock;
    prompts.mockResolvedValue({
      extractor: 'Subdomain (tenant1.app.com)',
      tenantFormat: 'UUID',
      dbSettingKey: 'app.current_tenant',
      autoInject: false,
      sharedModels: '',
    });

    await runInit({ cwd: tmpDir });

    const modulePath = path.join(tmpDir, 'tenancy.module-setup.ts');
    expect(fs.existsSync(modulePath)).toBe(true);
    const content = fs.readFileSync(modulePath, 'utf-8');
    expect(content).toContain('SubdomainTenantExtractor');
    expect(content).toContain('TenancyModule, SubdomainTenantExtractor');
    expect(content).toContain('// import { createPrismaTenancyExtension }');
    expect(content).toContain('new SubdomainTenantExtractor()');
  });

  it('should generate proper imports for JWT Claim extractor', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'schema.prisma'),
      'model User {\n  id Int @id\n  tenant_id String\n}\n',
    );

    const prompts = require('prompts') as jest.Mock;
    prompts.mockResolvedValue({
      extractor: 'JWT Claim',
      tenantFormat: 'UUID',
      dbSettingKey: 'app.current_tenant',
      autoInject: false,
      sharedModels: '',
    });

    await runInit({ cwd: tmpDir });

    const modulePath = path.join(tmpDir, 'tenancy.module-setup.ts');
    const content = fs.readFileSync(modulePath, 'utf-8');
    expect(content).toContain('JwtClaimTenantExtractor');
    expect(content).toContain('TenancyModule, JwtClaimTenantExtractor');
    expect(content).toContain('// import { createPrismaTenancyExtension }');
  });

  it('should include a commented Prisma extension import when autoInject is true', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'schema.prisma'),
      'model User {\n  id Int @id\n  tenant_id String\n}\n',
    );

    const prompts = require('prompts') as jest.Mock;
    prompts.mockResolvedValue({
      extractor: 'Subdomain (tenant1.app.com)',
      tenantFormat: 'UUID',
      dbSettingKey: 'app.current_tenant',
      autoInject: true,
      sharedModels: '',
    });

    await runInit({ cwd: tmpDir });

    const modulePath = path.join(tmpDir, 'tenancy.module-setup.ts');
    const content = fs.readFileSync(modulePath, 'utf-8');
    expect(content).toContain('createPrismaTenancyExtension');
    expect(content).toContain('SubdomainTenantExtractor');
    expect(content).toContain("import { TenancyModule, SubdomainTenantExtractor } from '@nestarc/tenancy'");
    expect(content).toContain("// import { createPrismaTenancyExtension } from '@nestarc/tenancy'");
  });

  it('should not overwrite without confirmation', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'schema.prisma'),
      'model User {\n  id Int @id\n}\n',
    );
    fs.writeFileSync(path.join(tmpDir, 'tenancy-setup.sql'), 'existing content');

    const prompts = require('prompts') as jest.Mock;
    prompts
      .mockResolvedValueOnce({
        extractor: 'Header (X-Tenant-Id)',
        tenantFormat: 'UUID',
        dbSettingKey: 'app.current_tenant',
        autoInject: false,
        sharedModels: '',
      })
      .mockResolvedValueOnce({ overwrite: false });

    await runInit({ cwd: tmpDir });

    const sql = fs.readFileSync(path.join(tmpDir, 'tenancy-setup.sql'), 'utf-8');
    expect(sql).toBe('existing content');
  });

  it('should log "No schema.prisma found." when schema is absent', async () => {
    // tmpDir has no schema.prisma
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const prompts = require('prompts') as jest.Mock;
    prompts.mockResolvedValue({
      extractor: 'Header (X-Tenant-Id)',
      tenantFormat: 'UUID',
      dbSettingKey: 'app.current_tenant',
      autoInject: false,
      sharedModels: '',
    });

    await runInit({ cwd: tmpDir });

    expect(consoleSpy).toHaveBeenCalledWith('No schema.prisma found.');
    consoleSpy.mockRestore();
  });

  it('should include validateTenantId in module setup when tenantFormat is Custom', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'schema.prisma'),
      'model User {\n  id Int @id\n}\n',
    );

    const prompts = require('prompts') as jest.Mock;
    prompts.mockResolvedValue({
      extractor: 'Header (X-Tenant-Id)',
      tenantFormat: 'Custom',
      customRegex: '^[a-z0-9-]+$',
      dbSettingKey: 'app.current_tenant',
      autoInject: false,
      sharedModels: '',
    });

    await runInit({ cwd: tmpDir });

    const modulePath = path.join(tmpDir, 'tenancy.module-setup.ts');
    expect(fs.existsSync(modulePath)).toBe(true);
    const content = fs.readFileSync(modulePath, 'utf-8');
    expect(content).toContain('validateTenantId: (id) => new RegExp("^[a-z0-9-]+$").test(id),');
  });

  it('should reject invalid custom regex before writing generated files', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'schema.prisma'),
      'model User {\n  id Int @id\n}\n',
    );

    const prompts = require('prompts') as jest.Mock;
    prompts.mockResolvedValue({
      extractor: 'Header (X-Tenant-Id)',
      tenantFormat: 'Custom',
      customRegex: '[invalid',
      dbSettingKey: 'app.current_tenant',
      autoInject: false,
      sharedModels: '',
    });

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await runInit({ cwd: tmpDir });

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid regex:'));
    expect(fs.existsSync(path.join(tmpDir, 'tenancy-setup.sql'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'tenancy.module-setup.ts'))).toBe(false);
    consoleSpy.mockRestore();
  });

  it.each([
    'current_tenant',
    'app.tenant-key',
    'app.tenant\nkey',
    'app.tenant\0key',
  ])('should reject an invalid database setting key before writing files: %p', async (dbSettingKey) => {
    fs.writeFileSync(
      path.join(tmpDir, 'schema.prisma'),
      'model User {\n  id Int @id\n  tenant_id String\n}\n',
    );

    const prompts = require('prompts') as jest.Mock;
    prompts.mockResolvedValue({
      extractor: 'Header (X-Tenant-Id)',
      tenantFormat: 'UUID',
      dbSettingKey,
      autoInject: false,
      sharedModels: '',
    });

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await runInit({ cwd: tmpDir });

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid database setting key'));
    expect(fs.existsSync(path.join(tmpDir, 'tenancy-setup.sql'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'tenancy.module-setup.ts'))).toBe(false);
    consoleSpy.mockRestore();
  });

  it('should preserve existing outputs when a mapped identifier is invalid', async () => {
    const longTableName = 't'.repeat(64);
    fs.writeFileSync(
      path.join(tmpDir, 'schema.prisma'),
      `model User {\n  id Int @id\n  tenant_id String\n\n  @@map("${longTableName}")\n}\n`,
    );
    fs.writeFileSync(path.join(tmpDir, 'tenancy-setup.sql'), 'existing sql');
    fs.writeFileSync(
      path.join(tmpDir, 'tenancy.module-setup.ts'),
      'existing module',
    );

    const prompts = require('prompts') as jest.Mock;
    prompts.mockClear();
    prompts.mockResolvedValue({
      extractor: 'Header (X-Tenant-Id)',
      tenantFormat: 'UUID',
      dbSettingKey: 'app.current_tenant',
      autoInject: false,
      sharedModels: '',
    });

    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await runInit({ cwd: tmpDir });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Table PostgreSQL identifier'),
    );
    expect(fs.readFileSync(path.join(tmpDir, 'tenancy-setup.sql'), 'utf-8'))
      .toBe('existing sql');
    expect(fs.readFileSync(path.join(tmpDir, 'tenancy.module-setup.ts'), 'utf-8'))
      .toBe('existing module');
    expect(prompts).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });

  it('should return early when user cancels (no extractor in response)', async () => {
    const prompts = require('prompts') as jest.Mock;
    // prompts returns an empty object (user hit Ctrl+C / cancelled)
    prompts.mockResolvedValue({});

    // Should not throw and should not create output files
    await runInit({ cwd: tmpDir });

    expect(fs.existsSync(path.join(tmpDir, 'tenancy-setup.sql'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'tenancy.module-setup.ts'))).toBe(false);
  });

  it('should reject an incomplete prompt response before writing files', async () => {
    const prompts = require('prompts') as jest.Mock;
    prompts.mockResolvedValue({
      extractor: 'Header (X-Tenant-Id)',
      tenantFormat: 'UUID',
      dbSettingKey: 'app.current_tenant',
    });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await runInit({ cwd: tmpDir });

    expect(result).toBe('invalid');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('incomplete'));
    expect(fs.existsSync(path.join(tmpDir, 'tenancy-setup.sql'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'tenancy.module-setup.ts'))).toBe(false);
    consoleSpy.mockRestore();
  });

  it('should return a non-zero CLI status for invalid init input', async () => {
    const prompts = require('prompts') as jest.Mock;
    prompts.mockResolvedValue({
      extractor: 'Header (X-Tenant-Id)',
      tenantFormat: 'UUID',
      dbSettingKey: 'invalid-key',
      autoInject: false,
      sharedModels: '',
    });
    const consoleErrorSpy = jest
      .spyOn(console, 'error')
      .mockImplementation(() => {});
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    const exitCode = await runCli(['init']);

    expect(exitCode).toBe(1);
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  it('should reject unsupported prompt choices before writing files', async () => {
    const prompts = require('prompts') as jest.Mock;
    prompts.mockResolvedValue({
      extractor: 'Unsupported extractor',
      tenantFormat: 'UUID',
      dbSettingKey: 'app.current_tenant',
      autoInject: false,
      sharedModels: '',
    });
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const result = await runInit({ cwd: tmpDir });

    expect(result).toBe('invalid');
    expect(fs.existsSync(path.join(tmpDir, 'tenancy-setup.sql'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'tenancy.module-setup.ts'))).toBe(false);
    consoleSpy.mockRestore();
  });

  it('should pass shared models to SQL and module setup', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'schema.prisma'),
      'model User {\n  id Int @id\n  tenant_id String\n}\n\nmodel Country {\n  id Int @id\n  name String\n}\n',
    );

    const prompts = require('prompts') as jest.Mock;
    prompts.mockResolvedValue({
      extractor: 'Header (X-Tenant-Id)',
      tenantFormat: 'UUID',
      dbSettingKey: 'app.current_tenant',
      autoInject: true,
      sharedModels: 'Country',
    });

    await runInit({ cwd: tmpDir });

    const sql = fs.readFileSync(path.join(tmpDir, 'tenancy-setup.sql'), 'utf-8');
    // Country should NOT have RLS policies (it's shared)
    expect(sql).not.toContain('ALTER TABLE "Country" ENABLE ROW LEVEL SECURITY');
    // User should have RLS policies
    expect(sql).toContain('ALTER TABLE "User" ENABLE ROW LEVEL SECURITY');
  });

  it('should log multi-schema info when models use @@schema()', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'schema.prisma'),
      'model User {\n  id Int @id\n  tenant_id String\n\n  @@schema("tenant")\n}\n',
    );

    const prompts = require('prompts') as jest.Mock;
    prompts.mockResolvedValue({
      extractor: 'Header (X-Tenant-Id)',
      tenantFormat: 'UUID',
      dbSettingKey: 'app.current_tenant',
      autoInject: false,
      sharedModels: '',
    });

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runInit({ cwd: tmpDir });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('1 model(s) use @@schema()'),
    );
    consoleSpy.mockRestore();
  });

  it('should print output without writing files in dry-run mode', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'schema.prisma'),
      'model User {\n  id Int @id\n  tenant_id String\n}\n',
    );

    const prompts = require('prompts') as jest.Mock;
    prompts.mockResolvedValue({
      extractor: 'Header (X-Tenant-Id)',
      tenantFormat: 'UUID',
      dbSettingKey: 'app.current_tenant',
      autoInject: false,
      sharedModels: '',
    });

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await runInit({ cwd: tmpDir, dryRun: true });

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('--- tenancy-setup.sql ---'));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('dry run'));
    // No files should be written
    expect(fs.existsSync(path.join(tmpDir, 'tenancy-setup.sql'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'tenancy.module-setup.ts'))).toBe(false);
    consoleSpy.mockRestore();
  });

  it('should exit with error when prompts package is not available', async () => {
    // Temporarily make require('prompts') throw
    const mockExit = jest.spyOn(process, 'exit').mockImplementation((_code?: string | number | null | undefined) => {
      throw new Error('process.exit called');
    });
    const mockError = jest.spyOn(console, 'error').mockImplementation(() => {});

    // We need to reload init.ts with prompts failing.
    // Use jest.resetModules to clear the module registry and mock prompts to throw.
    jest.resetModules();
    jest.doMock('prompts', () => {
      throw new Error('Cannot find module prompts');
    });

    const { runInit: runInitFresh } = await import('../../src/cli/init');

    await expect(runInitFresh({ cwd: tmpDir })).rejects.toThrow('process.exit called');
    expect(mockError).toHaveBeenCalledWith(
      expect.stringContaining('The "prompts" package is required'),
    );

    mockExit.mockRestore();
    mockError.mockRestore();
    jest.resetModules();
    jest.doMock('prompts', () => jest.fn());
  });
});
