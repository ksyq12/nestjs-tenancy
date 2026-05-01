import * as fs from 'fs';
import * as path from 'path';
import { parseModels, ParsedModel } from './prisma-schema-parser';

interface CheckOptions {
  cwd?: string;
  dbSettingKey?: string;
}

const GENERATED_START = '-- BEGIN GENERATED TENANCY SQL';
const GENERATED_END = '-- END GENERATED TENANCY SQL';

export interface CheckResult {
  inSync: boolean;
  missingPolicies: string[];
  extraPolicies: string[];
  warnings: string[];
}

function qualifiedName(model: ParsedModel): string {
  return model.schemaName
    ? `"${model.schemaName}"."${model.tableName}"`
    : `"${model.tableName}"`;
}

function extractGeneratedSqlSection(sqlContent: string): string {
  const start = sqlContent.indexOf(GENERATED_START);
  const end = sqlContent.indexOf(GENERATED_END);

  if (start === -1 || end === -1 || end <= start) {
    return sqlContent;
  }

  return sqlContent.slice(start + GENERATED_START.length, end);
}

function stripSqlLineComments(sqlContent: string): string {
  return sqlContent
    .split('\n')
    .map((line) => {
      const commentIndex = line.indexOf('--');
      return commentIndex === -1 ? line : line.slice(0, commentIndex);
    })
    .join('\n');
}

/**
 * Compares the Prisma schema models against an existing tenancy-setup.sql file
 * to detect drift: missing tables, extra tables, and incomplete policy definitions.
 */
export function runCheck(options?: CheckOptions): CheckResult {
  const cwd = options?.cwd ?? process.cwd();
  const expectedKey = options?.dbSettingKey ?? 'app.current_tenant';

  const schemaPath = findSchemaFile(cwd);
  if (!schemaPath) {
    console.error('No schema.prisma found.');
    return { inSync: false, missingPolicies: [], extraPolicies: [], warnings: [] };
  }

  const sqlPath = path.join(cwd, 'tenancy-setup.sql');
  if (!fs.existsSync(sqlPath)) {
    console.error('No tenancy-setup.sql found. Run `npx @nestarc/tenancy init` first.');
    return { inSync: false, missingPolicies: [], extraPolicies: [], warnings: [] };
  }

  const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
  const sqlContent = fs.readFileSync(sqlPath, 'utf-8');
  const generatedSql = extractGeneratedSqlSection(sqlContent);
  const sqlForTableScan = stripSqlLineComments(generatedSql);

  const models = parseModels(schemaContent);
  const expectedTables = new Set(
    models.map((m) => qualifiedName(m)),
  );

  // Parse tables with RLS enabled from SQL
  const quotedIdentifier = '"[^"]+"';
  const qualifiedTable = `${quotedIdentifier}(?:\\.${quotedIdentifier})?`;
  const rlsRegex = new RegExp(
    `ALTER TABLE\\s+(${qualifiedTable})\\s+ENABLE ROW LEVEL SECURITY`,
    'g',
  );
  const sqlTables = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = rlsRegex.exec(sqlForTableScan)) !== null) {
    sqlTables.add(match[1]);
  }

  // Detect shared models
  const sharedRegex = /-- (\w+) \(shared model\)/g;
  const sharedModels = new Set<string>();
  while ((match = sharedRegex.exec(generatedSql)) !== null) {
    sharedModels.add(match[1]);
  }

  // Remove shared model tables from expected
  for (const model of models) {
    if (sharedModels.has(model.modelName)) {
      expectedTables.delete(qualifiedName(model));
    }
  }

  const missingPolicies: string[] = [];
  const extraPolicies: string[] = [];
  const warnings: string[] = [];

  for (const table of expectedTables) {
    if (!sqlTables.has(table)) {
      missingPolicies.push(table);
    }
  }

  for (const table of sqlTables) {
    if (!expectedTables.has(table)) {
      extraPolicies.push(table);
    }
  }

  // Deep checks: FORCE, policies, setting key
  for (const table of sqlTables) {
    if (!expectedTables.has(table)) continue;

    // Check FORCE ROW LEVEL SECURITY
    const forcePattern = `ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`;
    if (!generatedSql.includes(forcePattern)) {
      warnings.push(`${table}: missing FORCE ROW LEVEL SECURITY`);
    }

    // Check isolation policy (SELECT/UPDATE/DELETE)
    const escapedTable = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const isolationRegex = new RegExp(
      `CREATE POLICY\\s+tenant_isolation_\\S+\\s+ON\\s+${escapedTable}`,
    );
    if (!isolationRegex.test(generatedSql)) {
      warnings.push(`${table}: missing tenant_isolation policy`);
    }

    // Check insert policy
    const insertRegex = new RegExp(
      `CREATE POLICY\\s+tenant_insert_\\S+\\s+ON\\s+${escapedTable}`,
    );
    if (!insertRegex.test(generatedSql)) {
      warnings.push(`${table}: missing tenant_insert policy`);
    }

  }

  // Check setting key consistency across ALL current_setting() calls
  const keyRegex = /current_setting\('([^']+)'/g;
  for (const keyMatch of generatedSql.matchAll(keyRegex)) {
    if (keyMatch[1] !== expectedKey) {
      warnings.push(
        `Setting key mismatch: SQL uses '${keyMatch[1]}', expected '${expectedKey}'`,
      );
    }
  }

  const inSync =
    missingPolicies.length === 0 &&
    extraPolicies.length === 0 &&
    warnings.length === 0;

  if (inSync) {
    console.log('OK — tenancy-setup.sql is in sync with Prisma schema.');
  } else {
    if (missingPolicies.length > 0) {
      console.log(`Missing RLS policies for: ${missingPolicies.join(', ')}`);
    }
    if (extraPolicies.length > 0) {
      console.log(`Extra RLS policies (not in schema): ${extraPolicies.join(', ')}`);
    }
    for (const w of warnings) {
      console.log(`Warning: ${w}`);
    }
    console.log('\nRe-run `npx @nestarc/tenancy init` to regenerate.');
  }

  return { inSync, missingPolicies, extraPolicies, warnings };
}

function findSchemaFile(cwd: string): string | null {
  const candidates = [
    path.join(cwd, 'schema.prisma'),
    path.join(cwd, 'prisma', 'schema.prisma'),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}
