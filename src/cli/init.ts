import * as fs from 'fs';
import * as path from 'path';
import { parseModels } from './prisma-schema-parser';
import { generateSetupSql } from './templates/setup-sql';
import { generateModuleSetup } from './templates/module-setup';

interface InitOptions {
  cwd?: string;
  dryRun?: boolean;
}

// prompts package is dynamically required and returns mixed types per question
// (string for text/select, boolean for confirm, number for number).
// Typing this precisely requires duplicating the full prompts API; any is acceptable
// at this external boundary.
type PromptsFn = (...args: any[]) => Promise<any>;

export async function runInit(options?: InitOptions): Promise<void> {
  let prompts: PromptsFn;
  try {
     
    prompts = require('prompts');
  } catch {
    console.error(
      'The "prompts" package is required for the CLI.\nInstall it: npm install prompts',
    );
    process.exit(1);
  }

  const cwd = options?.cwd ?? process.cwd();
  const schemaPath = findSchemaFile(cwd);
  let models: ReturnType<typeof parseModels> = [];

  if (schemaPath) {
    const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
    models = parseModels(schemaContent);
    console.log(`Found ${models.length} model(s) in ${path.relative(cwd, schemaPath) || 'schema.prisma'}`);
    const multiSchemaModels = models.filter((m) => m.schemaName);
    if (multiSchemaModels.length > 0) {
      console.log(
        `\nInfo: ${multiSchemaModels.length} model(s) use @@schema(): ${multiSchemaModels.map((m) => m.modelName).join(', ')}.\n` +
        'The generated SQL uses schema-qualified table names (e.g., "myschema"."table").\n',
      );
    }
  } else {
    console.log('No schema.prisma found.');
  }

  const response = await prompts([
    {
      type: 'select',
      name: 'extractor',
      message: 'Tenant extraction strategy',
      choices: [
        { title: 'Header (X-Tenant-Id)', value: 'Header (X-Tenant-Id)' },
        { title: 'Subdomain (tenant1.app.com)', value: 'Subdomain (tenant1.app.com)' },
        { title: 'JWT Claim', value: 'JWT Claim' },
        { title: 'Path Parameter', value: 'Path Parameter' },
        { title: 'Composite (multiple)', value: 'Composite' },
      ],
    },
    {
      type: 'select',
      name: 'tenantFormat',
      message: 'Tenant ID format',
      choices: [
        { title: 'UUID', value: 'UUID' },
        { title: 'Custom', value: 'Custom' },
      ],
    },
    {
      type: 'text',
      name: 'customRegex',
      message: 'Custom tenant ID regex (e.g., ^[a-z0-9-]+$)',
      initial: '^[a-z0-9-]+$',
    },
    {
      type: 'text',
      name: 'dbSettingKey',
      message: 'Database setting key',
      initial: 'app.current_tenant',
    },
    {
      type: 'confirm',
      name: 'autoInject',
      message: 'Enable auto-inject tenant ID on writes?',
      initial: true,
    },
    {
      type: 'text',
      name: 'sharedModels',
      message: 'Shared models (comma-separated, e.g., Country,Currency)',
      initial: '',
    },
  ]);

  if (!response.extractor) return;

  if (response.tenantFormat === 'Custom' && response.customRegex) {
    try {
      new RegExp(response.customRegex);
    } catch (err) {
      console.error(`Invalid regex: ${(err as Error).message}`);
      return;
    }
  }

  const sharedModels = response.sharedModels
    ? response.sharedModels.split(',').map((s: string) => s.trim()).filter(Boolean)
    : [];

  const sql = generateSetupSql({
    models,
    dbSettingKey: response.dbSettingKey,
    sharedModels,
    tenantIdField: 'tenant_id',
  });

  const moduleSetup = generateModuleSetup({
    extractorType: response.extractor,
    dbSettingKey: response.dbSettingKey,
    autoInjectTenantId: response.autoInject,
    sharedModels,
    tenantFormat: response.tenantFormat,
    customRegex: response.customRegex,
  });

  if (options?.dryRun) {
    console.log('\n--- tenancy-setup.sql ---\n');
    console.log(sql);
    console.log('\n--- tenancy.module-setup.ts ---\n');
    console.log(moduleSetup);
    console.log('\n(dry run — no files written)');
    return;
  }

  await writeFileWithConfirm(prompts, path.join(cwd, 'tenancy-setup.sql'), sql);
  await writeFileWithConfirm(prompts, path.join(cwd, 'tenancy.module-setup.ts'), moduleSetup);

  console.log('\nNext steps:');
  console.log('1. Add tenant_id column to your Prisma models');
  console.log('2. Run: npx prisma migrate dev');
  console.log('3. Run tenancy-setup.sql against your database');
  console.log('4. Copy the module setup into your AppModule');
}

async function writeFileWithConfirm(prompts: PromptsFn, filePath: string, content: string): Promise<void> {
  if (fs.existsSync(filePath)) {
    const { overwrite } = await prompts({
      type: 'confirm',
      name: 'overwrite',
      message: `${path.basename(filePath)} already exists. Overwrite?`,
      initial: false,
    });
    if (!overwrite) {
      console.log(`Skipped ${path.basename(filePath)}`);
      return;
    }
  }
  fs.writeFileSync(filePath, content, 'utf-8');
  console.log(`Created ${path.basename(filePath)}`);
}

function findSchemaFile(cwd: string): string | null {
  const candidates = [
    path.join(cwd, 'schema.prisma'),
    path.join(cwd, 'prisma', 'schema.prisma'),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}
