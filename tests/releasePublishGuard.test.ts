import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  parseReleaseGuardArgs,
  parseVsceShowVersions,
  resolveVsixPath,
  runReleasePublishGuard,
  runReleasePublishGuardFromCli,
  parseReleaseManifest,
  formatReleaseGuardUsage,
  type MarketplaceVersionStatus,
} from '../src/releasePublishGuard.js';

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

const FIXTURE_MARKETPLACE_RESPONSE = JSON.stringify({
  versions: [{ version: '0.1.2' }, { version: '0.1.1' }],
});

describe('release publish guard', () => {
  const cleanupPaths: string[] = [];

  afterEach(() => {
    for (const cleanupPath of cleanupPaths) {
      if (fs.existsSync(cleanupPath)) {
        fs.rmSync(cleanupPath, { recursive: true, force: true });
      }
    }
    cleanupPaths.length = 0;
  });

  function fixtureRoot(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-graph-release-'));
    cleanupPaths.push(root);
    return root;
  }

  function writeManifest(root: string, overrides: Record<string, string> = {}): string {
    const manifestPath = path.join(root, 'package.json');
    const manifest = {
      name: 'java-impact-flow',
      publisher: 'vndkubi',
      version: '0.1.2',
      ...overrides,
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest), 'utf-8');
    return manifestPath;
  }

  it('reads CLI arguments', () => {
    const args = parseReleaseGuardArgs([
      '--manifest',
      'pkg/package.json',
      '--packagePath',
      'out/package.vsix',
      '--allow-existing',
      '--skip-marketplace-check',
      '--smoke',
      '--smoke-max-size',
      '2048',
      '--smoke-max-entries',
      '90',
      '--smoke-report',
      'artifacts/smoke.json',
      '--expected-package-hash',
      'abc123',
      '--contract',
      'artifacts/contract.json',
      '--dry-run',
      '--publish',
      '--skip-duplicate',
      '--json',
    ]);

    expect(args.manifestPath).toBe('pkg/package.json');
    expect(args.packagePath).toBe('out/package.vsix');
    expect(args.allowExistingVersion).toBe(true);
    expect(args.skipMarketplaceCheck).toBe(true);
    expect(args.skipSmokeCheck).toBe(false);
    expect(args.smokeMaxPackageSizeBytes).toBe(2048);
    expect(args.smokeMaxPackageEntries).toBe(90);
    expect(args.smokeReportPath).toBe('artifacts/smoke.json');
    expect(args.expectedPackageHash).toBe('abc123');
    expect(args.contractPath).toBe('artifacts/contract.json');
    expect(args.dryRun).toBe(true);
    expect(args.publish).toBe(true);
    expect(args.skipDuplicate).toBe(true);
    expect(args.json).toBe(true);
  });

  it('rejects unknown CLI arguments', () => {
    expect(() => parseReleaseGuardArgs(['--manifest', 'pkg/package.json', '--bogus'])).toThrow('Unknown option: --bogus');
  });

  it('rejects invalid smoke CLI arguments', () => {
    expect(() =>
      parseReleaseGuardArgs(['--smoke', '--smoke-max-size']),
    ).toThrow('Missing value for --smoke-max-size.');
    expect(() =>
      parseReleaseGuardArgs(['--smoke', '--smoke-max-entries', 'not-a-number']),
    ).toThrow('must be a positive integer.');
    expect(() =>
      parseReleaseGuardArgs(['--smoke', '--smoke-max-size', '0']),
    ).toThrow('must be a positive integer.');
  });

  it('parses vsce show JSON output into versions', () => {
    expect(parseVsceShowVersions(FIXTURE_MARKETPLACE_RESPONSE)).toEqual(['0.1.2', '0.1.1']);
    expect(parseVsceShowVersions('{"versions":[{"version":"1.0.0"}]}')).toEqual(['1.0.0']);
  });

  it('resolves manifest and package path defaults', () => {
    const manifestPath = writeManifest(fixtureRoot());
    const manifest = parseReleaseManifest(manifestPath);
    const packagePath = resolveVsixPath(manifest, manifestPath);
    expect(path.basename(packagePath)).toBe('java-impact-flow-0.1.2.vsix');
  });

  it('throws when manifest missing required fields', () => {
    const root = fixtureRoot();
    const manifestPath = path.join(root, 'package.json');
    fs.writeFileSync(manifestPath, JSON.stringify({ name: 'java-impact-flow' }), 'utf-8');

    expect(() => parseReleaseManifest(manifestPath)).toThrow('missing string "publisher"');
  });

  it('throws when package file does not exist', () => {
    const manifestPath = writeManifest(fixtureRoot());
    expect(() =>
      runReleasePublishGuard({
        manifestPath,
      }),
    ).toThrow('Missing extension package');
  });

  it('blocks publish when marketplace already has the target version', () => {
    const root = fixtureRoot();
    const manifestPath = writeManifest(root);
    fs.writeFileSync(path.join(root, 'java-impact-flow-0.1.2.vsix'), 'vsix', 'utf-8');

    expect(() =>
      runReleasePublishGuard({
        manifestPath,
        commandRunner: () => FIXTURE_MARKETPLACE_RESPONSE,
      }),
    ).toThrow(/already exists for vndkubi\.java-impact-flow/);
  });

  it('reports not-published when marketplace is missing the version', () => {
    const root = fixtureRoot();
    const manifestPath = writeManifest(root);
    fs.writeFileSync(path.join(root, 'java-impact-flow-0.1.2.vsix'), 'vsix', 'utf-8');

    const result = runReleasePublishGuard({
      manifestPath,
      commandRunner: () => JSON.stringify({ versions: [{ version: '0.1.0' }] }),
    });

    expect(result.marketplaceStatus).toBe('not_published' as MarketplaceVersionStatus);
    expect(result.alreadyPublished).toBe(false);
  });

  it('allows existing version only with --allow-existing', () => {
    const root = fixtureRoot();
    const manifestPath = writeManifest(root);
    const packagePath = path.join(root, 'java-impact-flow-0.1.2.vsix');
    fs.writeFileSync(packagePath, 'vsix', 'utf-8');

    const publishRunner = vi.fn(() => 0);
    expect(() =>
      runReleasePublishGuard({
        manifestPath,
        allowExistingVersion: true,
        commandRunner: () => FIXTURE_MARKETPLACE_RESPONSE,
        publish: true,
        publishRunner,
      }),
    ).not.toThrow();

    expect(publishRunner).toHaveBeenCalledWith(
      'npx.cmd',
      expect.arrayContaining([
        '--yes',
        '@vscode/vsce',
        'publish',
        '--packagePath',
        packagePath,
      ]),
    );
  });

  it('skips marketplace check when requested', () => {
    const root = fixtureRoot();
    const manifestPath = writeManifest(root);
    fs.writeFileSync(path.join(root, 'java-impact-flow-0.1.2.vsix'), 'vsix', 'utf-8');

    const commandRunner = vi.fn(() => {
      throw new Error('should not run');
    });
    expect(() =>
      runReleasePublishGuard({
        manifestPath,
        skipMarketplaceCheck: true,
        commandRunner,
      }),
    ).not.toThrow();
    expect(commandRunner).not.toHaveBeenCalled();
    const result = runReleasePublishGuard({
      manifestPath,
      skipMarketplaceCheck: true,
      commandRunner: () => {
        throw new Error('should not run');
      },
    });
    expect(result.marketplaceStatus).toBe('not_checked' as MarketplaceVersionStatus);
    expect(result.alreadyPublished).toBe(false);
  });

  it('runs smoke check when --smoke is requested', () => {
    const root = fixtureRoot();
    const manifestPath = writeManifest(root);
    const packagePath = path.join(root, 'java-impact-flow-0.1.2.vsix');
    fs.writeFileSync(packagePath, buildMiniZip({
      '[Content_Types].xml': '<xml/>',
      'extension.vsixmanifest': '<PackageManifest/>',
      'extension/package.json': '{}',
      'extension/assets/icon.png': 'binary',
      'extension/readme.md': 'README',
      'extension/dist/cli.js': 'console.log(1)',
      'extension/dist/extension.js': 'console.log(2)',
    }), 'utf8');

    const result = runReleasePublishGuard({
      manifestPath,
      skipMarketplaceCheck: true,
      skipSmokeCheck: false,
      smokeReportPath: path.join(root, 'artifacts', 'smoke.json'),
    });

    expect(result.smokeCheck).toBeDefined();
    expect(result.smokeCheck?.ok).toBe(true);
    expect(result.smokeCheck?.totalEntries).toBe(7);
    expect(result.smokeCheck?.maxPackageEntries).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(root, 'artifacts', 'smoke.json'))).toBe(true);
  });

  it('blocks publish check when smoke check fails', () => {
    const root = fixtureRoot();
    const manifestPath = writeManifest(root);
    const packagePath = path.join(root, 'java-impact-flow-0.1.2.vsix');
    fs.writeFileSync(packagePath, buildMiniZip({
      '[Content_Types].xml': '<xml/>',
      'extension.vsixmanifest': '<PackageManifest/>',
      'extension/package.json': '{}',
      'extension/assets/icon.png': 'binary',
      'extension/readme.md': 'README',
      'extension/dist/cli.js': 'console.log(1)',
      'extension/dist/extension.js': 'console.log(2)',
      'extension/assets/extra.txt': 'too many',
    }), 'utf8');

    expect(() =>
      runReleasePublishGuard({
        manifestPath,
        skipMarketplaceCheck: true,
        skipSmokeCheck: false,
        smokeMaxPackageEntries: 3,
      }),
    ).toThrow(/VSIX smoke check failed for/);
  });

  it('validates expected package hash in non-publish check', () => {
    const root = fixtureRoot();
    const manifestPath = writeManifest(root);
    const packagePath = path.join(root, 'java-impact-flow-0.1.2.vsix');
    const packageContent = 'hash-sensitive package';
    fs.writeFileSync(packagePath, packageContent, 'utf-8');
    const actualHash = createHash('sha256').update(packageContent).digest('hex');

    expect(() =>
      runReleasePublishGuard({
        manifestPath,
        skipMarketplaceCheck: true,
        expectedPackageHash: actualHash,
      }),
    ).not.toThrow();

    expect(() =>
      runReleasePublishGuard({
        manifestPath,
        skipMarketplaceCheck: true,
        expectedPackageHash: 'wrong-hash',
      }),
    ).toThrow('Package hash mismatch');
  });

  it('passes CLI JSON output when smoke check is enabled', () => {
    const prevExitCode = process.exitCode;
    const manifestPath = writeManifest(fixtureRoot());
    const packagePath = path.join(path.dirname(manifestPath), 'java-impact-flow-0.1.2.vsix');
    fs.writeFileSync(packagePath, buildMiniZip({
      '[Content_Types].xml': '<xml/>',
      'extension.vsixmanifest': '<PackageManifest/>',
      'extension/package.json': '{}',
      'extension/assets/icon.png': 'binary',
      'extension/readme.md': 'README',
      'extension/dist/cli.js': 'console.log(1)',
      'extension/dist/extension.js': 'console.log(2)',
    }), 'utf8');
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((value?: unknown) => {
      logs.push(String(value));
    });
    process.exitCode = undefined;

    try {
      runReleasePublishGuardFromCli([
        `--manifest`,
        manifestPath,
        `--skip-marketplace-check`,
        `--smoke`,
        `--json`,
      ]);

      expect(logs).toHaveLength(1);
      const output = JSON.parse(logs[0] ?? '{}') as {
        ok?: boolean;
        smokeCheck?: { ok?: boolean };
      };
      expect(output.ok).toBe(true);
      expect(output.smokeCheck).toBeDefined();
      expect(output.smokeCheck?.ok).toBe(true);
      expect(process.exitCode).toBeUndefined();
    } finally {
      spy.mockRestore();
      process.exitCode = prevExitCode;
    }
  });

  it('writes JSON contract file on success', () => {
    const prevExitCode = process.exitCode;
    const root = fixtureRoot();
    const manifestPath = writeManifest(root);
    const packagePath = path.join(path.dirname(manifestPath), 'java-impact-flow-0.1.2.vsix');
    fs.writeFileSync(packagePath, 'vsix', 'utf-8');
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((value?: unknown) => {
      logs.push(String(value));
    });
    const contractPath = path.join(root, 'artifacts', 'release-check.json');
    process.exitCode = undefined;

    try {
      runReleasePublishGuardFromCli([
        `--manifest`,
        manifestPath,
        `--skip-marketplace-check`,
        `--json`,
        `--contract`,
        contractPath,
      ]);

      expect(logs).toHaveLength(1);
      expect(fs.existsSync(contractPath)).toBe(true);
      const contractRaw = fs.readFileSync(contractPath, 'utf-8');
      const contract = JSON.parse(contractRaw) as { ok?: boolean; command?: string };
      expect(contract.ok).toBe(true);
      expect(contract.command).toBe('release:check');
    } finally {
      spy.mockRestore();
      process.exitCode = prevExitCode;
    }
  });

  it('writes JSON contract file on failure', () => {
    const prevExitCode = process.exitCode;
    const manifestPath = writeManifest(fixtureRoot());
    const contractPath = path.join(path.dirname(manifestPath), 'artifacts', 'release-check-fail.json');
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((value?: unknown) => {
      logs.push(String(value));
    });
    process.exitCode = undefined;

    try {
      runReleasePublishGuardFromCli([
        `--manifest`,
        manifestPath,
        `--json`,
        `--contract`,
        contractPath,
      ]);

      expect(logs).toHaveLength(1);
      expect(process.exitCode).toBe(1);
      expect(fs.existsSync(contractPath)).toBe(true);
      const contractRaw = fs.readFileSync(contractPath, 'utf-8');
      const contract = JSON.parse(contractRaw) as { ok?: boolean; error?: string };
      expect(contract.ok).toBe(false);
      expect(contract.error).toContain('Missing extension package');
    } finally {
      spy.mockRestore();
      process.exitCode = prevExitCode;
    }
  });

  it('emits help text', () => {
    expect(formatReleaseGuardUsage()).toContain('Usage:');
  });

  it('prints JSON when --json is passed', () => {
    const prevExitCode = process.exitCode;
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((value?: unknown) => {
      logs.push(String(value));
    });
    const manifestPath = writeManifest(fixtureRoot());
    fs.writeFileSync(path.join(path.dirname(manifestPath), 'java-impact-flow-0.1.2.vsix'), 'vsix', 'utf-8');
    process.exitCode = undefined;

    try {
      runReleasePublishGuardFromCli([
        `--manifest`,
        manifestPath,
        `--skip-marketplace-check`,
        `--json`,
      ]);

      expect(logs).toHaveLength(1);
      const output = JSON.parse(logs[0] ?? '{}') as {
        ok?: boolean;
        command?: string;
        manifest?: { name?: string; publisher?: string; version?: string };
        marketplaceStatus?: string;
        alreadyPublished?: boolean;
      };
      expect(output.ok).toBe(true);
      expect(output.command).toBe('release:check');
      expect(output.manifest).toMatchObject({ name: 'java-impact-flow', publisher: 'vndkubi', version: '0.1.2' });
      expect(output.marketplaceStatus).toBe('not_checked');
      expect(output.alreadyPublished).toBe(false);
      expect(output).toMatchObject({ published: false });
      expect(process.exitCode).toBeUndefined();
    } finally {
      spy.mockRestore();
      process.exitCode = prevExitCode;
    }
  });

  it('includes package hash in JSON output and contract', () => {
    const prevExitCode = process.exitCode;
    const manifestPath = writeManifest(fixtureRoot());
    const packagePath = path.join(path.dirname(manifestPath), 'java-impact-flow-0.1.2.vsix');
    const packageContent = 'vsix-package-content';
    fs.writeFileSync(packagePath, packageContent, 'utf-8');
    const expectedHash = createHash('sha256').update(packageContent).digest('hex');
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((value?: unknown) => {
      logs.push(String(value));
    });
    const contractPath = path.join(path.dirname(manifestPath), 'artifacts', 'release-check-hash.json');
    process.exitCode = undefined;

    try {
      runReleasePublishGuardFromCli([
        `--manifest`,
        manifestPath,
        `--skip-marketplace-check`,
        `--json`,
        `--contract`,
        contractPath,
      ]);

      expect(logs).toHaveLength(1);
      const output = JSON.parse(logs[0] ?? '{}') as {
        ok?: boolean;
        manifest?: { name?: string; publisher?: string; version?: string };
        packageHash?: string;
        expectedPackageHash?: string;
      };
      expect(output.ok).toBe(true);
      expect(output.packageHash).toBe(expectedHash);
      expect(output.expectedPackageHash).toBeUndefined();
      expect(fs.existsSync(contractPath)).toBe(true);
      const contract = JSON.parse(fs.readFileSync(contractPath, 'utf-8')) as {
        ok?: boolean;
        packageHash?: string;
        expectedPackageHash?: string;
      };
      expect(contract.ok).toBe(true);
      expect(contract.packageHash).toBe(expectedHash);
      expect(contract.expectedPackageHash).toBeUndefined();
      expect(process.exitCode).toBeUndefined();
    } finally {
      spy.mockRestore();
      process.exitCode = prevExitCode;
    }
  });

  it('includes expected hash in JSON payload when provided', () => {
    const prevExitCode = process.exitCode;
    const manifestPath = writeManifest(fixtureRoot());
    const packagePath = path.join(path.dirname(manifestPath), 'java-impact-flow-0.1.2.vsix');
    const packageContent = 'expected-hash-content';
    fs.writeFileSync(packagePath, packageContent, 'utf-8');
    const expectedHash = createHash('sha256').update(packageContent).digest('hex');
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((value?: unknown) => {
      logs.push(String(value));
    });
    process.exitCode = undefined;

    try {
      runReleasePublishGuardFromCli([
        `--manifest`,
        manifestPath,
        `--skip-marketplace-check`,
        `--json`,
        `--expected-package-hash`,
        expectedHash,
      ]);

      expect(logs).toHaveLength(1);
      const output = JSON.parse(logs[0] ?? '{}') as {
        ok?: boolean;
        packageHash?: string;
        expectedPackageHash?: string;
      };
      expect(output.ok).toBe(true);
      expect(output.packageHash).toBe(expectedHash);
      expect(output.expectedPackageHash).toBe(expectedHash);
      expect(process.exitCode).toBeUndefined();
    } finally {
      spy.mockRestore();
      process.exitCode = prevExitCode;
    }
  });

  it('prints JSON when --json fails', () => {
    const prevExitCode = process.exitCode;
    const root = fixtureRoot();
    const manifestPath = writeManifest(root);
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((value?: unknown) => {
      logs.push(String(value));
    });
    process.exitCode = undefined;

    try {
      runReleasePublishGuardFromCli([
        `--manifest`,
        manifestPath,
        `--json`,
      ]);

      expect(logs).toHaveLength(1);
      const output = JSON.parse(logs[0] ?? '{}') as {
        ok?: boolean;
        command?: string;
        error?: string;
      };
      expect(output.ok).toBe(false);
      expect(output.command).toBe('release:check');
      expect(output.error).toContain('Missing extension package');
      expect(process.exitCode).toBe(1);
    } finally {
      spy.mockRestore();
      process.exitCode = prevExitCode;
    }
  });

  it('prints JSON success for --publish', () => {
    const prevExitCode = process.exitCode;
    const manifestPath = writeManifest(fixtureRoot());
    const packagePath = path.join(path.dirname(manifestPath), 'java-impact-flow-0.1.2.vsix');
    fs.writeFileSync(packagePath, 'vsix', 'utf-8');
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((value?: unknown) => {
      logs.push(String(value));
    });
    const mockedPublishRunner = vi.fn(() => 0);
      process.exitCode = undefined;

    try {
      runReleasePublishGuardFromCli([
        `--manifest`,
        manifestPath,
        `--skip-marketplace-check`,
        `--json`,
        `--publish`,
        `--allow-existing`,
        `--skip-duplicate`,
      ], undefined, mockedPublishRunner);

      expect(logs).toHaveLength(1);
      const output = JSON.parse(logs[0] ?? '{}') as {
        ok?: boolean;
        command?: string;
        published?: boolean;
        manifest?: { name?: string; version?: string; publisher?: string };
      };
      expect(output.ok).toBe(true);
      expect(output.command).toBe('release:publish');
      expect(output.published).toBe(true);
      expect(output.manifest).toMatchObject({ name: 'java-impact-flow', publisher: 'vndkubi', version: '0.1.2' });
      expect(mockedPublishRunner).toHaveBeenCalledWith(
        'npx.cmd',
        expect.arrayContaining([
          '--yes',
          '@vscode/vsce',
          'publish',
          '--packagePath',
          packagePath,
          '--skip-duplicate',
        ]),
      );
      expect(process.exitCode).toBeUndefined();
    } finally {
      spy.mockRestore();
      process.exitCode = prevExitCode;
    }
  });

  it('prints JSON for --publish --dry-run without publishing', () => {
    const prevExitCode = process.exitCode;
    const manifestPath = writeManifest(fixtureRoot());
    fs.writeFileSync(path.join(path.dirname(manifestPath), 'java-impact-flow-0.1.2.vsix'), 'vsix', 'utf-8');
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((value?: unknown) => {
      logs.push(String(value));
    });
    const mockedPublishRunner = vi.fn(() => 0);
    process.exitCode = undefined;

    try {
      runReleasePublishGuardFromCli([
        `--manifest`,
        manifestPath,
        `--skip-marketplace-check`,
        `--json`,
        `--publish`,
        `--allow-existing`,
        `--skip-duplicate`,
        `--dry-run`,
      ], undefined, mockedPublishRunner);

      expect(logs).toHaveLength(1);
      const output = JSON.parse(logs[0] ?? '{}') as {
        ok?: boolean;
        command?: string;
        published?: boolean;
        wouldPublish?: boolean;
      };
      expect(output.ok).toBe(true);
      expect(output.command).toBe('release:publish');
      expect(output.published).toBe(false);
      expect(output.wouldPublish).toBe(true);
      expect(mockedPublishRunner).not.toHaveBeenCalled();
      expect(process.exitCode).toBeUndefined();
    } finally {
      spy.mockRestore();
      process.exitCode = prevExitCode;
    }
  });

  it('prints JSON failure when publish fails', () => {
    const prevExitCode = process.exitCode;
    const manifestPath = writeManifest(fixtureRoot());
    fs.writeFileSync(path.join(path.dirname(manifestPath), 'java-impact-flow-0.1.2.vsix'), 'vsix', 'utf-8');
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((value?: unknown) => {
      logs.push(String(value));
    });
    const mockedPublishRunner = vi.fn(() => 2);
    process.exitCode = undefined;

    try {
      runReleasePublishGuardFromCli([
        `--manifest`,
        manifestPath,
        `--skip-marketplace-check`,
        `--json`,
        `--publish`,
        `--allow-existing`,
        `--skip-duplicate`,
      ], undefined, mockedPublishRunner);

      expect(logs).toHaveLength(1);
      const output = JSON.parse(logs[0] ?? '{}') as {
        ok?: boolean;
        command?: string;
        error?: string;
      };
      expect(output.ok).toBe(false);
      expect(output.command).toBe('release:publish');
      expect(output.error).toContain('vsce publish failed with exit code 2');
      expect(process.exitCode).toBe(1);
      expect(mockedPublishRunner).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
      process.exitCode = prevExitCode;
    }
  });

});
