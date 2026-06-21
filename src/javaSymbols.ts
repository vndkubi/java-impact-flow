import path from 'node:path';

export interface JavaSourceSymbol {
  target: string;
  name: string;
  owner?: string;
  file: string;
  line: number;
  endLine: number;
  kind: 'class' | 'method';
}

export interface ImpactLensCounts {
  endpoints: number;
  tests: number;
  references: number;
}

interface JavaClassScope {
  name: string;
  endLine: number;
}

interface NonCodeScanState {
  inBlockComment: boolean;
  inTextBlock: boolean;
}

const CONTROL_KEYWORDS = new Set([
  'catch',
  'for',
  'if',
  'new',
  'return',
  'switch',
  'throw',
  'while',
]);

export function findJavaSourceSymbols(file: string, content: string): JavaSourceSymbol[] {
  const lines = content.split(/\r?\n/);
  const symbols: JavaSourceSymbol[] = [];
  const classScopes: JavaClassScope[] = [];
  const fileEndLine = lastNonEmptyLine(lines);
  let scanState: NonCodeScanState = { inBlockComment: false, inTextBlock: false };

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const lineNo = index + 1;
    const stripped = stripNonCodeForBraceScan(line, scanState);
    scanState = stripped.state;
    const codeLine = stripped.code;

    while (classScopes.length > 0 && classScopes[classScopes.length - 1]!.endLine < lineNo) {
      classScopes.pop();
    }

    const classMatch = codeLine.match(/\b(class|interface|enum|record)\s+([A-Za-z_$][\w$]*)\b/);
    if (classMatch) {
      const currentClass = classMatch[2] ?? path.posix.basename(file, '.java');
      const endLine = findBlockEndLine(lines, index) ?? fileEndLine;
      symbols.push({
        target: currentClass,
        name: currentClass,
        file,
        line: lineNo,
        endLine,
        kind: 'class',
      });
      classScopes.push({ name: currentClass, endLine });
    }

    const currentClass = classScopes[classScopes.length - 1]?.name;
    if (isPlausibleDeclarationStart(codeLine)) {
      const declaration = collectDeclaration(lines, index);
      const method = methodNameFromDeclaration(declaration, currentClass);
      if (method) {
        symbols.push({
          target: currentClass ? `${currentClass}.${method}` : method,
          name: method,
          owner: currentClass,
          file,
          line: lineNo,
          endLine: findBlockEndLine(lines, index) ?? fileEndLine,
          kind: 'method',
        });
      }
    }
  }

  return symbols.sort((a, b) => a.line - b.line || (a.kind === 'class' ? -1 : 1));
}

export function impactLensTitle(counts: ImpactLensCounts): string {
  return `Impact: ${counts.endpoints} endpoints | ${counts.tests} tests | ${counts.references} refs`;
}

function isPlausibleDeclarationStart(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('}')) return false;
  if (trimmed.endsWith(';')) return false;
  return trimmed.includes('(');
}

function lastNonEmptyLine(lines: string[]): number {
  for (let index = lines.length - 1; index >= 0; index--) {
    if ((lines[index] ?? '').trim()) return index + 1;
  }
  return 1;
}

function collectDeclaration(lines: string[], startIndex: number): string {
  const parts: string[] = [];
  for (let offset = 0; offset < 24 && startIndex + offset < lines.length; offset++) {
    const line = lines[startIndex + offset] ?? '';
    parts.push(line);
    const trimmed = line.trim();
    if (trimmed.includes('{') || trimmed.endsWith(';')) break;
  }
  return parts.join(' ');
}

function findBlockEndLine(lines: string[], startIndex: number): number | undefined {
  let depth = 0;
  let started = false;
  let scanState: NonCodeScanState = { inBlockComment: false, inTextBlock: false };

  for (let index = startIndex; index < lines.length; index++) {
    const stripped = stripNonCodeForBraceScan(lines[index] ?? '', scanState);
    const line = stripped.code;
    scanState = stripped.state;
    for (const char of line) {
      if (char === '{') {
        depth++;
        started = true;
      } else if (char === '}' && started) {
        depth--;
        if (depth === 0) return index + 1;
      }
    }
  }

  return undefined;
}

function stripNonCodeForBraceScan(line: string, state: NonCodeScanState): {
  code: string;
  state: NonCodeScanState;
} {
  let result = '';
  let quote: '"' | "'" | undefined;
  let escaped = false;
  let blockComment = state.inBlockComment;
  let textBlock = state.inTextBlock;

  for (let index = 0; index < line.length; index++) {
    const char = line[index] ?? '';
    const next = line[index + 1];
    const afterNext = line[index + 2];

    if (textBlock) {
      result += ' ';
      if (char === '"' && next === '"' && afterNext === '"') {
        textBlock = false;
        result += '  ';
        index += 2;
      }
      continue;
    }

    if (blockComment) {
      result += ' ';
      if (char === '*' && next === '/') {
        blockComment = false;
        result += ' ';
        index++;
      }
      continue;
    }

    if (!quote && char === '/' && next === '/') break;

    if (quote) {
      result += ' ';
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === quote) {
        quote = undefined;
      }
      continue;
    }

    if (char === '"' && next === '"' && afterNext === '"') {
      textBlock = true;
      result += '   ';
      index += 2;
      continue;
    }

    if (char === '/' && next === '*') {
      blockComment = true;
      result += '  ';
      index++;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      result += ' ';
      continue;
    }

    result += char;
  }

  return { code: result, state: { inBlockComment: blockComment, inTextBlock: textBlock } };
}

function methodNameFromDeclaration(declaration: string, owner: string | undefined): string | undefined {
  const clean = declaration
    .replace(/\/\/.*$/, '')
    .replace(/@[\w.]+(?:\([^)]*\))?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean.includes('(') || clean.endsWith(';')) return undefined;
  if (/^(?:if|for|while|switch|catch|return|throw|new)\b/.test(clean)) return undefined;
  const beforeParen = clean.slice(0, clean.indexOf('(')).trim();
  const tokens = beforeParen.split(/\s+/).filter(Boolean);
  const candidate = tokens.at(-1);
  if (!candidate || CONTROL_KEYWORDS.has(candidate) || !/^[A-Za-z_$][\w$]*$/.test(candidate)) return undefined;
  if (owner && candidate === owner) return undefined;
  return tokens.length >= 2 ? candidate : undefined;
}
