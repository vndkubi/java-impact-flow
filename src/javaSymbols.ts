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
  let currentClass: string | undefined;

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? '';
    const lineNo = index + 1;
    const classMatch = line.match(/\b(class|interface|enum|record)\s+([A-Za-z_$][\w$]*)\b/);
    if (classMatch) {
      currentClass = classMatch[2];
      symbols.push({
        target: currentClass ?? path.posix.basename(file, '.java'),
        name: currentClass ?? path.posix.basename(file, '.java'),
        file,
        line: lineNo,
        endLine: lines.length,
        kind: 'class',
      });
    }

    if (isPlausibleDeclarationStart(line)) {
      const declaration = collectDeclaration(lines, index);
      const method = methodNameFromDeclaration(declaration, currentClass);
      if (method) {
        symbols.push({
          target: currentClass ? `${currentClass}.${method}` : method,
          name: method,
          owner: currentClass,
          file,
          line: lineNo,
          endLine: lines.length,
          kind: 'method',
        });
      }
    }
  }

  return closeSymbolRanges(symbols, lastNonEmptyLine(lines));
}

export function impactLensTitle(counts: ImpactLensCounts): string {
  return `Impact: ${counts.endpoints} endpoints | ${counts.tests} tests | ${counts.references} refs`;
}

function closeSymbolRanges(symbols: JavaSourceSymbol[], fileEndLine: number): JavaSourceSymbol[] {
  const sorted = symbols.slice().sort((a, b) => a.line - b.line || (a.kind === 'class' ? -1 : 1));
  for (let index = 0; index < sorted.length; index++) {
    const symbol = sorted[index]!;
    const next = sorted[index + 1];
    symbol.endLine = next ? Math.max(symbol.line, next.line - 1) : fileEndLine;
  }
  return sorted;
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
  for (let offset = 0; offset < 8 && startIndex + offset < lines.length; offset++) {
    const line = lines[startIndex + offset] ?? '';
    parts.push(line);
    if (line.includes('{') || line.trim().endsWith(';')) break;
  }
  return parts.join(' ');
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
