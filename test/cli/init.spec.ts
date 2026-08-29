import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

jest.mock('prompts', () => jest.fn());

import { runInit } from '../../src/cli/init';
import { runCli } from '../../src/cli';

type TempDirectoryTest = (tmpDir: string) => Promise<void>;

async function withTempDirectory(test: TempDirectoryTest): Promise<void> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tenancy-init-'));

  try {
    await test(tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

function itWithTempDirectory(name: string, test: TempDirectoryTest): void {
  it(name, () => withTempDirectory(test));
}

describe('CLI init', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  itWithTempDirectory('should generate setup.sql with RLS policies', async (tmpDir) => {
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
    expect(sql).toContain(
      'ALTER TABLE "public"."User" ENABLE ROW LEVEL SECURITY',
    );
    expect(sql).toContain('app.current_tenant');
  });

  itWithTempDirectory('should generate module setup file', async (tmpDir) => {
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

  itWithTempDirectory('should handle @@map in schema', async (tmpDir) => {
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

  itWithTempDirectory('should safely encode escaped mapped schema and table names', async (tmpDir) => {
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

  itWithTempDirectory('should generate proper imports for non-Header extractor (Subdomain)', async (tmpDir) => {
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

  itWithTempDirectory('should generate proper imports for JWT Claim extractor', async (tmpDir) => {
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

  itWithTempDirectory('should include a commented Prisma extension import when autoInject is true', async (tmpDir) => {
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

  itWithTempDirectory('should not overwrite without confirmation', async (tmpDir) => {
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

  itWithTempDirectory('should log "No schema.prisma found." when schema is absent', async (tmpDir) => {
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

  itWithTempDirectory('should include validateTenantId in module setup when tenantFormat is Custom', async (tmpDir) => {
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

  itWithTempDirectory('should reject invalid custom regex before writing generated files', async (tmpDir) => {
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
    await withTempDirectory(async (tmpDir) => {
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
  });

  itWithTempDirectory('should preserve existing outputs when a mapped identifier is invalid', async (tmpDir) => {
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

  itWithTempDirectory('should return early when user cancels (no extractor in response)', async (tmpDir) => {
    const prompts = require('prompts') as jest.Mock;
    // prompts returns an empty object (user hit Ctrl+C / cancelled)
    prompts.mockResolvedValue({});

    // Should not throw and should not create output files
    await runInit({ cwd: tmpDir });

    expect(fs.existsSync(path.join(tmpDir, 'tenancy-setup.sql'))).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, 'tenancy.module-setup.ts'))).toBe(false);
  });

  itWithTempDirectory('should reject an incomplete prompt response before writing files', async (tmpDir) => {
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

  itWithTempDirectory('should return a non-zero CLI status for invalid init input', async (tmpDir) => {
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
    jest.spyOn(process, 'cwd').mockReturnValue(tmpDir);

    const exitCode = await runCli(['init']);

    expect(exitCode).toBe(1);
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  itWithTempDirectory('should reject unsupported prompt choices before writing files', async (tmpDir) => {
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

  itWithTempDirectory('should pass shared models to SQL and module setup', async (tmpDir) => {
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
    expect(sql).not.toContain(
      'ALTER TABLE "public"."Country" ENABLE ROW LEVEL SECURITY',
    );
    // User should have RLS policies
    expect(sql).toContain(
      'ALTER TABLE "public"."User" ENABLE ROW LEVEL SECURITY',
    );
  });

  itWithTempDirectory('should log multi-schema info when models use @@schema()', async (tmpDir) => {
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

  itWithTempDirectory('should print output without writing files in dry-run mode', async (tmpDir) => {
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

  itWithTempDirectory('should exit with error when prompts package is not available', async (tmpDir) => {
    // Temporarily make require('prompts') throw
    const mockExit = jest.spyOn(process, 'exit').mockImplementation((_code?: string | number | null | undefined) => {
      throw new Error('process.exit called');
    });
    const mockError = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      // We need to reload init.ts with prompts failing.
      // Use jest.resetModules to clear the module registry and mock prompts to throw.
      jest.resetModules();
      jest.doMock('prompts', () => {
        throw new Error('Cannot find module prompts');
      });

      const { runInit: runInitFresh } = require('../../src/cli/init') as {
        runInit: typeof runInit;
      };

      await expect(runInitFresh({ cwd: tmpDir })).rejects.toThrow('process.exit called');
      expect(mockError).toHaveBeenCalledWith(
        expect.stringContaining('The "prompts" package is required'),
      );
    } finally {
      mockExit.mockRestore();
      mockError.mockRestore();
      jest.resetModules();
      jest.doMock('prompts', () => jest.fn());
    }
  });
});
