import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { findJavaSourceSymbols } from './javaSymbols.js';

const execFileAsync = promisify(execFile);

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
    if (record.length < 4) continue;
    const status = record.slice(0, 2);
    const file = slash(record.slice(3));
    if (status.includes('D')) continue;
    if (file.endsWith('.java')) files.push({ file, status: status.trim() || 'M' });
    if (status.startsWith('R') || status.startsWith('C')) index++;
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
  const targets: ChangedJavaTarget[] = [];

  for (const line of inspectedLines) {
    const method = symbols
      .filter(symbol => symbol.kind === 'method' && symbol.line <= line && line <= symbol.endLine)
      .sort((a, b) => b.line - a.line)[0];
    const classSymbol = symbols
      .filter(symbol => symbol.kind === 'class' && symbol.line <= line && line <= symbol.endLine)
      .sort((a, b) => b.line - a.line)[0];
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

export function parseUnifiedDiffNewLines(diff: string): number[] {
  const lines = new Set<number>();
  const pattern = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(diff))) {
    const start = Number(match[1] ?? '0');
    const count = match[2] === undefined ? 1 : Number(match[2]);
    for (let offset = 0; offset < count; offset++) lines.add(start + offset);
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
