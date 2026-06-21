import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  runVsixSmokeCheckFromCli,
  parseZipEntriesFromBuffer,
  runVsixSmokeCheckFromEntries,
  runVsixSmokeCheckFromPath,
} from '../src/vsixSmokeTest.js';

function buildMiniZip(entries: Record<string, string>): Buffer {
  const localSections: Buffer[] = [];
  const centralSections: Buffer[] = [];
  const fileOffsets: number[] = [];
  let localOffset = 0;
  let entryCount = 0;

  for (const [name, data] of Object.entries(entries)) {
    entryCount += 1;
    const fileNameBytes = Buffer.from(name, 'utf8');
    const dataBytes = Buffer.from(data, 'utf8');
    const fileNameLength = fileNameBytes.length;
    const localHeader = Buffer.alloc(30 + fileNameLength);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(dataBytes.length, 18);
    localHeader.writeUInt32LE(dataBytes.length, 22);
    localHeader.writeUInt16LE(fileNameLength, 26);
    localHeader.writeUInt16LE(0, 28);
    fileNameBytes.copy(localHeader, 30);
    localSections.push(localHeader);
    localSections.push(dataBytes);

    fileOffsets.push(localOffset);
    localOffset += localHeader.length + dataBytes.length;

    const centralHeader = Buffer.alloc(46 + fileNameLength);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(dataBytes.length, 20);
    centralHeader.writeUInt32LE(dataBytes.length, 24);
    centralHeader.writeUInt16LE(fileNameLength, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt32LE(0, 36);
    centralHeader.writeUInt32LE(fileOffsets[fileOffsets.length - 1] ?? 0, 42);
    fileNameBytes.copy(centralHeader, 46);
    centralSections.push(centralHeader);
  }

  const centralDirectory = Buffer.concat(centralSections);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entryCount, 8);
  eocd.writeUInt16LE(entryCount, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([
    ...localSections,
    centralDirectory,
    eocd,
  ]);
}

describe('vsix smoke test', () => {
  const cleanupRoots: string[] = [];

  afterEach(() => {
    for (const root of cleanupRoots) {
      rmSync(root, { recursive: true, force: true });
    }
    cleanupRoots.length = 0;
  });

  it('parses zip filenames from central directory', () => {
    const zip = buildMiniZip({
      'extension/package.json': '{}',
      'extension/dist/cli.js': 'console.log()',
      'src/ignore.java': 'class A {}',
    });
    const entries = parseZipEntriesFromBuffer(zip);
    expect(entries).toEqual([
      'extension/package.json',
      'extension/dist/cli.js',
      'src/ignore.java',
    ]);
  });

  it('passes known-good package contents', () => {
    const result = runVsixSmokeCheckFromEntries([
      '[Content_Types].xml',
      'extension.vsixmanifest',
      'extension/package.json',
      'extension/assets/icon.png',
      'extension/readme.md',
      'extension/dist/cli.js',
      'extension/dist/extension.js',
    ]);

    expect(result.ok).toBe(true);
    expect(result.missingEntries).toHaveLength(0);
    expect(result.forbiddenEntries).toHaveLength(0);
    expect(result.totalEntries).toBe(7);
  });

  it('fails when required entries are missing or forbidden are present', () => {
    const result = runVsixSmokeCheckFromEntries([
      '[Content_Types].xml',
      'extension.vsixmanifest',
      'extension/package.json',
      'extension/dist/extension.js',
      'src/cheat.js',
    ], ['extension/dist/cli.js']);

    expect(result.ok).toBe(false);
    expect(result.missingEntries).toEqual(['extension/dist/cli.js']);
    expect(result.forbiddenEntries).toContain('src/cheat.js');
  });

  it('checks a real VSIX artifact when available', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'ext-graph-vsix-'));
    cleanupRoots.push(root);
    const packagePath = path.join(root, 'java-impact-flow-0.1.2.vsix');
    mkdirSync(path.dirname(packagePath), { recursive: true });
    writeFileSync(packagePath, buildMiniZip({
      '[Content_Types].xml': '<xml/>',
      'extension.vsixmanifest': '<PackageManifest/>',
      'extension/package.json': '{}',
      'extension/assets/icon.png': 'binary',
      'extension/readme.md': 'README',
      'extension/dist/cli.js': 'console.log(1)',
      'extension/dist/extension.js': 'console.log(2)',
    }), 'utf8');

    const result = runVsixSmokeCheckFromPath(packagePath, [
      '[Content_Types].xml',
      'extension.vsixmanifest',
      'extension/package.json',
      'extension/assets/icon.png',
      'extension/readme.md',
      'extension/dist/cli.js',
      'extension/dist/extension.js',
    ]);

    expect(result.ok).toBe(true);
  });

  it('fails when package size exceeds configured maximum', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'ext-graph-vsix-size-'));
    cleanupRoots.push(root);
    const packagePath = path.join(root, 'java-impact-flow-0.1.2.vsix');
    mkdirSync(path.dirname(packagePath), { recursive: true });
    writeFileSync(packagePath, buildMiniZip({
      '[Content_Types].xml': '<xml/>',
      'extension.vsixmanifest': '<PackageManifest/>',
      'extension/package.json': '{}',
      'extension/assets/icon.png': 'binary',
      'extension/readme.md': 'README',
      'extension/dist/cli.js': 'console.log(1)',
      'extension/dist/extension.js': 'console.log(2)',
    }), 'utf8');

    const result = runVsixSmokeCheckFromPath(packagePath, [
      '[Content_Types].xml',
      'extension.vsixmanifest',
      'extension/package.json',
      'extension/assets/icon.png',
      'extension/readme.md',
      'extension/dist/cli.js',
      'extension/dist/extension.js',
    ], [
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
    ], 1);

    expect(result.ok).toBe(false);
    expect(result.maxPackageSizeBytes).toBe(1);
    expect(result.packageSizeBytes).toBeGreaterThan(1);
  });

  it('fails when package entry count exceeds configured maximum', () => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'ext-graph-vsix-entries-'));
    cleanupRoots.push(root);
    const packagePath = path.join(root, 'java-impact-flow-0.1.2.vsix');
    mkdirSync(path.dirname(packagePath), { recursive: true });
    writeFileSync(packagePath, buildMiniZip({
      '[Content_Types].xml': '<xml/>',
      'extension.vsixmanifest': '<PackageManifest/>',
      'extension/package.json': '{}',
      'extension/assets/icon.png': 'binary',
      'extension/readme.md': 'README',
      'extension/dist/cli.js': 'console.log(1)',
      'extension/dist/extension.js': 'console.log(2)',
      'extension/assets/extra1.txt': 'a',
      'extension/assets/extra2.txt': 'a',
    }), 'utf8');

    const result = runVsixSmokeCheckFromPath(packagePath, [
      '[Content_Types].xml',
      'extension.vsixmanifest',
      'extension/package.json',
      'extension/assets/icon.png',
      'extension/readme.md',
      'extension/dist/cli.js',
      'extension/dist/extension.js',
    ], [
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
    ], 20000000, 6);

    expect(result.ok).toBe(false);
    expect(result.maxPackageEntries).toBe(6);
    expect(result.totalEntries).toBe(9);
  });

  it('parses CLI options for smoke checks', () => {
    const manifestRoot = mkdtempSync(path.join(os.tmpdir(), 'ext-graph-vsix-cli-'));
    cleanupRoots.push(manifestRoot);
    const manifestPath = path.join(manifestRoot, 'package.json');
    writeFileSync(manifestPath, JSON.stringify({
      name: 'java-impact-flow',
      publisher: 'vndkubi',
      version: '0.1.2',
    }), 'utf-8');
    const packagePath = path.join(manifestRoot, 'java-impact-flow-0.1.2.vsix');
    writeFileSync(packagePath, buildMiniZip({
      '[Content_Types].xml': '<xml/>',
      'extension.vsixmanifest': '<PackageManifest/>',
      'extension/package.json': '{}',
      'extension/assets/icon.png': 'binary',
      'extension/readme.md': 'README',
      'extension/dist/cli.js': 'console.log(1)',
      'extension/dist/extension.js': 'console.log(2)',
    }), 'utf8');

    const result = runVsixSmokeCheckFromCli(['--manifest', manifestPath, '--json']);
    expect(result.ok).toBe(true);
    expect(result.packagePath).toBe(packagePath);
    expect(result.totalEntries).toBe(7);
  });

  it('accepts a custom max size from CLI', () => {
    const manifestRoot = mkdtempSync(path.join(os.tmpdir(), 'ext-graph-vsix-size-cli-'));
    cleanupRoots.push(manifestRoot);
    const manifestPath = path.join(manifestRoot, 'package.json');
    writeFileSync(manifestPath, JSON.stringify({
      name: 'java-impact-flow',
      publisher: 'vndkubi',
      version: '0.1.2',
    }), 'utf-8');
    const packagePath = path.join(manifestRoot, 'java-impact-flow-0.1.2.vsix');
    writeFileSync(packagePath, buildMiniZip({
      '[Content_Types].xml': '<xml/>',
      'extension.vsixmanifest': '<PackageManifest/>',
      'extension/package.json': '{}',
      'extension/assets/icon.png': 'binary',
      'extension/readme.md': 'README',
      'extension/dist/cli.js': 'console.log(1)',
      'extension/dist/extension.js': 'console.log(2)',
    }), 'utf8');

    const packageSizeBytes = fs.statSync(packagePath).size;
    const result = runVsixSmokeCheckFromCli([
      '--manifest',
      manifestPath,
      '--json',
      '--max-size',
      `${packageSizeBytes}`,
    ]);

    expect(result.ok).toBe(true);
    expect(result.maxPackageSizeBytes).toBe(packageSizeBytes);
  });

  it('accepts a custom max entries from CLI', () => {
    const manifestRoot = mkdtempSync(path.join(os.tmpdir(), 'ext-graph-vsix-entries-cli-'));
    cleanupRoots.push(manifestRoot);
    const manifestPath = path.join(manifestRoot, 'package.json');
    writeFileSync(manifestPath, JSON.stringify({
      name: 'java-impact-flow',
      publisher: 'vndkubi',
      version: '0.1.2',
    }), 'utf-8');
    const packagePath = path.join(manifestRoot, 'java-impact-flow-0.1.2.vsix');
    writeFileSync(packagePath, buildMiniZip({
      '[Content_Types].xml': '<xml/>',
      'extension.vsixmanifest': '<PackageManifest/>',
      'extension/package.json': '{}',
      'extension/assets/icon.png': 'binary',
      'extension/readme.md': 'README',
      'extension/dist/cli.js': 'console.log(1)',
      'extension/dist/extension.js': 'console.log(2)',
      'extension/assets/extra1.txt': 'a',
      'extension/assets/extra2.txt': 'a',
    }), 'utf8');

    const result = runVsixSmokeCheckFromCli([
      '--manifest',
      manifestPath,
      '--json',
      '--max-entries',
      '8',
    ]);

    expect(result.ok).toBe(false);
    expect(result.maxPackageEntries).toBe(8);
    expect(result.totalEntries).toBe(9);
  });

  it('throws when VSIX_SMOKE_MAX_ENTRIES env is invalid', () => {
    const manifestRoot = mkdtempSync(path.join(os.tmpdir(), 'ext-graph-vsix-bad-entries-env-'));
    cleanupRoots.push(manifestRoot);
    const manifestPath = path.join(manifestRoot, 'package.json');
    writeFileSync(manifestPath, JSON.stringify({
      name: 'java-impact-flow',
      publisher: 'vndkubi',
      version: '0.1.2',
    }), 'utf-8');
    const packagePath = path.join(manifestRoot, 'java-impact-flow-0.1.2.vsix');
    writeFileSync(packagePath, buildMiniZip({
      '[Content_Types].xml': '<xml/>',
      'extension.vsixmanifest': '<PackageManifest/>',
      'extension/package.json': '{}',
      'extension/assets/icon.png': 'binary',
      'extension/readme.md': 'README',
      'extension/dist/cli.js': 'console.log(1)',
      'extension/dist/extension.js': 'console.log(2)',
    }), 'utf8');

    const prevEnv = process.env.VSIX_SMOKE_MAX_ENTRIES;
    process.env.VSIX_SMOKE_MAX_ENTRIES = 'bad';
    try {
      expect(() => runVsixSmokeCheckFromCli([
        '--manifest',
        manifestPath,
      ])).toThrow('Invalid VSIX_SMOKE_MAX_ENTRIES');
    } finally {
      if (prevEnv === undefined) {
        delete process.env.VSIX_SMOKE_MAX_ENTRIES;
      } else {
        process.env.VSIX_SMOKE_MAX_ENTRIES = prevEnv;
      }
    }
  });

  it('throws when VSIX_SMOKE_MAX_SIZE_BYTES env is invalid', () => {
    const manifestRoot = mkdtempSync(path.join(os.tmpdir(), 'ext-graph-vsix-bad-env-'));
    cleanupRoots.push(manifestRoot);
    const manifestPath = path.join(manifestRoot, 'package.json');
    writeFileSync(manifestPath, JSON.stringify({
      name: 'java-impact-flow',
      publisher: 'vndkubi',
      version: '0.1.2',
    }), 'utf-8');
    const packagePath = path.join(manifestRoot, 'java-impact-flow-0.1.2.vsix');
    writeFileSync(packagePath, buildMiniZip({
      '[Content_Types].xml': '<xml/>',
      'extension.vsixmanifest': '<PackageManifest/>',
      'extension/package.json': '{}',
      'extension/assets/icon.png': 'binary',
      'extension/readme.md': 'README',
      'extension/dist/cli.js': 'console.log(1)',
      'extension/dist/extension.js': 'console.log(2)',
    }), 'utf8');

    const prevEnv = process.env.VSIX_SMOKE_MAX_SIZE_BYTES;
    process.env.VSIX_SMOKE_MAX_SIZE_BYTES = 'bad';
    try {
      expect(() => runVsixSmokeCheckFromCli([
        '--manifest',
        manifestPath,
      ])).toThrow('Invalid VSIX_SMOKE_MAX_SIZE_BYTES');
    } finally {
      if (prevEnv === undefined) {
        delete process.env.VSIX_SMOKE_MAX_SIZE_BYTES;
      } else {
        process.env.VSIX_SMOKE_MAX_SIZE_BYTES = prevEnv;
      }
    }
  });

  it('writes a JSON smoke report to the specified path', () => {
    const manifestRoot = mkdtempSync(path.join(os.tmpdir(), 'ext-graph-vsix-report-'));
    cleanupRoots.push(manifestRoot);
    const manifestPath = path.join(manifestRoot, 'package.json');
    writeFileSync(manifestPath, JSON.stringify({
      name: 'java-impact-flow',
      publisher: 'vndkubi',
      version: '0.1.2',
    }), 'utf-8');
    const packagePath = path.join(manifestRoot, 'java-impact-flow-0.1.2.vsix');
    writeFileSync(packagePath, buildMiniZip({
      '[Content_Types].xml': '<xml/>',
      'extension.vsixmanifest': '<PackageManifest/>',
      'extension/package.json': '{}',
      'extension/assets/icon.png': 'binary',
      'extension/readme.md': 'README',
      'extension/dist/cli.js': 'console.log(1)',
      'extension/dist/extension.js': 'console.log(2)',
    }), 'utf8');
    const reportPath = path.join(manifestRoot, 'artifacts', 'vsix-smoke.json');

    const result = runVsixSmokeCheckFromCli([
      '--manifest',
      manifestPath,
      '--json',
      '--report',
      reportPath,
    ]);

    expect(result.ok).toBe(true);
    expect(fs.existsSync(reportPath)).toBe(true);
    const raw = fs.readFileSync(reportPath, 'utf-8');
    const report = JSON.parse(raw) as {
      ok?: boolean;
      packagePath?: string;
    };
    expect(report.ok).toBe(true);
    expect(report.packagePath).toBe(packagePath);
  });

  it('writes a JSON smoke report from env fallback', () => {
    const prevReportEnv = process.env.VSIX_SMOKE_REPORT;
    const manifestRoot = mkdtempSync(path.join(os.tmpdir(), 'ext-graph-vsix-report-env-'));
    cleanupRoots.push(manifestRoot);
    const manifestPath = path.join(manifestRoot, 'package.json');
    writeFileSync(manifestPath, JSON.stringify({
      name: 'java-impact-flow',
      publisher: 'vndkubi',
      version: '0.1.2',
    }), 'utf-8');
    const packagePath = path.join(manifestRoot, 'java-impact-flow-0.1.2.vsix');
    writeFileSync(packagePath, buildMiniZip({
      '[Content_Types].xml': '<xml/>',
      'extension.vsixmanifest': '<PackageManifest/>',
      'extension/package.json': '{}',
      'extension/assets/icon.png': 'binary',
      'extension/readme.md': 'README',
      'extension/dist/cli.js': 'console.log(1)',
      'extension/dist/extension.js': 'console.log(2)',
    }), 'utf8');
    const reportPath = path.join(manifestRoot, 'artifacts', 'vsix-smoke-env.json');

    process.env.VSIX_SMOKE_REPORT = reportPath;
    try {
      const result = runVsixSmokeCheckFromCli([
        '--manifest',
        manifestPath,
        '--json',
      ]);

      expect(result.ok).toBe(true);
      expect(fs.existsSync(reportPath)).toBe(true);
      const raw = fs.readFileSync(reportPath, 'utf-8');
      const report = JSON.parse(raw) as {
        ok?: boolean;
        packagePath?: string;
      };
      expect(report.ok).toBe(true);
      expect(report.packagePath).toBe(packagePath);
    } finally {
      if (prevReportEnv === undefined) {
        delete process.env.VSIX_SMOKE_REPORT;
      } else {
        process.env.VSIX_SMOKE_REPORT = prevReportEnv;
      }
    }
  });

  it('rejects unknown CLI options in smoke check', () => {
    expect(() => runVsixSmokeCheckFromCli(['--bogus'])).toThrow('Unknown option: --bogus');
  });
});
