export interface ParsedNativeType {
  namespace: string;
  name: string;
  args?: string;
}

export interface ParsedField {
  fieldName: string;
  columnName: string;
  scalarType: string;
  arity: 'required' | 'optional' | 'list';
  nativeTypes: ParsedNativeType[];
  ignored?: boolean;
}

export interface ParsedModel {
  modelName: string;
  tableName: string;
  schemaName?: string;
  /** Present on parser-origin models; omitted by legacy direct template callers. */
  fields?: ParsedField[];
}

const PRISMA_IDENTIFIER_SOURCE = String.raw`[_\p{ID_Start}][_\p{ID_Continue}]*`;
const LEADING_PRISMA_IDENTIFIER = new RegExp(
  `^(${PRISMA_IDENTIFIER_SOURCE})`,
  'u',
);
const FIELD_DEFINITION_START = new RegExp(
  `^\\s*${PRISMA_IDENTIFIER_SOURCE}\\s+`,
  'u',
);
const MODEL_START = new RegExp(
  `^model\\s+(${PRISMA_IDENTIFIER_SOURCE})\\s*\\{`,
  'u',
);
const NATIVE_TYPE_START = new RegExp(
  `^@(${PRISMA_IDENTIFIER_SOURCE})\\.(${PRISMA_IDENTIFIER_SOURCE})`,
  'u',
);
const PRISMA_IDENTIFIER_CONTINUE = /^[_\p{ID_Continue}]$/u;

function isPrismaIdentifierContinueAt(value: string, index: number): boolean {
  const codePoint = value.codePointAt(index);
  return codePoint !== undefined &&
    PRISMA_IDENTIFIER_CONTINUE.test(String.fromCodePoint(codePoint));
}

function parseParenthesized(
  value: string,
  openIndex: number,
): { contents: string; end: number } | undefined {
  if (value[openIndex] !== '(') return undefined;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = openIndex; index < value.length; index++) {
    const character = value[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === '(') {
      depth++;
    } else if (character === ')') {
      depth--;
      if (depth === 0) {
        return {
          contents: value.slice(openIndex + 1, index),
          end: index + 1,
        };
      }
    }
  }

  return undefined;
}

function parseMapping(
  body: string,
  directive: 'map' | 'schema',
): string | undefined {
  const token = '@@' + directive;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < body.length; index++) {
    const character = body[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }
    if (
      !body.startsWith(token, index) ||
      isPrismaIdentifierContinueAt(body, index + token.length)
    ) {
      continue;
    }

    const match = new RegExp(
      `^@@${directive}\\s*\\(\\s*("(?:\\\\.|[^"\\\\])*")\\s*\\)`,
    ).exec(body.slice(index));
    if (!match) {
      throw new Error(`Invalid Prisma @@${directive} directive.`);
    }

    try {
      return decodePrismaStringLiteral(match[1]);
    } catch {
      throw new Error(`Invalid Prisma @@${directive} string literal.`);
    }
  }

  return undefined;
}

function decodePrismaStringLiteral(literal: string): string {
  const decoded: unknown = JSON.parse(literal);
  if (typeof decoded !== 'string') throw new Error('not a string');

  for (let index = 0; index < decoded.length; index++) {
    const codeUnit = decoded.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const lowCodeUnit = decoded.charCodeAt(index + 1);
      if (!(lowCodeUnit >= 0xdc00 && lowCodeUnit <= 0xdfff)) {
        throw new Error('invalid lone unicode surrogate');
      }
      index++;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      throw new Error('invalid lone unicode surrogate');
    }
  }

  return decoded;
}

function parseFieldMap(definition: string): string | undefined {
  let mapping: string | undefined;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < definition.length; index++) {
    const character = definition[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }
    if (
      character !== '@' ||
      definition[index - 1] === '@' ||
      !definition.startsWith('@map', index) ||
      definition[index + 4] === '.' ||
      isPrismaIdentifierContinueAt(definition, index + 4)
    ) {
      continue;
    }

    const match = /^@map\s*\(\s*("(?:\\.|[^"\\])*")\s*\)/
      .exec(definition.slice(index));
    if (!match) throw new Error('Invalid Prisma field @map directive.');
    if (mapping !== undefined) {
      throw new Error('A Prisma field cannot declare more than one @map directive.');
    }
    try {
      mapping = decodePrismaStringLiteral(match[1]);
    } catch {
      throw new Error('Invalid Prisma field @map string literal.');
    }
    index += match[0].length - 1;
  }

  return mapping;
}

function hasFieldDirective(definition: string, directive: string): boolean {
  const token = `@${directive}`;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < definition.length; index++) {
    const character = definition[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }
    if (
      character === '@' &&
      definition[index - 1] !== '@' &&
      definition.startsWith(token, index) &&
      definition[index + token.length] !== '.' &&
      !isPrismaIdentifierContinueAt(definition, index + token.length)
    ) {
      return true;
    }
  }

  return false;
}

function parseNativeTypes(definition: string): ParsedNativeType[] {
  const nativeTypes: ParsedNativeType[] = [];
  let inString = false;
  let escaped = false;

  for (let index = 0; index < definition.length; index++) {
    const character = definition[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }
    if (character !== '@' || definition[index - 1] === '@') continue;

    const match = NATIVE_TYPE_START.exec(definition.slice(index));
    if (!match) continue;
    let end = index + match[0].length;
    let argumentStart = end;
    while (/\s/.test(definition[argumentStart] ?? '')) argumentStart++;
    const argumentsGroup = definition[argumentStart] === '('
      ? parseParenthesized(definition, argumentStart)
      : undefined;
    nativeTypes.push({
      namespace: match[1],
      name: match[2],
      ...(argumentsGroup === undefined
        ? {}
        : { args: argumentsGroup.contents.trim() }),
    });
    if (argumentsGroup !== undefined) end = argumentsGroup.end;
    index = end - 1;
  }

  return nativeTypes;
}

function parseFieldType(
  definition: string,
): { scalarType: string; end: number } | undefined {
  const match = LEADING_PRISMA_IDENTIFIER.exec(definition);
  if (!match) return undefined;
  if (match[1] !== 'Unsupported') {
    return { scalarType: match[1], end: match[0].length };
  }

  let openIndex = match[0].length;
  while (/\s/.test(definition[openIndex] ?? '')) openIndex++;
  if (definition[openIndex] !== '(') {
    return { scalarType: match[1], end: match[0].length };
  }
  const unsupported = parseParenthesized(definition, openIndex);
  if (unsupported === undefined) return undefined;
  return { scalarType: 'Unsupported', end: unsupported.end };
}

function parseFields(body: string): ParsedField[] {
  const fields: ParsedField[] = [];
  const definitions: string[] = [];

  for (const line of body.split('\n')) {
    if (FIELD_DEFINITION_START.test(line)) {
      definitions.push(line.trim());
    } else if (/^\s*@(?!@)/.test(line) && definitions.length > 0) {
      definitions[definitions.length - 1] += ` ${line.trim()}`;
    }
  }

  for (const definitionLine of definitions) {
    const fieldMatch = LEADING_PRISMA_IDENTIFIER.exec(definitionLine);
    if (!fieldMatch) continue;
    let typeStart = fieldMatch[0].length;
    if (!/\s/.test(definitionLine[typeStart] ?? '')) continue;
    while (/\s/.test(definitionLine[typeStart] ?? '')) typeStart++;

    const fieldType = parseFieldType(definitionLine.slice(typeStart));
    if (fieldType === undefined) continue;
    let definitionStart = typeStart + fieldType.end;
    let arity: ParsedField['arity'] = 'required';
    if (definitionLine.startsWith('?', definitionStart)) {
      arity = 'optional';
      definitionStart++;
    } else if (definitionLine.startsWith('[]', definitionStart)) {
      arity = 'list';
      definitionStart += 2;
    }

    if (
      definitionStart < definitionLine.length &&
      !/\s/.test(definitionLine[definitionStart])
    ) {
      continue;
    }
    const definition = definitionLine.slice(definitionStart).trimStart();
    fields.push({
      fieldName: fieldMatch[1],
      columnName: parseFieldMap(definition) ?? fieldMatch[1],
      scalarType: fieldType.scalarType,
      arity,
      nativeTypes: parseNativeTypes(definition),
      ...(hasFieldDirective(definition, 'ignore') ? { ignored: true } : {}),
    });
  }

  return fields;
}

function scanPrismaLine(
  line: string,
  startsInBlockComment: boolean,
): { content: string; braceDelta: number; inBlockComment: boolean } {
  let content = '';
  let braceDelta = 0;
  let inString = false;
  let escaped = false;
  let inBlockComment = startsInBlockComment;

  for (let index = 0; index < line.length; index++) {
    const character = line[index];

    if (inBlockComment) {
      if (character === '*' && line[index + 1] === '/') {
        inBlockComment = false;
        content += ' ';
        index++;
      }
      continue;
    }

    if (inString) {
      content += character;
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '/' && line[index + 1] === '/') break;
    if (character === '/' && line[index + 1] === '*') {
      inBlockComment = true;
      content += ' ';
      index++;
      continue;
    }

    content += character;
    if (character === '"') inString = true;
    else if (character === '{') braceDelta++;
    else if (character === '}') braceDelta--;
  }

  return { content, braceDelta, inBlockComment };
}

/**
 * Parse Prisma schema content to extract model names and table mappings.
 * Ignores enums, types, and views.
 *
 * Uses line-by-line parsing with brace balancing to correctly handle
 * field defaults containing braces (e.g., `@default("{}")`).
 */
export function parseModels(schemaContent: string): ParsedModel[] {
  const models: ParsedModel[] = [];
  const lines = schemaContent.split('\n');

  let currentModel: string | null = null;
  let body = '';
  let depth = 0;
  let inBlockComment = false;

  for (const line of lines) {
    const scanned = scanPrismaLine(line, inBlockComment);
    inBlockComment = scanned.inBlockComment;

    if (currentModel === null) {
      const modelStart = MODEL_START.exec(scanned.content);
      if (modelStart) {
        currentModel = modelStart[1];
        body = '';
        depth = scanned.braceDelta;
      }
      continue;
    }

    depth += scanned.braceDelta;

    if (depth <= 0) {
      const tableName = parseMapping(body, 'map') ?? currentModel;
      const schemaName = parseMapping(body, 'schema');
      models.push({
        modelName: currentModel,
        tableName,
        schemaName,
        fields: parseFields(body),
      });
      currentModel = null;
    } else {
      body += scanned.content + '\n';
    }
  }

  return models;
}
