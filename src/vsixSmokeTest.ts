#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { parseReleaseManifest } from './releasePublishGuard.js';

export interface VsixSmokeResult {
  ok: boolean;
  packagePath: string;
  totalEntries: number;
  missingEntries: string[];
  forbiddenEntries: string[];
  topLevelEntries: string[];
  packageSizeBytes: number;
  maxPackageSizeBytes: number;
  maxPackageEntries: number;
}

const ONE_MB = 1024 * 1024;
const DEFAULT_MAX_PACKAGE_SIZE_BYTES = 20 * ONE_MB;
const DEFAULT_MAX_PACKAGE_ENTRIES = 120;

const DEFAULT_REQUIRED_ENTRIES = [
  '[Content_Types].xml',
  'extension.vsixmanifest',
  'extension/package.json',
  'extension/assets/icon.png',
  'extension/readme.md',
  'extension/dist/cli.js',
  'extension/dist/extension.js',
];

const DEFAULT_FORBIDDEN_ENTRY_PREFIXES = [
  '.vscode/',
  '.git/',
  '.github/',
  'src/',
  'tests/',
  'validation/',
  'a/',
  'outputs/',
  'node_modules/',
  'coverage/',
  'dist/',
];

export function parseVsixEntries(vsixPath: string): string[] {
  const buffer = fs.readFileSync(vsixPath);
  return parseZipEntriesFromBuffer(buffer);
}

export function parseZipEntriesFromBuffer(buffer: Buffer): string[] {
  const candidates = findEndOfCentralDirectoryOffsetCandidates(buffer);
  let lastError: unknown;

  for (const eocdOffset of candidates) {
    try {
      return parseZipEntriesFromEocd(buffer, eocdOffset);
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw new Error(
      `Invalid VSIX/ZIP: ${(lastError instanceof Error) ? lastError.message : 'failed to read central directory.'}`,
    );
  }
  throw new Error('Invalid VSIX/ZIP: missing End of Central Directory record.');
}

function parseZipEntriesFromEocd(buffer: Buffer, eocdOffset: number): string[] {
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const cdOffset = buffer.readUInt32LE(eocdOffset + 16);
  const cdSize = buffer.readUInt32LE(eocdOffset + 12);
  let cursor = cdOffset;
  const names: string[] = [];
  let traversed = 0;

  for (let i = 0; i < entryCount; i++) {
    if (cursor + 4 > buffer.length) {
      throw new Error('Invalid VSIX/ZIP: central directory truncated.');
    }
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error(`Invalid VSIX/ZIP: expected central directory header at offset ${cursor}.`);
    }

    const fileNameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const headerLength = 46;
    const nameStart = cursor + headerLength;
    const nameEnd = nameStart + fileNameLength;

    const name = buffer.toString('utf8', nameStart, nameEnd).replace(/\\/g, '/');
    names.push(name);

    const recordLength = 46 + fileNameLength + extraLength + commentLength;
    cursor += recordLength;
    traversed += recordLength;
  }

  if (cursor > buffer.length) {
    throw new Error('Invalid VSIX/ZIP: central directory truncated.');
  }
  if (traversed !== cdSize) {
    throw new Error('Invalid VSIX/ZIP: central directory size mismatch.');
  }

  return names;
}

export function runVsixSmokeCheckFromEntries(
  entries: string[],
  requiredEntries: string[] = DEFAULT_REQUIRED_ENTRIES,
  forbiddenPrefixes: string[] = DEFAULT_FORBIDDEN_ENTRY_PREFIXES,
): VsixSmokeResult {
  const normalized = entries.map((entry) => entry.replace(/\\/g, '/'));
  const missingEntries = requiredEntries.filter((entry) => !normalized.includes(entry));
  const forbiddenEntries = normalized.filter((entry) => {
    return forbiddenPrefixes.some(prefix => entry === prefix || entry.startsWith(prefix));
  });

  const topLevelEntries = Array.from(new Set(
    normalized
      .map(entry => entry.split('/')[0] ?? '')
      .filter(Boolean),
  ));

  return {
    ok: missingEntries.length === 0 && forbiddenEntries.length === 0,
    packageSizeBytes: 0,
    maxPackageSizeBytes: Number.MAX_SAFE_INTEGER,
    maxPackageEntries: Number.MAX_SAFE_INTEGER,
    packagePath: 'virtual',
    totalEntries: normalized.length,
    missingEntries,
    forbiddenEntries,
    topLevelEntries,
  };
}

export function runVsixSmokeCheckFromPath(
  packagePath: string,
  requiredEntries: string[] = DEFAULT_REQUIRED_ENTRIES,
  forbiddenPrefixes: string[] = DEFAULT_FORBIDDEN_ENTRY_PREFIXES,
  maxPackageSizeBytes: number = DEFAULT_MAX_PACKAGE_SIZE_BYTES,
  maxPackageEntries: number = DEFAULT_MAX_PACKAGE_ENTRIES,
): VsixSmokeResult {
  const entries = parseVsixEntries(packagePath);
  const result = runVsixSmokeCheckFromEntries(entries, requiredEntries, forbiddenPrefixes);
  const packageSizeBytes = fs.statSync(packagePath).size;
  const tooLarge = packageSizeBytes > maxPackageSizeBytes;
  const tooManyEntries = result.totalEntries > maxPackageEntries;
  return {
    ...result,
    packagePath,
    packageSizeBytes,
    maxPackageSizeBytes,
    maxPackageEntries,
    ok: result.ok && !tooLarge && !tooManyEntries,
    missingEntries: result.missingEntries,
    forbiddenEntries: result.forbiddenEntries,
  };
}

function resolveManifestPackagePath(manifestPath?: string): string {
  const manifest = parseReleaseManifest(manifestPath);
  const packageDir = manifestPath ? path.dirname(path.resolve(manifestPath)) : process.cwd();
  return path.join(packageDir, `${manifest.name}-${manifest.version}.vsix`);
}

export function runVsixSmokeCheckFromCli(argv: string[] = process.argv.slice(2)): VsixSmokeResult {
  let packagePath: string | undefined;
  let manifestPath: string | undefined;
  let json = false;
  let reportPath: string | undefined;
  let maxPackageSizeBytes = DEFAULT_MAX_PACKAGE_SIZE_BYTES;
  let maxPackageEntries = DEFAULT_MAX_PACKAGE_ENTRIES;
  let maxFromEnv = process.env.VSIX_SMOKE_MAX_SIZE_BYTES;
  if (maxFromEnv && maxFromEnv.trim()) {
    const parsedFromEnv = Number.parseInt(maxFromEnv, 10);
    if (!Number.isFinite(parsedFromEnv) || parsedFromEnv <= 0) {
      throw new Error(`Invalid VSIX_SMOKE_MAX_SIZE_BYTES: ${maxFromEnv}`);
    }
    maxPackageSizeBytes = parsedFromEnv;
  }
  const maxEntriesFromEnv = process.env.VSIX_SMOKE_MAX_ENTRIES;
  if (maxEntriesFromEnv && maxEntriesFromEnv.trim()) {
    const parsedEntriesFromEnv = Number.parseInt(maxEntriesFromEnv, 10);
    if (!Number.isFinite(parsedEntriesFromEnv) || parsedEntriesFromEnv <= 0) {
      throw new Error(`Invalid VSIX_SMOKE_MAX_ENTRIES: ${maxEntriesFromEnv}`);
    }
    maxPackageEntries = parsedEntriesFromEnv;
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') {
      json = true;
      continue;
    }
      if (arg === '--help' || arg === '-h') {
        console.log('Usage: node dist/vsixSmokeTest.js [--json] [--manifest package.json] [--packagePath file]');
        console.log('Options for CI output: [--report <file>]');
        console.log('Options for package limits: [--max-size <bytes>], defaults to 20MB.');
        console.log('Options for entry limits: [--max-entries <count>], defaults to 120.');
        console.log('Env override: VSIX_SMOKE_MAX_SIZE_BYTES, VSIX_SMOKE_MAX_ENTRIES');
        return {
          ok: true,
          packagePath: 'virtual',
          totalEntries: 0,
          missingEntries: [],
          forbiddenEntries: [],
          topLevelEntries: [],
          packageSizeBytes: 0,
          maxPackageSizeBytes,
          maxPackageEntries,
        };
      }
    if (arg === '--report') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      reportPath = value;
      i += 1;
      continue;
    }
    if (arg === '--manifest' || arg === '--packagePath') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      if (arg === '--manifest') manifestPath = value;
      if (arg === '--packagePath') packagePath = value;
      i += 1;
      continue;
    }
    if (arg === '--max-size') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid value for ${arg}: ${value}`);
      }
      maxPackageSizeBytes = parsed;
      i += 1;
      continue;
    }
    if (arg === '--max-entries') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new Error(`Invalid value for ${arg}: ${value}`);
      }
      maxPackageEntries = parsed;
      i += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  const resolvedPackagePath = packagePath ?? resolveManifestPackagePath(manifestPath);
  const result = runVsixSmokeCheckFromPath(
    resolvedPackagePath,
    DEFAULT_REQUIRED_ENTRIES,
    DEFAULT_FORBIDDEN_ENTRY_PREFIXES,
    maxPackageSizeBytes,
    maxPackageEntries,
  );

  const effectiveReportPath = reportPath ?? process.env.VSIX_SMOKE_REPORT;
  if (effectiveReportPath) {
    writeVsixSmokeReport(result, path.resolve(effectiveReportPath));
  }

  if (json) {
    console.log(JSON.stringify({
      ok: result.ok,
      packagePath: result.packagePath,
      totalEntries: result.totalEntries,
      missingEntries: result.missingEntries,
      forbiddenEntries: result.forbiddenEntries,
      topLevelEntries: result.topLevelEntries,
      packageSizeBytes: result.packageSizeBytes,
      maxPackageSizeBytes: result.maxPackageSizeBytes,
      maxPackageEntries: result.maxPackageEntries,
    }));
    if (!result.ok) process.exitCode = 1;
    return result;
  }

  if (result.ok) {
    console.log(`vsix smoke check passed for ${path.basename(result.packagePath)} with ${result.totalEntries} entries.`);
    console.log(`vsix package size: ${result.packageSizeBytes} bytes (limit: ${result.maxPackageSizeBytes} bytes).`);
    return result;
  }

  console.error(`vsix smoke check failed for ${path.basename(result.packagePath)}.`);
  if (result.packageSizeBytes > result.maxPackageSizeBytes) {
    console.error(`Package size ${result.packageSizeBytes} bytes exceeds limit ${result.maxPackageSizeBytes} bytes.`);
  }
  if (result.totalEntries > result.maxPackageEntries) {
    console.error(`Package entry count ${result.totalEntries} exceeds limit ${result.maxPackageEntries}.`);
  }
  if (result.missingEntries.length > 0) {
    console.error(`Missing entries: ${result.missingEntries.join(', ')}`);
  }
  if (result.forbiddenEntries.length > 0) {
    console.error(`Forbidden entries: ${result.forbiddenEntries.join(', ')}`);
  }
  process.exitCode = 1;
  return result;
}

function writeVsixSmokeReport(result: VsixSmokeResult, reportPath: string): void {
  const outputDir = path.dirname(reportPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(reportPath, `${JSON.stringify(result)}\n`, 'utf-8');
}

function findEndOfCentralDirectoryOffsetCandidates(buffer: Buffer): number[] {
  const offsets: number[] = [];
  const eocdSignature = 0x06054b50;
  const maxBacktrack = 0xFFFF + 22;
  const start = Math.max(0, buffer.length - maxBacktrack);
  for (let i = buffer.length - 4; i >= start; i -= 1) {
    if (buffer.readUInt32LE(i) !== eocdSignature) continue;

    const commentLength = buffer.readUInt16LE(i + 20);
    const totalSize = 22 + commentLength;
    const possibleEnd = i + totalSize;
    if (possibleEnd > buffer.length) continue;

    const entryCount = buffer.readUInt16LE(i + 10);
    const centralDirectorySize = buffer.readUInt32LE(i + 12);
    const centralDirectoryOffset = buffer.readUInt32LE(i + 16);
    if (centralDirectoryOffset + centralDirectorySize !== i) continue;
    if (entryCount === 0 && centralDirectorySize > 0) continue;
    if (entryCount > 0 && centralDirectorySize < 46 * entryCount) continue;
    if (possibleEnd !== buffer.length) continue;

    offsets.push(i);
  }
  return offsets;
}

if (path.basename(process.argv[1] ?? '').includes('vsixSmokeTest.js')) {
  try {
    runVsixSmokeCheckFromCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
