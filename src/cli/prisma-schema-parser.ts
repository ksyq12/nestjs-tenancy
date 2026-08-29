export interface ParsedModel {
  modelName: string;
  tableName: string;
  schemaName?: string;
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
      /\w/.test(body[index + token.length] ?? '')
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
      const modelStart = scanned.content.match(/^model\s+(\w+)\s*\{/);
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
      models.push({ modelName: currentModel, tableName, schemaName });
      currentModel = null;
    } else {
      body += scanned.content + '\n';
    }
  }

  return models;
}
