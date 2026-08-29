import {
  assertValidPostgresIdentifier,
  assertValidPostgresSettingKey,
  isValidPostgresIdentifier,
  isValidPostgresSettingKey,
  quoteSqlIdentifier,
  quoteSqlLiteral,
  serializeTypeScriptString,
  serializeTypeScriptStringArray,
} from '../src/postgres-safety';

describe('PostgreSQL syntax safety helpers', () => {
  it.each([
    'app.current_tenant',
    'tenant.context.current_id',
    '_app._tenant2',
  ])('accepts a conservative dotted custom setting key: %s', (value) => {
    expect(isValidPostgresSettingKey(value)).toBe(true);
    expect(() => assertValidPostgresSettingKey(value)).not.toThrow();
  });

  it.each([
    undefined,
    '',
    'current_tenant',
    '.tenant',
    'app.',
    'app.tenant-key',
    'app.tenant\nkey',
    'app.tenant\0key',
  ])('rejects a value outside the supported setting-key grammar: %p', (value) => {
    expect(isValidPostgresSettingKey(value)).toBe(false);
    expect(() => assertValidPostgresSettingKey(value)).toThrow(
      /database setting key/i,
    );
  });

  it('quotes identifiers and literals with separate PostgreSQL rules', () => {
    const value = `ledger"line';\narchive`;

    expect(quoteSqlIdentifier(value)).toBe(`"ledger""line';\narchive"`);
    expect(quoteSqlLiteral(value)).toBe(`'ledger"line'';\narchive'`);
  });

  it('checks PostgreSQL identifier length in UTF-8 bytes', () => {
    const atLimit = `${'a'.repeat(61)}é`;
    const overLimit = `${'a'.repeat(62)}é`;

    expect(Buffer.byteLength(atLimit, 'utf8')).toBe(63);
    expect(isValidPostgresIdentifier(atLimit)).toBe(true);
    expect(isValidPostgresIdentifier(overLimit)).toBe(false);
    expect(() => assertValidPostgresIdentifier(overLimit)).toThrow(
      /63 UTF-8 bytes/i,
    );
  });

  it.each(['', 'name\0part', 'n'.repeat(64)])(
    'rejects an unusable PostgreSQL identifier: %p',
    (value) => {
      expect(() => quoteSqlIdentifier(value)).toThrow(
        /PostgreSQL identifier/i,
      );
    },
  );

  it('rejects NUL in a SQL literal', () => {
    expect(() => quoteSqlLiteral('value\0part')).toThrow(/SQL literal/i);
    expect(() => quoteSqlLiteral(undefined as unknown as string)).toThrow(
      /SQL literal/i,
    );
  });

  it('serializes TypeScript strings and arrays with JSON escaping', () => {
    const value = 'line"one\nline\\two';
    const values = [value, 'tail'];

    expect(serializeTypeScriptString(value)).toBe(JSON.stringify(value));
    expect(serializeTypeScriptStringArray(values)).toBe(JSON.stringify(values));
  });

  it('escapes JavaScript line separators in generated string literals', () => {
    const lineSeparator = String.fromCodePoint(0x2028);
    const paragraphSeparator = String.fromCodePoint(0x2029);
    const value = `line${lineSeparator}paragraph${paragraphSeparator}tail`;
    const serializedString = serializeTypeScriptString(value);
    const serializedArray = serializeTypeScriptStringArray([value]);

    expect(serializedString).toContain('\\u2028');
    expect(serializedString).toContain('\\u2029');
    expect(serializedString).not.toContain(lineSeparator);
    expect(serializedString).not.toContain(paragraphSeparator);
    expect(serializedArray).not.toContain(lineSeparator);
    expect(serializedArray).not.toContain(paragraphSeparator);
  });

  it('rejects non-string TypeScript serialization inputs at runtime', () => {
    expect(() => serializeTypeScriptString(
      undefined as unknown as string,
    )).toThrow(/TypeScript string value/i);
    expect(() => serializeTypeScriptStringArray(
      ['valid', undefined as unknown as string],
    )).toThrow(/TypeScript string array/i);
  });
});
