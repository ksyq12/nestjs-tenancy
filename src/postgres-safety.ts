const POSTGRES_CUSTOM_SETTING_KEY =
  /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/;

/** PostgreSQL's default NAMEDATALEN (64) leaves 63 bytes for an identifier. */
export const POSTGRES_IDENTIFIER_MAX_BYTES = 63;

/**
 * Accept the conservative ASCII custom-GUC subset shared by CLI commands.
 * A custom key must contain at least one dot and a valid component on each side.
 */
export function isValidPostgresSettingKey(value: unknown): value is string {
  return typeof value === 'string' && POSTGRES_CUSTOM_SETTING_KEY.test(value);
}

export function assertValidPostgresSettingKey(
  value: unknown,
): asserts value is string {
  if (!isValidPostgresSettingKey(value)) {
    throw new Error(
      'Invalid database setting key: expected a dotted PostgreSQL custom setting name (for example app.current_tenant).',
    );
  }
}

export function isValidPostgresIdentifier(value: unknown): value is string {
  return typeof value === 'string' &&
    value.length > 0 &&
    !value.includes('\0') &&
    Buffer.byteLength(value, 'utf8') <= POSTGRES_IDENTIFIER_MAX_BYTES;
}

export function assertValidPostgresIdentifier(
  value: unknown,
  label = 'PostgreSQL identifier',
): asserts value is string {
  if (!isValidPostgresIdentifier(value)) {
    throw new Error(
      `${label} must be non-empty, contain no NUL bytes, and be at most ${POSTGRES_IDENTIFIER_MAX_BYTES} UTF-8 bytes.`,
    );
  }
}

/** Quote a PostgreSQL identifier. Never use this for string literals. */
export function quoteSqlIdentifier(identifier: string): string {
  assertValidPostgresIdentifier(identifier);
  return `"${identifier.replace(/"/g, '""')}"`;
}

/** Quote a standard-conforming PostgreSQL literal. Never use this for identifiers. */
export function quoteSqlLiteral(value: string): string {
  if (typeof value !== 'string' || value.includes('\0')) {
    throw new Error('SQL literal must be a string without NUL bytes.');
  }
  return `'${value.replace(/'/g, "''")}'`;
}

export function serializeTypeScriptString(value: string): string {
  if (typeof value !== 'string') {
    throw new Error('TypeScript string value must be a string.');
  }
  return escapeTypeScriptLineSeparators(JSON.stringify(value));
}

export function serializeTypeScriptStringArray(values: string[]): string {
  if (!Array.isArray(values) || values.some((value) => typeof value !== 'string')) {
    throw new Error('TypeScript string array must contain only strings.');
  }
  return escapeTypeScriptLineSeparators(JSON.stringify(values));
}

function escapeTypeScriptLineSeparators(serialized: string): string {
  return serialized
    .split('\u2028').join('\\u2028')
    .split('\u2029').join('\\u2029');
}
