import * as fs from 'fs';
import * as path from 'path';

jest.mock('prompts', () => jest.fn());

import { runInit } from '../../src/cli/init';

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
    expect(content).toContain("import { TenancyModule, SubdomainTenantExtractor } from '@nestarc/tenancy'");
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
    expect(content).toContain("import { TenancyModule, JwtClaimTenantExtractor } from '@nestarc/tenancy'");
  });

  it('should include createPrismaTenancyExtension import when autoInject is true', async () => {
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
    expect(content).toContain("import { TenancyModule, SubdomainTenantExtractor, createPrismaTenancyExtension } from '@nestarc/tenancy'");
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
    expect(content).toContain("validateTenantId: (id) => /^[a-z0-9-]+$/.test(id),");
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
