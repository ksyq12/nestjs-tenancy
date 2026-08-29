import * as fs from 'fs';
import * as path from 'path';
import { parseModels, ParsedModel } from './prisma-schema-parser';
import {
  isValidPostgresSettingKey,
  quoteSqlIdentifier,
} from '../postgres-safety';

interface CheckOptions {
  cwd?: string;
  dbSettingKey?: string;
  tenantIdField?: string;
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
    ? `${quoteSqlIdentifier(model.schemaName)}.${quoteSqlIdentifier(model.tableName)}`
    : quoteSqlIdentifier(model.tableName);
}

function extractGeneratedSqlSection(
  sqlContent: string,
  lineComments: SqlLineComment[],
): string {
  const startMarker = GENERATED_START.slice(2).trim();
  const endMarker = GENERATED_END.slice(2).trim();
  const start = lineComments.find(
    (comment) => comment.text.trim() === startMarker,
  );
  const end = lineComments.find(
    (comment) =>
      comment.start > (start?.start ?? -1) &&
      comment.text.trim() === endMarker,
  );

  if (!start || !end) {
    return sqlContent;
  }

  return sqlContent.slice(start.end, end.start);
}

interface SqlLineComment {
  text: string;
  start: number;
  end: number;
}

interface ScannedSql {
  code: string;
  lineComments: SqlLineComment[];
  statements: string[];
  stringLiterals: SqlStringLiteral[];
  valid: boolean;
}

interface SqlStringLiteral {
  standard: boolean;
  value: string;
}

const SQL_STRING_TOKEN_PREFIX = '\0TENANCY_SQL_STRING_';
const SQL_STRING_TOKEN_SUFFIX = '\0';

function sqlStringToken(index: number): string {
  return `${SQL_STRING_TOKEN_PREFIX}${index}${SQL_STRING_TOKEN_SUFFIX}`;
}

function sqlStringTokenIndex(value: string): number | undefined {
  if (
    !value.startsWith(SQL_STRING_TOKEN_PREFIX) ||
    !value.endsWith(SQL_STRING_TOKEN_SUFFIX)
  ) {
    return undefined;
  }
  const serializedIndex = value.slice(
    SQL_STRING_TOKEN_PREFIX.length,
    -SQL_STRING_TOKEN_SUFFIX.length,
  );
  return /^\d+$/.test(serializedIndex)
    ? Number(serializedIndex)
    : undefined;
}

function scanSql(sqlContent: string): ScannedSql {
  let code = '';
  let statementStart = 0;
  let blockCommentDepth = 0;
  let valid = !sqlContent.includes('\0');
  const lineComments: SqlLineComment[] = [];
  const statements: string[] = [];
  const stringLiterals: SqlStringLiteral[] = [];

  for (let index = 0; index < sqlContent.length; index++) {
    const character = sqlContent[index];
    const nextCharacter = sqlContent[index + 1];

    if (blockCommentDepth > 0) {
      if (character === '/' && nextCharacter === '*') {
        blockCommentDepth++;
        index++;
      } else if (character === '*' && nextCharacter === '/') {
        blockCommentDepth--;
        index++;
      } else if (character === '\n' || character === '\r') {
        code += character;
      }
      continue;
    }

    if (character === '-' && nextCharacter === '-') {
      const commentStart = index;
      let comment = '';
      index += 2;
      while (
        index < sqlContent.length &&
        sqlContent[index] !== '\n' &&
        sqlContent[index] !== '\r'
      ) {
        comment += sqlContent[index];
        index++;
      }
      lineComments.push({
        text: comment,
        start: commentStart,
        end: index,
      });
      index--;
      continue;
    }

    if (character === '/' && nextCharacter === '*') {
      blockCommentDepth = 1;
      code += ' ';
      index++;
      continue;
    }

    if (character === "'") {
      const prefix = sqlContent[index - 1];
      const beforePrefix = sqlContent[index - 2];
      const isEscapeString =
        (prefix === 'E' || prefix === 'e') &&
        (beforePrefix === undefined ||
          !/[A-Za-z0-9_$\u0080-\uFFFF]/u.test(beforePrefix));
      const beforeUnicodePrefix = sqlContent[index - 3];
      const isUnicodeString =
        prefix === '&' &&
        (beforePrefix === 'U' || beforePrefix === 'u') &&
        (beforeUnicodePrefix === undefined ||
          !/[A-Za-z0-9_$\u0080-\uFFFF]/u.test(beforeUnicodePrefix));
      if (isEscapeString) code = code.slice(0, -1);
      else if (isUnicodeString) code = code.slice(0, -2);
      let literal = '';
      let closed = false;
      for (let literalIndex = index + 1; literalIndex < sqlContent.length; literalIndex++) {
        const literalCharacter = sqlContent[literalIndex];
        if (
          isEscapeString &&
          literalCharacter === '\\' &&
          literalIndex + 1 < sqlContent.length
        ) {
          literal += sqlContent[literalIndex + 1];
          literalIndex++;
          continue;
        }
        if (literalCharacter === "'") {
          if (sqlContent[literalIndex + 1] === "'") {
            literal += "'";
            literalIndex++;
            continue;
          }
          index = literalIndex;
          closed = true;
          break;
        }
        literal += literalCharacter;
      }
      if (!closed) {
        valid = false;
        index = sqlContent.length;
        continue;
      }
      const literalIndex = stringLiterals.push({
        standard: !isEscapeString && !isUnicodeString,
        value: literal,
      }) - 1;
      code += sqlStringToken(literalIndex);
      continue;
    }

    if (character === '"') {
      code += character;
      let closed = false;
      for (let identifierIndex = index + 1; identifierIndex < sqlContent.length; identifierIndex++) {
        const identifierCharacter = sqlContent[identifierIndex];
        code += identifierCharacter;
        if (identifierCharacter === '"') {
          if (sqlContent[identifierIndex + 1] === '"') {
            code += sqlContent[identifierIndex + 1];
            identifierIndex++;
            continue;
          }
          index = identifierIndex;
          closed = true;
          break;
        }
      }
      if (!closed) {
        valid = false;
        index = sqlContent.length;
      }
      continue;
    }

    if (character === '$') {
      const previousCharacter = sqlContent[index - 1];
      const hasTokenBoundary =
        previousCharacter === undefined ||
        !/[A-Za-z0-9_$\u0080-\uFFFF]/u.test(previousCharacter);
      const dollarTag = hasTokenBoundary
        ? /^\$(?:[A-Za-z_\u0080-\uFFFF][A-Za-z0-9_\u0080-\uFFFF]*)?\$/u
          .exec(sqlContent.slice(index))?.[0]
        : undefined;
      if (dollarTag) {
        const bodyStart = index + dollarTag.length;
        const bodyEnd = sqlContent.indexOf(dollarTag, bodyStart);
        if (bodyEnd === -1) {
          valid = false;
          index = sqlContent.length;
          continue;
        }
        const literalIndex = stringLiterals.push({
          standard: false,
          value: sqlContent.slice(bodyStart, bodyEnd),
        }) - 1;
        code += sqlStringToken(literalIndex);
        index = bodyEnd + dollarTag.length - 1;
        continue;
      }
    }

    if (character === ';') {
      code += character;
      statements.push(code.slice(statementStart));
      statementStart = code.length;
      continue;
    }

    code += character;
  }

  const trailingStatement = code.slice(statementStart);
  if (trailingStatement.trim().length > 0) {
    statements.push(trailingStatement);
  }

  if (blockCommentDepth > 0) valid = false;

  return { code, lineComments, statements, stringLiterals, valid };
}

function maskSqlQuotedIdentifiers(sqlCode: string): string {
  let masked = '';

  for (let index = 0; index < sqlCode.length; index++) {
    const character = sqlCode[index];
    if (character !== '"') {
      masked += character;
      continue;
    }

    masked += ' ';
    for (index += 1; index < sqlCode.length; index++) {
      const identifierCharacter = sqlCode[index];
      masked += identifierCharacter === '\n' || identifierCharacter === '\r'
        ? identifierCharacter
        : ' ';
      if (identifierCharacter !== '"') continue;
      if (sqlCode[index + 1] === '"') {
        masked += ' ';
        index++;
        continue;
      }
      break;
    }
  }

  return masked;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Compares the Prisma schema models against an existing tenancy-setup.sql file
 * to detect drift: missing tables, extra tables, and incomplete policy definitions.
 */
export function runCheck(options?: CheckOptions): CheckResult {
  const cwd = options?.cwd ?? process.cwd();
  const expectedKey = options?.dbSettingKey ?? 'app.current_tenant';
  const tenantIdField = options?.tenantIdField ?? 'tenant_id';

  if (!isValidPostgresSettingKey(expectedKey)) {
    const warning = 'Invalid database setting key: expected a dotted PostgreSQL custom setting name.';
    console.error(warning);
    return {
      inSync: false,
      missingPolicies: [],
      extraPolicies: [],
      warnings: [warning],
    };
  }

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
  const fullSqlScan = scanSql(sqlContent);
  const generatedSql = extractGeneratedSqlSection(
    sqlContent,
    fullSqlScan.lineComments,
  );
  const scannedSql = generatedSql === sqlContent
    ? fullSqlScan
    : scanSql(generatedSql);
  const sqlForAnalysis = scannedSql.code;
  const statementsForAnalysis = scannedSql.statements
    .map((statement) => statement.replace(/;\s*$/, '').trim())
    .filter((statement) => statement.length > 0);

  const models = parseModels(schemaContent);
  const expectedTables = new Set(
    models.map((m) => qualifiedName(m)),
  );

  // Parse tables with RLS enabled from SQL
  const quotedIdentifier = '"(?:[^"]|"")*"';
  const qualifiedTable = `${quotedIdentifier}(?:\\.${quotedIdentifier})?`;
  const rlsRegex = new RegExp(
    `^ALTER TABLE\\s+(${qualifiedTable})\\s+ENABLE ROW LEVEL SECURITY$`,
  );
  const sqlTables = new Set<string>();
  let match: RegExpExecArray | null;
  for (const statement of statementsForAnalysis) {
    match = rlsRegex.exec(statement);
    if (match) sqlTables.add(match[1]);
  }

  // Detect shared models
  const sharedRegex = /-- (\w+) \(shared model\)/g;
  const sharedModels = new Set<string>();
  const lineCommentSql = scannedSql.lineComments
    .map((comment) => '--' + comment.text)
    .join('\n');
  while ((match = sharedRegex.exec(lineCommentSql)) !== null) {
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

  if (!scannedSql.valid) {
    warnings.push('Invalid or unsupported SQL lexical structure');
  }

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

  const expectedKeyTokens = scannedSql.stringLiterals
    .map((literal, index) => ({ literal, index }))
    .filter(({ literal }) => literal.standard && literal.value === expectedKey)
    .map(({ index }) => escapeRegExp(sqlStringToken(index)));
  const expectedKeyPattern = expectedKeyTokens.length > 0
    ? '(?:' + expectedKeyTokens.join('|') + ')'
    : '(?!)';
  const recognizedPolicyStatements = new Set<string>();

  // Deep checks: FORCE, policies, setting key
  for (const table of sqlTables) {
    if (!expectedTables.has(table)) continue;

    // Check FORCE ROW LEVEL SECURITY
    const forceRegex = new RegExp(
      `^ALTER TABLE ${escapeRegExp(table)} FORCE ROW LEVEL SECURITY$`,
    );
    if (!statementsForAnalysis.some((statement) => forceRegex.test(statement))) {
      warnings.push(`${table}: missing FORCE ROW LEVEL SECURITY`);
    }

    // Check isolation policy (SELECT/UPDATE/DELETE)
    const escapedTable = table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedQuotedTenantField = escapeRegExp(
      quoteSqlIdentifier(tenantIdField),
    );
    const escapedTenantField = escapeRegExp(tenantIdField);
    const unquotedTenantFieldAlternative =
      /^[a-z_][a-z0-9_$]*$/.test(tenantIdField)
        ? `|\\b${escapedTenantField}\\b`
        : '';
    const tenantColumnPattern =
      `(?:${escapedQuotedTenantField}${unquotedTenantFieldAlternative})`;
    const tenantPredicate =
      `${tenantColumnPattern}\\s*=\\s*current_setting\\s*\\(\\s*${expectedKeyPattern}\\s*,\\s*true\\s*\\)\\s*::\\s*text`;
    const policyStatements = statementsForAnalysis;
    const isolationRegex = new RegExp(
      `^CREATE POLICY\\s+tenant_isolation_\\S+\\s+ON\\s+${escapedTable}\\s+USING\\s*\\(\\s*${tenantPredicate}\\s*\\)$`,
    );
    const matchingIsolationPolicies = policyStatements.filter((statement) =>
      isolationRegex.test(statement),
    );
    for (const statement of matchingIsolationPolicies) {
      recognizedPolicyStatements.add(statement);
    }
    if (matchingIsolationPolicies.length !== 1) {
      warnings.push(`${table}: missing or invalid tenant_isolation policy`);
    }

    // Check insert policy
    const insertRegex = new RegExp(
      `^CREATE POLICY\\s+tenant_insert_\\S+\\s+ON\\s+${escapedTable}\\s+FOR\\s+INSERT\\s+WITH\\s+CHECK\\s*\\(\\s*${tenantPredicate}\\s*\\)$`,
    );
    const matchingInsertPolicies = policyStatements.filter((statement) =>
      insertRegex.test(statement),
    );
    for (const statement of matchingInsertPolicies) {
      recognizedPolicyStatements.add(statement);
    }
    if (matchingInsertPolicies.length !== 1) {
      warnings.push(`${table}: missing or invalid tenant_insert policy`);
    }

    const policyName = '(?:"(?:[^"]|"")*"|[A-Za-z_][A-Za-z0-9_$]*)';
    const tablePolicyRegex = new RegExp(
      `^CREATE\\s+POLICY\\s+${policyName}\\s+ON\\s+${escapedTable}(?:\\s|$)`,
      'i',
    );
    const restrictivePolicyRegex = new RegExp(
      `^CREATE\\s+POLICY\\s+${policyName}\\s+ON\\s+${escapedTable}\\s+AS\\s+RESTRICTIVE(?:\\s|$)`,
      'i',
    );
    const tablePolicyStatements = policyStatements.filter((statement) =>
      tablePolicyRegex.test(statement),
    );
    const unexpectedPermissivePolicies = tablePolicyStatements.filter(
      (statement) => !recognizedPolicyStatements.has(statement) &&
        !restrictivePolicyRegex.test(statement),
    );
    for (const statement of tablePolicyStatements) {
      if (restrictivePolicyRegex.test(statement)) {
        recognizedPolicyStatements.add(statement);
      }
    }
    if (unexpectedPermissivePolicies.length > 0) {
      warnings.push(`${table}: unexpected permissive policy`);
    }

    // Check tenant column index. RLS policies are implicit filters, so tenant
    // scoped tables should index the policy column to avoid full table scans.
    const tenantIndexRegex = new RegExp(
      `^CREATE\\s+(?:UNIQUE\\s+)?INDEX(?:\\s+IF\\s+NOT\\s+EXISTS)?\\s+\\S+\\s+ON\\s+${escapedTable}\\s+(?:USING\\s+\\w+\\s+)?\\([^)]*${tenantColumnPattern}[^)]*\\)$`,
    );
    if (!statementsForAnalysis.some((statement) => tenantIndexRegex.test(statement))) {
      warnings.push(`${table}: missing tenant index on ${tenantIdField}`);
    }
  }

  const statementsWithMaskedIdentifiers = statementsForAnalysis.map(
    (statement) => ({
      statement,
      keywords: maskSqlQuotedIdentifiers(statement),
    }),
  );
  const hasUnrecognizedPolicy = statementsWithMaskedIdentifiers.some(
    ({ statement, keywords }) =>
      /^CREATE\s+POLICY(?:\s|$)/i.test(keywords) &&
      !recognizedPolicyStatements.has(statement),
  );
  if (hasUnrecognizedPolicy) {
    warnings.push('Generated SQL: unexpected permissive or unsupported policy');
  }

  // Any policy mutation or RLS reversal in the generated section is invalid,
  // regardless of how PostgreSQL-equivalent identifiers are spelled.
  const hasStateReversingStatement = statementsWithMaskedIdentifiers.some(
    ({ keywords }) =>
      /^(?:ALTER|DROP)\s+POLICY(?:\s|$)/i.test(keywords) ||
      /^ALTER\s+TABLE(?:\s|$)[\s\S]*?(?:\s+|,\s*)(?:DISABLE\s+ROW\s+LEVEL\s+SECURITY|NO\s+FORCE\s+ROW\s+LEVEL\s+SECURITY)(?=\s*(?:,|$))/i
        .test(keywords),
  );
  if (hasStateReversingStatement) {
    warnings.push('Generated SQL: unexpected policy or RLS mutation');
  }

  // Check setting key consistency across ALL current_setting() calls
  const functionCode = maskSqlQuotedIdentifiers(sqlForAnalysis);
  const keyRegex =
    /(^|[^A-Za-z0-9_$\u0080-\uFFFF])current_setting\s*\(\s*([^,)]*)/giu;
  for (const keyMatch of functionCode.matchAll(keyRegex)) {
    const literalIndex = sqlStringTokenIndex(keyMatch[2].trim());
    const literal = literalIndex === undefined
      ? undefined
      : scannedSql.stringLiterals[literalIndex];
    if (!literal?.standard || literal.value !== expectedKey) {
      warnings.push(
        `Setting key mismatch or unsupported current_setting() argument; expected '${expectedKey}'`,
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
