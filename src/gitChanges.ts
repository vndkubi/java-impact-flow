import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { findJavaSourceSymbols } from './javaSymbols.js';

const execFileAsync = promisify(execFile);

const MAX_CHANGED_LINES_PER_HUNK = 5000;
const MAX_CHANGED_LINES_TOTAL = 20_000;

export interface ChangedJavaFile {
  file: string;
  status: string;
}

export interface ChangedJavaTarget {
  target: string;
  file: string;
  line: number;
  kind: 'class' | 'method' | 'file';
  reason: string;
}

export async function collectChangedJavaTargets(root: string, options: { maxTargets?: number } = {}): Promise<ChangedJavaTarget[]> {
  const files = await listChangedJavaFiles(root);
  return await inferChangedJavaTargets(root, files, options);
}

export async function listChangedJavaFiles(root: string): Promise<ChangedJavaFile[]> {
  const { stdout } = await execFileAsync('git', [
    '-C',
    root,
    'status',
    '--porcelain=v1',
    '-z',
    '--',
    '*.java',
  ], { maxBuffer: 5_000_000 });
  return parseGitPorcelainJavaFiles(stdout);
}

export function parseGitPorcelainJavaFiles(output: string): ChangedJavaFile[] {
  const parts = output.split('\0').filter(Boolean);
  const files: ChangedJavaFile[] = [];
  for (let index = 0; index < parts.length; index++) {
    const record = parts[index] ?? '';
    if (record.length < 2) continue;
    const statusToken = record.slice(0, 2);
    let status = statusToken.replace(/[0-9]/g, '').trim();
    if (status.length === 0) status = statusToken;
    const start = (() => {
      let cursor = 2;
      while (cursor < record.length && /\d/.test(record[cursor] ?? '')) cursor++;
      while (record[cursor] === ' ' || record[cursor] === '\t') cursor++;
      return cursor;
    })();
    const sourceFile = slash(record.slice(start).trimStart());
    if (status.includes('D')) continue;

    const statusName = status.trim() || 'M';
    if (status.includes('R') || status.includes('C')) {
      const destination = index + 1 < parts.length ? slash((parts[index + 1] ?? '').trimStart()) : '';
      if (destination.endsWith('.java')) {
        files.push({ file: destination, status: statusName });
      } else if (sourceFile.endsWith('.java')) {
        files.push({ file: sourceFile, status: statusName });
      }
      if (index + 1 < parts.length) index++;
      continue;
    }

    if (sourceFile.endsWith('.java')) files.push({ file: sourceFile, status: statusName });
  }
  return uniqueBy(files, item => item.file);
}

export async function inferChangedJavaTargets(
  root: string,
  files: ChangedJavaFile[],
  options: { maxTargets?: number } = {},
): Promise<ChangedJavaTarget[]> {
  const targets: ChangedJavaTarget[] = [];
  for (const item of files) {
    const absPath = path.resolve(root, item.file);
    let content: string;
    try {
      content = await fs.readFile(absPath, 'utf-8');
    } catch {
      continue;
    }
    const changedLines = item.status === '??'
      ? allLineNumbers(content)
      : await changedLinesForFile(root, item.file);
    targets.push(...inferTargetsFromJavaSource(item.file, content, changedLines));
  }
  return uniqueBy(targets, item => `${item.target}\0${item.file}`).slice(0, options.maxTargets ?? 12);
}

export function inferTargetsFromJavaSource(file: string, content: string, changedLines: number[]): ChangedJavaTarget[] {
  const symbols = findJavaSourceSymbols(file, content);
  const inspectedLines = changedLines.length ? changedLines : allLineNumbers(content);
  const methodSymbols = symbols.filter(symbol => symbol.kind === 'method');
  const classSymbols = symbols.filter(symbol => symbol.kind === 'class');
  const targets: ChangedJavaTarget[] = [];

  for (const line of inspectedLines) {
    const method = pickSymbolForLine(methodSymbols, line);
    const classSymbol = pickSymbolForLine(classSymbols, line);
    const symbol = method ?? classSymbol;
    if (symbol) {
      targets.push({
        target: symbol.target,
        file: symbol.file,
        line: symbol.line,
        kind: symbol.kind,
        reason: `changed line ${line}`,
      });
    }
  }

  if (targets.length > 0) return uniqueBy(targets, item => `${item.target}\0${item.file}`);

  const fallback = path.posix.basename(slash(file), '.java');
  return [{
    target: fallback,
    file,
    line: 1,
    kind: 'file',
    reason: 'changed Java file',
  }];
}

function pickSymbolForLine<T extends { line: number; endLine: number }>(symbols: T[], line: number): T | undefined {
  if (symbols.length === 0 || !Number.isFinite(line)) return undefined;

  let low = 0;
  let high = symbols.length - 1;
  let rightmostStart = -1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const symbol = symbols[mid];
    if (!symbol) break;
    if (symbol.line <= line) {
      rightmostStart = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  for (let index = rightmostStart; index >= 0; index -= 1) {
    const symbol = symbols[index];
    if (!symbol) continue;
    // Search backward to account for nested symbols where an inner block may
    // close before an outer block that started earlier.
    if (symbol.endLine >= line) return symbol;
  }
  return undefined;
}

export function parseUnifiedDiffNewLines(diff: string): number[] {
  const lines = new Set<number>();
  const pattern = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;
  let match: RegExpExecArray | null;
  let isCapped = false;
  while ((match = pattern.exec(diff))) {
    const start = Number(match[1] ?? '0');
    if (!Number.isFinite(start) || start <= 0) continue;
    const rawCount = match[2] === undefined ? 1 : Number(match[2]);
    if (!Number.isFinite(rawCount) || rawCount <= 0) continue;
    const count = Math.min(rawCount, MAX_CHANGED_LINES_PER_HUNK);
    for (let offset = 0; offset < count; offset++) {
      if (lines.size >= MAX_CHANGED_LINES_TOTAL) {
        isCapped = true;
        break;
      }
      lines.add(start + offset);
    }
    if (isCapped) break;
  }
  return [...lines].sort((a, b) => a - b);
}

async function changedLinesForFile(root: string, file: string): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync('git', [
      '-C',
      root,
      'diff',
      '--unified=0',
      'HEAD',
      '--',
      file,
    ], { maxBuffer: 5_000_000 });
    return parseUnifiedDiffNewLines(stdout);
  } catch {
    return [];
  }
}

function allLineNumbers(content: string): number[] {
  return content.split(/\r?\n/).map((_, index) => index + 1);
}

function uniqueBy<T>(items: T[], keyFor: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = keyFor(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

function slash(value: string): string {
  return value.replace(/\\/g, '/');
}
