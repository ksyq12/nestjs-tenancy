import type { TenantColumnPolicyType } from './tenant-column';

interface PolicyToken {
  kind: 'identifier' | 'string' | 'symbol';
  value: string;
  quoted?: boolean;
}

/** Match only the exact tenant predicate shape emitted by generateSetupSql(). */
export function expressionMatchesGeneratedContract(
  expression: string | null,
  tenantColumn: string,
  settingKey: string,
  policyType: TenantColumnPolicyType | null,
): boolean {
  if (expression === null || policyType === null) return false;
  const parsed = parseTenantPolicyExpression(expression, policyType);
  return parsed?.column === tenantColumn && parsed.settingKey === settingKey;
}

/** Match only the exact fail-closed context predicate emitted by generateSetupSql(). */
export function contextGuardExpressionMatchesGeneratedContract(
  expression: string | null,
  settingKey: string,
): boolean {
  if (expression === null) return false;
  return parseContextGuardPolicyExpression(expression)?.settingKey === settingKey;
}

function parseTenantPolicyExpression(
  expression: string,
  policyType: TenantColumnPolicyType,
): { column: string; settingKey: string } | null {
  const rawTokens = tokenizePolicyExpression(expression);
  if (!rawTokens) return null;

  const tokens = rawTokens.filter(
    (token) => !(token.kind === 'symbol' && (token.value === '(' || token.value === ')')),
  );
  let index = 0;
  const column = tokens[index++];
  if (column?.kind !== 'identifier') return null;

  if (policyType === 'text' && hasCast(tokens, index, 'text')) index += 2;
  if (!isSymbol(tokens[index++], '=')) return null;

  if (policyType === 'uuid') {
    if (!isIdentifier(tokens[index++], 'nullif')) return null;
  }

  if (
    isIdentifier(tokens[index], 'pg_catalog') &&
    isSymbol(tokens[index + 1], '.')
  ) {
    index += 2;
  }
  if (!isIdentifier(tokens[index++], 'current_setting')) return null;

  const setting = tokens[index++];
  if (setting?.kind !== 'string') return null;
  if (hasCast(tokens, index, 'text')) index += 2;
  if (!isSymbol(tokens[index++], ',')) return null;
  if (!isIdentifier(tokens[index++], 'true')) return null;

  if (policyType === 'uuid') {
    if (!isSymbol(tokens[index++], ',')) return null;
    const emptyFallback = tokens[index++];
    if (emptyFallback?.kind !== 'string' || emptyFallback.value !== '') {
      return null;
    }
    if (hasCast(tokens, index, 'text')) index += 2;
    if (!hasCast(tokens, index, 'uuid')) return null;
    index += 2;
  } else if (hasCast(tokens, index, 'text')) {
    index += 2;
  }

  if (index !== tokens.length) return null;
  return { column: column.value, settingKey: setting.value };
}

function parseContextGuardPolicyExpression(
  expression: string,
): { settingKey: string } | null {
  const rawTokens = tokenizePolicyExpression(expression);
  if (!rawTokens) return null;

  const tokens = rawTokens.filter(
    (token) => !(token.kind === 'symbol' && (token.value === '(' || token.value === ')')),
  );
  let index = 0;

  if (!isIdentifier(tokens[index++], 'nullif')) return null;
  if (
    isIdentifier(tokens[index], 'pg_catalog') &&
    isSymbol(tokens[index + 1], '.')
  ) {
    index += 2;
  }
  if (!isIdentifier(tokens[index++], 'current_setting')) return null;

  const setting = tokens[index++];
  if (setting?.kind !== 'string') return null;
  if (hasCast(tokens, index, 'text')) index += 2;
  if (!isSymbol(tokens[index++], ',')) return null;
  if (!isIdentifier(tokens[index++], 'true')) return null;
  if (!isSymbol(tokens[index++], ',')) return null;

  const emptyFallback = tokens[index++];
  if (emptyFallback?.kind !== 'string' || emptyFallback.value !== '') {
    return null;
  }
  if (hasCast(tokens, index, 'text')) index += 2;
  if (!isIdentifier(tokens[index++], 'is')) return null;
  if (!isIdentifier(tokens[index++], 'not')) return null;
  if (!isIdentifier(tokens[index++], 'null')) return null;
  if (index !== tokens.length) return null;

  return { settingKey: setting.value };
}

function hasCast(
  tokens: PolicyToken[],
  index: number,
  castType: TenantColumnPolicyType,
): boolean {
  return isSymbol(tokens[index], '::') &&
    isIdentifier(tokens[index + 1], castType);
}

function tokenizePolicyExpression(expression: string): PolicyToken[] | null {
  const tokens: PolicyToken[] = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (expression.startsWith('::', index)) {
      tokens.push({ kind: 'symbol', value: '::' });
      index += 2;
      continue;
    }
    if ('(),=.'.includes(char)) {
      tokens.push({ kind: 'symbol', value: char });
      index += 1;
      continue;
    }
    if (char === '"') {
      let value = '';
      index += 1;
      let closed = false;
      while (index < expression.length) {
        if (expression[index] === '"') {
          if (expression[index + 1] === '"') {
            value += '"';
            index += 2;
            continue;
          }
          index += 1;
          closed = true;
          break;
        }
        value += expression[index];
        index += 1;
      }
      if (!closed) return null;
      tokens.push({ kind: 'identifier', value, quoted: true });
      continue;
    }
    if (char === "'") {
      let value = '';
      index += 1;
      let closed = false;
      while (index < expression.length) {
        if (expression[index] === "'") {
          if (expression[index + 1] === "'") {
            value += "'";
            index += 2;
            continue;
          }
          index += 1;
          closed = true;
          break;
        }
        value += expression[index];
        index += 1;
      }
      if (!closed) return null;
      tokens.push({ kind: 'string', value });
      continue;
    }
    const identifier = /^[A-Za-z_][A-Za-z0-9_$]*/.exec(expression.slice(index));
    if (!identifier) return null;
    tokens.push({ kind: 'identifier', value: identifier[0].toLowerCase(), quoted: false });
    index += identifier[0].length;
  }
  return tokens;
}

function isIdentifier(token: PolicyToken | undefined, value: string): boolean {
  return token?.kind === 'identifier' && !token.quoted && token.value === value;
}

function isSymbol(token: PolicyToken | undefined, value: string): boolean {
  return token?.kind === 'symbol' && token.value === value;
}
