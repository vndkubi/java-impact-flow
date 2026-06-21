import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { runVsixSmokeCheckFromPath, type VsixSmokeResult } from './vsixSmokeTest.js';

interface ManifestShape {
  name?: unknown;
  publisher?: unknown;
  version?: unknown;
}

export type MarketplaceVersionStatus = 'published' | 'not_published' | 'not_checked';

export interface ReleaseManifest {
  name: string;
  publisher: string;
  version: string;
}

export interface ReleaseGuardResult {
  manifest: ReleaseManifest;
  packagePath: string;
  packageHash: string;
  alreadyPublished: boolean;
  marketplaceStatus: MarketplaceVersionStatus;
  publisher: string;
  smokeCheck?: {
    ok: boolean;
    packagePath: string;
    totalEntries: number;
    missingEntries: string[];
    forbiddenEntries: string[];
    topLevelEntries: string[];
    packageSizeBytes: number;
    maxPackageSizeBytes: number;
    maxPackageEntries: number;
  };
}

export interface ReleaseGuardOptions {
  manifestPath?: string;
  packagePath?: string;
  allowExistingVersion?: boolean;
  skipMarketplaceCheck?: boolean;
  publish?: boolean;
  skipDuplicate?: boolean;
  dryRun?: boolean;
  json?: boolean;
  skipSmokeCheck?: boolean;
  smokeMaxPackageSizeBytes?: number;
  smokeMaxPackageEntries?: number;
  smokeReportPath?: string;
  expectedPackageHash?: string;
  contractPath?: string;
  commandRunner?: (command: string, args: string[]) => string;
  publishRunner?: (command: string, args: string[]) => number;
  help?: boolean;
}

const DEFAULT_MANIFEST_PATH = 'package.json';
const VSCE_PACKAGE_JSON_FLAG = '--json';

export function parseReleaseManifest(manifestPath: string = DEFAULT_MANIFEST_PATH): ReleaseManifest {
  const absoluteManifestPath = path.resolve(manifestPath);
  const rawManifest = fs.readFileSync(absoluteManifestPath, 'utf-8');
  const parsed = JSON.parse(rawManifest) as ManifestShape;
  const name = parsed?.name;
  const publisher = parsed?.publisher;
  const version = parsed?.version;

  if (typeof name !== 'string' || !name.trim()) {
    throw new Error(`Invalid package manifest at ${absoluteManifestPath}: missing string "name".`);
  }
  if (typeof publisher !== 'string' || !publisher.trim()) {
    throw new Error(`Invalid package manifest at ${absoluteManifestPath}: missing string "publisher".`);
  }
  if (typeof version !== 'string' || !version.trim()) {
    throw new Error(`Invalid package manifest at ${absoluteManifestPath}: missing string "version".`);
  }

  return {
    name: name.trim(),
    publisher: publisher.trim(),
    version: version.trim(),
  };
}

export function resolveVsixPath(manifest: Pick<ReleaseManifest, 'name' | 'version'>, manifestPath: string, customPath?: string): string {
  const packageBaseDir = path.dirname(path.resolve(manifestPath));
  const defaultFileName = `${manifest.name}-${manifest.version}.vsix`;
  const relativePath = customPath ?? defaultFileName;
  return path.resolve(packageBaseDir, relativePath);
}

export function parseVsceShowVersions(raw: string): string[] {
  const parsed = JSON.parse(raw) as { versions?: Array<{ version?: unknown }> };
  const versions = parsed.versions;
  if (!Array.isArray(versions)) return [];
  return versions
    .map((entry) => (typeof entry?.version === 'string' ? entry.version.trim() : ''))
    .filter((version): version is string => Boolean(version));
}

export function queryPublishedVersions(
  publisher: string,
  extensionName: string,
  commandRunner: (command: string, args: string[]) => string = defaultCommandRunner,
): string[] {
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const extensionId = `${publisher}.${extensionName}`;
  const raw = commandRunner(command, ['--yes', '@vscode/vsce', 'show', extensionId, VSCE_PACKAGE_JSON_FLAG]);
  return parseVsceShowVersions(raw);
}

export function runReleasePublishGuard(options: ReleaseGuardOptions = {}): ReleaseGuardResult {
  const manifestPath = options.manifestPath ?? DEFAULT_MANIFEST_PATH;
  const manifest = parseReleaseManifest(manifestPath);
  const packagePath = resolveVsixPath(manifest, manifestPath, options.packagePath);

  if (!fs.existsSync(packagePath)) {
    throw new Error(`Missing extension package at ${packagePath}. Run npm run release:verify first.`);
  }

  const smokeCheck = performSmokeCheckIfEnabled(packagePath, {
    skipSmokeCheck: options.skipSmokeCheck,
    smokeMaxPackageSizeBytes: options.smokeMaxPackageSizeBytes,
    smokeMaxPackageEntries: options.smokeMaxPackageEntries,
    smokeReportPath: options.smokeReportPath,
  });
  const packageHash = calculatePackageHash(packagePath);
  if (options.expectedPackageHash !== undefined && options.expectedPackageHash !== packageHash) {
    throw new Error(`Package hash mismatch: expected ${options.expectedPackageHash}, got ${packageHash}`);
  }
  if (smokeCheck && !smokeCheck.ok) {
    throw new Error(buildSmokeFailureMessage(smokeCheck));
  }

  const commandRunner = options.commandRunner ?? defaultCommandRunner;
  const marketplaceStatus: MarketplaceVersionStatus = options.skipMarketplaceCheck
    ? 'not_checked'
    : queryPublishedVersions(manifest.publisher, manifest.name, commandRunner).includes(manifest.version)
      ? 'published'
      : 'not_published';
  const alreadyPublished = marketplaceStatus === 'published';

  if (alreadyPublished && !options.allowExistingVersion) {
    throw new Error(
      `Version ${manifest.version} already exists for ${manifest.publisher}.${manifest.name} in Marketplace. `
      + 'Use --allow-existing to intentionally republish or bump package.version first.',
    );
  }

  if (options.publish && options.dryRun !== true) {
    const publishRunner = options.publishRunner ?? defaultPublishRunner;
    const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const publishArgs = [
      '--yes',
      '@vscode/vsce',
      'publish',
      '--packagePath',
      packagePath,
      ...(options.skipDuplicate ? ['--skip-duplicate'] : []),
    ];
    const status = publishRunner(command, publishArgs);
    if (status !== 0) {
      throw new Error(`vsce publish failed with exit code ${status} for ${packagePath}.`);
    }
  }

  return {
    manifest,
    packagePath,
    packageHash,
    alreadyPublished,
    marketplaceStatus,
    publisher: manifest.publisher,
    smokeCheck: smokeCheck
      ? {
          ok: smokeCheck.ok,
          packagePath: smokeCheck.packagePath,
          totalEntries: smokeCheck.totalEntries,
          missingEntries: smokeCheck.missingEntries,
          forbiddenEntries: smokeCheck.forbiddenEntries,
          topLevelEntries: smokeCheck.topLevelEntries,
          packageSizeBytes: smokeCheck.packageSizeBytes,
          maxPackageSizeBytes: smokeCheck.maxPackageSizeBytes,
          maxPackageEntries: smokeCheck.maxPackageEntries,
        }
      : undefined,
  };
}

export function parseReleaseGuardArgs(argv: string[]): ReleaseGuardOptions & { manifestPath: string; help?: true } {
  const options: ReleaseGuardOptions & { manifestPath: string; help?: true } = {
    manifestPath: DEFAULT_MANIFEST_PATH,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }

    if (arg === '--manifest') {
      const manifestPath = argv[i + 1];
      if (!manifestPath || manifestPath.startsWith('--')) {
        throw new Error('Missing value for --manifest.');
      }
      options.manifestPath = manifestPath;
      i += 1;
      continue;
    }

    if (arg === '--packagePath') {
      const packagePath = argv[i + 1];
      if (!packagePath || packagePath.startsWith('--')) {
        throw new Error('Missing value for --packagePath.');
      }
      options.packagePath = packagePath;
      i += 1;
      continue;
    }

    if (arg === '--allow-existing') {
      options.allowExistingVersion = true;
      continue;
    }

    if (arg === '--skip-marketplace-check') {
      options.skipMarketplaceCheck = true;
      continue;
    }

    if (arg === '--publish') {
      options.publish = true;
      continue;
    }

    if (arg === '--skip-duplicate') {
      options.skipDuplicate = true;
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--json') {
      options.json = true;
      continue;
    }

    if (arg === '--smoke') {
      options.skipSmokeCheck = false;
      continue;
    }

    if (arg === '--skip-smoke-check') {
      options.skipSmokeCheck = true;
      continue;
    }

    if (arg === '--smoke-max-size') {
      const smokeMaxSize = argv[i + 1];
      if (!smokeMaxSize || smokeMaxSize.startsWith('--')) {
        throw new Error('Missing value for --smoke-max-size.');
      }
      options.smokeMaxPackageSizeBytes = parsePositiveInteger(smokeMaxSize, '--smoke-max-size');
      i += 1;
      continue;
    }

    if (arg === '--smoke-max-entries') {
      const smokeMaxEntries = argv[i + 1];
      if (!smokeMaxEntries || smokeMaxEntries.startsWith('--')) {
        throw new Error('Missing value for --smoke-max-entries.');
      }
      options.smokeMaxPackageEntries = parsePositiveInteger(smokeMaxEntries, '--smoke-max-entries');
      i += 1;
      continue;
    }

    if (arg === '--smoke-report') {
      const smokeReportPath = argv[i + 1];
      if (!smokeReportPath || smokeReportPath.startsWith('--')) {
        throw new Error('Missing value for --smoke-report.');
      }
      options.smokeReportPath = smokeReportPath;
      i += 1;
      continue;
    }

    if (arg === '--expected-package-hash') {
      const expectedPackageHash = argv[i + 1];
      if (!expectedPackageHash || expectedPackageHash.startsWith('--')) {
        throw new Error('Missing value for --expected-package-hash.');
      }
      options.expectedPackageHash = expectedPackageHash;
      i += 1;
      continue;
    }

    if (arg === '--contract') {
      const contractPath = argv[i + 1];
      if (!contractPath || contractPath.startsWith('--')) {
        throw new Error('Missing value for --contract.');
      }
      options.contractPath = contractPath;
      i += 1;
      continue;
    }

    throw new Error(`Unknown option: ${arg}`);
  }

  return options;
}

export function formatReleaseGuardUsage(): string {
  return [
    'Usage:',
    '  node dist/releasePublishGuard.js [--manifest package.json] [--packagePath <name>-<version>.vsix]',
    '  node dist/releasePublishGuard.js --publish',
    '',
    'Options:',
    '  --manifest <file>            Package manifest path (default: package.json)',
    '  --packagePath <file>         Explicit VSIX path, default to <name>-<version>.vsix',
    '  --allow-existing             Allow publishing even if version already exists on Marketplace',
    '  --skip-marketplace-check     Skip Marketplace version lookup',
    '  --json                       Emit JSON result for automation',
    '  --publish                    Publish with npx vsce publish after checks',
    '  --skip-duplicate             Pass --skip-duplicate to vsce publish',
    '  --dry-run                    Validate publish readiness without running publish',
    '  --smoke                      Run VSIX smoke check',
    '  --skip-smoke-check           Skip VSIX smoke check',
    '  --smoke-max-size <bytes>     Override VSIX smoke size limit',
    '  --smoke-max-entries <count>  Override VSIX smoke entry limit',
    '  --smoke-report <file>        Write smoke result to file (defaults to VSIX_SMOKE_REPORT)',
    '  --expected-package-hash <hash> Require matching hash before pass/publish',
    '  --contract <file>            Write full release result JSON contract to file',
    '  --help, -h                   Show this help message',
  ].join('\n');
}

function defaultCommandRunner(command: string, args: string[]): string {
  const result = spawnSync(command, args, { encoding: 'utf8', shell: true });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}\n${result.stderr ?? ''}`);
  }
  return result.stdout ?? '';
}

function defaultPublishRunner(command: string, args: string[]): number {
  const result = spawnSync(command, args, { stdio: 'inherit', shell: true });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function calculatePackageHash(filePath: string): string {
  const packageBuffer = fs.readFileSync(filePath);
  return createHash('sha256').update(packageBuffer).digest('hex');
}

function performSmokeCheckIfEnabled(
  packagePath: string,
  options: {
    skipSmokeCheck?: boolean;
    smokeMaxPackageSizeBytes?: number;
    smokeMaxPackageEntries?: number;
    smokeReportPath?: string;
  },
): VsixSmokeResult | undefined {
  if (options.skipSmokeCheck !== false) return undefined;

  const maxPackageSizeBytes = resolveSmokeLimit(
    options.smokeMaxPackageSizeBytes,
    process.env.VSIX_SMOKE_MAX_SIZE_BYTES,
    'VSIX_SMOKE_MAX_SIZE_BYTES',
  );
  const maxPackageEntries = resolveSmokeLimit(
    options.smokeMaxPackageEntries,
    process.env.VSIX_SMOKE_MAX_ENTRIES,
    'VSIX_SMOKE_MAX_ENTRIES',
  );

  const result = runVsixSmokeCheckFromPath(
    packagePath,
    undefined,
    undefined,
    maxPackageSizeBytes,
    maxPackageEntries,
  );

  const reportPath = options.smokeReportPath ?? process.env.VSIX_SMOKE_REPORT;
  if (reportPath) {
    writeVsixSmokeCheckReport(result, path.resolve(reportPath));
  }

  return result;
}

function resolveSmokeLimit(
  explicit: number | undefined,
  envValue: string | undefined,
  envLabel: string,
): number | undefined {
  if (typeof explicit === 'number') return explicit;
  if (!envValue || !envValue.trim()) return undefined;
  const parsed = Number.parseInt(envValue, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${envLabel}: ${envValue}`);
  }
  return parsed;
}

function buildSmokeFailureMessage(result: VsixSmokeResult): string {
  const messages: string[] = [];
  if (result.packageSizeBytes > result.maxPackageSizeBytes) {
    messages.push(`size ${result.packageSizeBytes}/${result.maxPackageSizeBytes}`);
  }
  if (result.totalEntries > result.maxPackageEntries) {
    messages.push(`entries ${result.totalEntries}/${result.maxPackageEntries}`);
  }
  if (result.missingEntries.length > 0) {
    messages.push(`missing=[${result.missingEntries.join(', ')}]`);
  }
  if (result.forbiddenEntries.length > 0) {
    messages.push(`forbidden=[${result.forbiddenEntries.join(', ')}]`);
  }
  const suffix = messages.length > 0 ? ` (${messages.join('; ')})` : '';
  return `VSIX smoke check failed for ${result.packagePath}.${suffix}`;
}

function writeVsixSmokeCheckReport(result: VsixSmokeResult, reportPath: string): void {
  const outputDir = path.dirname(reportPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(reportPath, `${JSON.stringify(result)}\n`, 'utf-8');
}

function parsePositiveInteger(value: string, flag: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer.`);
  }
  return parsed;
}

function writeContract(payload: Record<string, unknown>, contractPath: string | undefined): void {
  if (!contractPath) return;
  const outputDir = path.dirname(contractPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  fs.writeFileSync(contractPath, `${JSON.stringify(payload)}\n`, 'utf-8');
}

export function runReleasePublishGuardFromCli(
  argv: string[] = process.argv.slice(2),
  commandRunner?: (command: string, args: string[]) => string,
  publishRunner?: (command: string, args: string[]) => number,
): void {
  const options = parseReleaseGuardArgs(argv);
  if (options.help) {
    console.log(formatReleaseGuardUsage());
    return;
  }

  if (options.skipSmokeCheck === undefined) {
    options.skipSmokeCheck = true;
  }

  const optionsWithRunners: ReleaseGuardOptions = {
    ...options,
    commandRunner,
    publishRunner,
  };

  const command = options.publish ? 'release:publish' : 'release:check';

  if (options.json) {
    try {
      const result = runReleasePublishGuard(optionsWithRunners);
      const payload = {
        ok: true,
        command,
        manifest: result.manifest,
        packagePath: result.packagePath,
        packageHash: result.packageHash,
        expectedPackageHash: options.expectedPackageHash,
        smokeCheck: result.smokeCheck,
        marketplaceStatus: result.marketplaceStatus,
        alreadyPublished: result.alreadyPublished,
        publisher: result.publisher,
        published: options.publish === true && options.dryRun !== true,
        wouldPublish: options.publish === true && options.dryRun === true,
      };
      writeContract(payload, options.contractPath);
      console.log(JSON.stringify(payload));
    } catch (error) {
      const payload = {
        ok: false,
        command,
        error: error instanceof Error ? error.message : String(error),
      };
      writeContract(payload, options.contractPath);
      console.log(JSON.stringify(payload));
      process.exitCode = 1;
    }
    return;
  }

  const result = runReleasePublishGuard(optionsWithRunners);
  const status = {
    published: 'ALREADY_PUBLISHED',
    not_published: 'NOT_PUBLISHED',
    not_checked: 'NOT_CHECKED',
  }[result.marketplaceStatus];

  console.log(`Release check passed for ${result.manifest.publisher}.${result.manifest.name}@${result.manifest.version}.`);
  console.log(`VSIX: ${result.packagePath}`);
  console.log(`Package hash: ${result.packageHash}`);
  if (result.smokeCheck) {
    console.log(
      `VSIX smoke: entries ${result.smokeCheck.totalEntries}/${result.smokeCheck.maxPackageEntries}, `
      + `size ${result.smokeCheck.packageSizeBytes}/${result.smokeCheck.maxPackageSizeBytes}.`,
    );
  }
  console.log(`Marketplace status: ${status}`);
  if (result.alreadyPublished && options.publish && !options.dryRun) {
    console.log('Published successfully with --allow-existing.');
    return;
  }
  if (options.publish && options.dryRun) {
    console.log('Dry run: publish was skipped (--dry-run).');
  }
}

if (process.argv[1]?.endsWith('releasePublishGuard.js')) {
  runReleasePublishGuardFromCli();
}
