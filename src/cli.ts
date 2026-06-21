#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { collectChangedJavaTargets } from './gitChanges.js';
import { buildImpactGraph, type ImpactMode } from './impactGraph.js';
import { runPerformanceBenchmark, type PerformanceThresholds } from './performance.js';
import { renderImpactGraphHtml } from './render.js';
import { buildPatchRiskReport, type PatchRiskReport } from './riskReport.js';
import { runValidationSuiteFile, validationMarkdown, type ValidationSuiteResult } from './validation.js';

type FailOn = 'never' | 'fail' | 'warn';

interface CommonArgs {
  root?: string;
  maxFiles?: number;
  maxFileBytes?: number;
  maxNodes?: number;
  maxEdges?: number;
  maxDepth?: number;
  includeTests?: boolean;
  help?: boolean;
}

interface ImpactCliArgs extends CommonArgs {
  target?: string;
  mode?: ImpactMode;
  out?: string;
  htmlOut?: string;
}

interface RiskCliArgs extends CommonArgs {
  out?: string;
  jsonOut?: string;
  maxTargets?: number;
  failOn?: FailOn;
}

interface ValidateCliArgs extends CommonArgs {
  suite?: string;
  out?: string;
  markdownOut?: string;
}

interface PerformanceCliArgs extends CommonArgs {
  target?: string;
  mode?: ImpactMode;
  out?: string;
  coldMs?: number;
  warmMs?: number;
  minTrustScore?: number;
  maxUnresolvedCalls?: number;
  minEndpoints?: number;
  minSuggestedTests?: number;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const command = argv[0];

  if (command === 'benchmark') {
    if (argv[1] === 'performance') {
      await runPerformanceCommand(parsePerformanceArgs(argv.slice(2)));
      return;
    }
    printBenchmarkHelp();
    if (argv.includes('--help') || argv.includes('-h')) return;
    throw new Error('Unknown benchmark command. Use: benchmark performance.');
  }
  if (command === 'risk') {
    await runRiskCommand(parseRiskArgs(argv.slice(1)));
    return;
  }
  if (command === 'validate') {
    await runValidateCommand(parseValidateArgs(argv.slice(1)));
    return;
  }

  await runImpactCommand(parseImpactArgs(argv));
}

async function runImpactCommand(args: ImpactCliArgs): Promise<void> {
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.root || !args.target) {
    printHelp();
    throw new Error('Both --root and --target are required.');
  }

  const graph = await buildImpactGraph({
    root: args.root,
    target: args.target,
    mode: args.mode,
    maxFiles: args.maxFiles,
    maxFileBytes: args.maxFileBytes,
    maxNodes: args.maxNodes,
    maxEdges: args.maxEdges,
    maxDepth: args.maxDepth,
    includeTests: args.includeTests,
  });

  const outputs: Record<string, string> = {};
  if (args.out) {
    outputs.json = writeJson(args.out, graph);
  }
  if (args.htmlOut) {
    outputs.html = writeText(args.htmlOut, renderImpactGraphHtml(graph));
  }

  console.log(JSON.stringify({
    command: 'impact',
    target: graph.metadata.target,
    root: graph.metadata.root,
    mode: graph.metadata.mode,
    analyzer: graph.metadata.analyzer,
    trust: graph.metadata.trust,
    summary: graph.summary,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    evidence: graph.evidence.length,
    warnings: graph.warnings,
    outputs,
  }, null, 2));
}

async function runRiskCommand(args: RiskCliArgs): Promise<void> {
  if (args.help) {
    printRiskHelp();
    return;
  }
  if (!args.root) {
    printRiskHelp();
    throw new Error('--root is required for risk.');
  }

  const root = path.resolve(args.root);
  const maxTargets = args.maxTargets ?? 12;
  const changedTargets = await collectChangedJavaTargets(root, { maxTargets });
  const outputs: Record<string, string> = {};

  if (changedTargets.length === 0) {
    const noChange = {
      command: 'risk',
      decision: 'pass',
      root,
      changedTargets: [],
      impactedEndpoints: [],
      topTests: [],
      reasons: ['No changed Java files in Git status.'],
      outputs,
    };
    const markdown = [
      'Decision: PASS',
      'Changed: -',
      'Impacted endpoints: -',
      'Suggested tests: -',
      'Reason: No changed Java files in Git status.',
      '',
    ].join('\n');
    if (args.out) outputs.markdown = writeText(args.out, markdown);
    if (args.jsonOut) outputs.json = writeJson(args.jsonOut, noChange);
    console.log(JSON.stringify(noChange, null, 2));
    return;
  }

  const graphs = [];
  for (const target of changedTargets.slice(0, maxTargets)) {
    graphs.push(await buildImpactGraph({
      root,
      target: target.target,
      mode: 'patch-impact',
      maxFiles: args.maxFiles,
      maxFileBytes: args.maxFileBytes,
      maxNodes: args.maxNodes,
      maxEdges: args.maxEdges,
      maxDepth: args.maxDepth,
      includeTests: args.includeTests,
    }));
  }

  const report = buildPatchRiskReport(changedTargets, graphs);
  if (args.out) outputs.markdown = writeText(args.out, report.markdown);
  if (args.jsonOut) outputs.json = writeJson(args.jsonOut, report);

  console.log(JSON.stringify(riskSummary(report, outputs), null, 2));
  if (shouldFail(report.decision, args.failOn ?? 'fail')) process.exitCode = 1;
}

async function runValidateCommand(args: ValidateCliArgs): Promise<void> {
  if (args.help) {
    printValidateHelp();
    return;
  }
  if (!args.suite) {
    printValidateHelp();
    throw new Error('--suite is required for validate.');
  }

  const result = await runValidationSuiteFile(args.suite, {
    maxFiles: args.maxFiles,
    maxFileBytes: args.maxFileBytes,
    maxNodes: args.maxNodes,
    maxEdges: args.maxEdges,
    maxDepth: args.maxDepth,
    includeTests: args.includeTests,
  });
  const outputs: Record<string, string> = {};
  if (args.out) outputs.json = writeJson(args.out, result);
  if (args.markdownOut) outputs.markdown = writeText(args.markdownOut, validationMarkdown(result));

  console.log(JSON.stringify(validationSummary(result, outputs), null, 2));
  if (!result.passed) process.exitCode = 1;
}

async function runPerformanceCommand(args: PerformanceCliArgs): Promise<void> {
  if (args.help) {
    printPerformanceHelp();
    return;
  }
  if (!args.root || !args.target) {
    printPerformanceHelp();
    throw new Error('Both --root and --target are required for benchmark performance.');
  }

  const thresholds: PerformanceThresholds = {
    coldMs: args.coldMs,
    warmMs: args.warmMs,
    minTrustScore: args.minTrustScore,
    maxUnresolvedCalls: args.maxUnresolvedCalls,
    minEndpoints: args.minEndpoints,
    minSuggestedTests: args.minSuggestedTests,
  };
  const result = await runPerformanceBenchmark({
    root: args.root,
    target: args.target,
    mode: args.mode ?? 'patch-impact',
    maxFiles: args.maxFiles,
    maxFileBytes: args.maxFileBytes,
    maxNodes: args.maxNodes,
    maxEdges: args.maxEdges,
    maxDepth: args.maxDepth,
    includeTests: args.includeTests,
    thresholds,
  });
  const outputs: Record<string, string> = {};
  if (args.out) outputs.json = writeJson(args.out, result);

  console.log(JSON.stringify({
    command: result.command,
    passed: result.passed,
    root: result.root,
    target: result.target,
    mode: result.mode,
    coldMs: result.coldMs,
    warmMs: result.warmMs,
    coldCacheHit: result.coldCacheHit,
    warmCacheHit: result.warmCacheHit,
    analyzerMs: result.analyzerMs,
    javaFilesScanned: result.javaFilesScanned,
    endpoints: result.endpoints,
    suggestedTests: result.suggestedTests.map(test => ({
      className: test.className,
      command: test.command,
      why: test.why,
    })),
    trust: result.trust,
    unresolvedCalls: result.unresolvedCalls,
    nodes: result.nodes,
    edges: result.edges,
    thresholds: result.thresholds,
    failures: result.failures,
    outputs,
  }, null, 2));
  if (!result.passed) process.exitCode = 1;
}

function parseImpactArgs(argv: string[]): ImpactCliArgs {
  const result: ImpactCliArgs = { mode: 'references', includeTests: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    const next = () => {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value after ${arg}`);
      return value;
    };
    switch (arg) {
      case '--root':
        result.root = next();
        break;
      case '--target':
      case '--symbol':
        result.target = next();
        break;
      case '--mode':
        result.mode = parseMode(next());
        break;
      case '--out':
        result.out = next();
        break;
      case '--html-out':
        result.htmlOut = next();
        break;
      case '--help':
      case '-h':
        result.help = true;
        break;
      default:
        if (parseCommonArg(result, arg, next)) break;
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return result;
}

function parseRiskArgs(argv: string[]): RiskCliArgs {
  const result: RiskCliArgs = { includeTests: true, failOn: 'fail' };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    const next = () => {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value after ${arg}`);
      return value;
    };
    switch (arg) {
      case '--root':
        result.root = next();
        break;
      case '--changed':
        break;
      case '--out':
        result.out = next();
        break;
      case '--json-out':
        result.jsonOut = next();
        break;
      case '--max-targets':
        result.maxTargets = parsePositiveInt(next(), arg);
        break;
      case '--fail-on':
        result.failOn = parseFailOn(next());
        break;
      case '--help':
      case '-h':
        result.help = true;
        break;
      default:
        if (parseCommonArg(result, arg, next)) break;
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return result;
}

function parseValidateArgs(argv: string[]): ValidateCliArgs {
  const result: ValidateCliArgs = { includeTests: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    const next = () => {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value after ${arg}`);
      return value;
    };
    switch (arg) {
      case '--suite':
        result.suite = next();
        break;
      case '--out':
        result.out = next();
        break;
      case '--markdown-out':
      case '--md-out':
        result.markdownOut = next();
        break;
      case '--help':
      case '-h':
        result.help = true;
        break;
      default:
        if (parseCommonArg(result, arg, next)) break;
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return result;
}

function parsePerformanceArgs(argv: string[]): PerformanceCliArgs {
  const result: PerformanceCliArgs = { mode: 'patch-impact', includeTests: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    const next = () => {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value after ${arg}`);
      return value;
    };
    switch (arg) {
      case '--root':
        result.root = next();
        break;
      case '--target':
      case '--symbol':
        result.target = next();
        break;
      case '--mode':
        result.mode = parseMode(next());
        break;
      case '--out':
      case '--json-out':
        result.out = next();
        break;
      case '--cold-ms':
        result.coldMs = parseNonNegativeNumber(next(), arg);
        break;
      case '--warm-ms':
        result.warmMs = parseNonNegativeNumber(next(), arg);
        break;
      case '--min-trust-score':
        result.minTrustScore = parseNonNegativeNumber(next(), arg);
        break;
      case '--max-unresolved-calls':
        result.maxUnresolvedCalls = parseNonNegativeInt(next(), arg);
        break;
      case '--min-endpoints':
        result.minEndpoints = parseNonNegativeInt(next(), arg);
        break;
      case '--min-suggested-tests':
        result.minSuggestedTests = parseNonNegativeInt(next(), arg);
        break;
      case '--help':
      case '-h':
        result.help = true;
        break;
      default:
        if (parseCommonArg(result, arg, next)) break;
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return result;
}

function parseCommonArg(result: CommonArgs, arg: string, next: () => string): boolean {
  switch (arg) {
    case '--max-files':
      result.maxFiles = parseNonNegativeInt(next(), arg);
      return true;
    case '--max-file-bytes':
      result.maxFileBytes = parsePositiveInt(next(), arg);
      return true;
    case '--max-nodes':
      result.maxNodes = parsePositiveInt(next(), arg);
      return true;
    case '--max-edges':
      result.maxEdges = parsePositiveInt(next(), arg);
      return true;
    case '--max-depth':
      result.maxDepth = parseNonNegativeInt(next(), arg);
      return true;
    case '--no-tests':
      result.includeTests = false;
      return true;
    default:
      return false;
  }
}

function riskSummary(report: PatchRiskReport, outputs: Record<string, string>): Record<string, unknown> {
  return {
    command: 'risk',
    decision: report.decision,
    changedTargets: report.changedTargets,
    impactedEndpoints: report.impactedEndpoints,
    topTests: report.topTests.map(test => ({
      className: test.className,
      command: test.command,
      why: test.why,
    })),
    trust: report.trust,
    unresolvedCalls: report.unresolvedCalls,
    reasons: report.reasons,
    outputs,
  };
}

function validationSummary(result: ValidationSuiteResult, outputs: Record<string, string>): Record<string, unknown> {
  return {
    command: 'validate',
    suite: result.name,
    passed: result.passed,
    total: result.summary.total,
    passedCases: result.summary.passed,
    failedCases: result.summary.failed,
    durationMs: result.durationMs,
    cases: result.cases.map(item => ({
      name: item.name,
      target: item.target,
      passed: item.passed,
      trust: item.actual.trust,
      endpoints: item.actual.endpoints,
      tests: item.actual.testClasses,
      failures: item.failures,
    })),
    outputs,
  };
}

function writeJson(file: string, value: unknown): string {
  return writeText(file, JSON.stringify(value, null, 2) + '\n');
}

function writeText(file: string, value: string): string {
  const out = path.resolve(file);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, value, 'utf-8');
  return out;
}

function shouldFail(decision: PatchRiskReport['decision'], failOn: FailOn): boolean {
  if (failOn === 'never') return false;
  if (failOn === 'warn') return decision === 'warn' || decision === 'fail';
  return decision === 'fail';
}

function parseMode(value: string): ImpactMode {
  if (value === 'references' || value === 'call' || value === 'api-flow' || value === 'patch-impact') return value;
  throw new Error(`Invalid --mode ${value}. Use references, call, api-flow, or patch-impact.`);
}

function parseFailOn(value: string): FailOn {
  if (value === 'never' || value === 'fail' || value === 'warn') return value;
  throw new Error(`Invalid --fail-on ${value}. Use never, fail, or warn.`);
}

function parsePositiveInt(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer.`);
  return parsed;
}

function parseNonNegativeInt(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${flag} must be 0 or a positive integer.`);
  return parsed;
}

function parseNonNegativeNumber(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`${flag} must be 0 or a positive number.`);
  return parsed;
}

function printHelp(): void {
  console.log(`Java Impact Flow

Usage:
  java-impact-flow --root <workspace> --target <Class|Class.method|field> [options]
  java-impact-flow risk --root <workspace> --changed [options]
  java-impact-flow validate --suite <validation.json> [options]
  java-impact-flow benchmark performance --root <workspace> --target <symbol> [options]

Impact options:
  --mode references|call|api-flow|patch-impact
  --out <graph.json>
  --html-out <graph.html>

Common options:
  --max-files <n>       0 scans the full project up to the safety cap
  --max-file-bytes <n>
  --max-nodes <n>
  --max-edges <n>
  --max-depth <n>       0 traces full depth up to the safety cap
  --no-tests
`);
}

function printBenchmarkHelp(): void {
  console.log(`Java Impact Flow benchmarks

Usage:
  java-impact-flow benchmark performance --root <workspace> --target <symbol> [options]
`);
}

function printPerformanceHelp(): void {
  console.log(`Java Impact Flow performance benchmark

Usage:
  java-impact-flow benchmark performance --root <workspace> --target <symbol> [options]

Options:
  --mode references|call|api-flow|patch-impact
  --out <performance.json>
  --cold-ms <n>
  --warm-ms <n>
  --min-trust-score <n>
  --max-unresolved-calls <n>
  --min-endpoints <n>
  --min-suggested-tests <n>
  --max-files <n>
  --max-file-bytes <n>
  --max-depth <n>
  --no-tests
`);
}

function printRiskHelp(): void {
  console.log(`Java Impact Flow patch risk gate

Usage:
  java-impact-flow risk --root <workspace> --changed [options]

Options:
  --out <risk.md>
  --json-out <risk.json>
  --fail-on never|fail|warn
  --max-targets <n>
  --max-files <n>
  --max-file-bytes <n>
  --max-depth <n>
  --no-tests
`);
}

function printValidateHelp(): void {
  console.log(`Java Impact Flow validation pack

Usage:
  java-impact-flow validate --suite <validation.json> [options]

Options:
  --out <validation.json>
  --markdown-out <validation.md>
  --max-files <n>
  --max-file-bytes <n>
  --max-depth <n>
  --no-tests
`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
