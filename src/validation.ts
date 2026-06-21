import fs from 'node:fs';
import path from 'node:path';
import { buildImpactGraph, type ImpactGraph, type ImpactMode } from './impactGraph.js';
import { suggestedTestsForGraph } from './riskReport.js';

const SUMMARY_ZERO: ImpactGraph['summary'] = {
  javaFilesScanned: 0,
  definitions: 0,
  references: 0,
  callSites: 0,
  fieldReads: 0,
  fieldWrites: 0,
  endpoints: 0,
  callbacks: 0,
  frameworkAnnotations: 0,
  flows: 0,
  maxFlowDepth: 0,
  tests: 0,
  topFiles: [],
};

type UnknownRecord = Record<string, unknown>;

export interface ValidationSuiteFile {
  name?: string;
  cases: ValidationCaseFile[];
}

export interface ValidationCaseFile {
  name: string;
  root: string;
  target: string;
  mode?: ImpactMode;
  expect?: ValidationExpectations;
}

export interface ValidationExpectations {
  endpoints?: string[];
  testClasses?: string[];
  minTrustScore?: number;
  minTrustLevel?: 'low' | 'medium' | 'high';
  maxUnresolvedCalls?: number;
  minFlows?: number;
  minTests?: number;
}

export interface ValidationRunOptions {
  maxFiles?: number;
  maxFileBytes?: number;
  maxNodes?: number;
  maxEdges?: number;
  maxDepth?: number;
  includeTests?: boolean;
}

export interface ValidationSuiteResult {
  name: string;
  generatedAt: string;
  passed: boolean;
  durationMs: number;
  summary: {
    total: number;
    passed: number;
    failed: number;
  };
  cases: ValidationCaseResult[];
}

export interface ValidationCaseResult {
  name: string;
  root: string;
  target: string;
  mode: ImpactMode;
  passed: boolean;
  durationMs: number;
  failures: string[];
  expected: ValidationExpectations;
  actual: {
    endpoints: string[];
    testClasses: string[];
    testFiles: string[];
    trust: {
      level: 'high' | 'medium' | 'low';
      score: number;
    };
    unresolvedCalls: number;
    summary: ImpactGraph['summary'];
  };
}

interface ResolvedValidationCase extends ValidationCaseFile {
  rootAbs: string;
  rootDisplay: string;
}

export function readValidationSuite(file: string): ValidationSuiteFile {
  const raw = fs.readFileSync(file, 'utf-8');
  return parseValidationSuite(raw);
}

export function parseValidationSuite(raw: string): ValidationSuiteFile {
  const parsed: UnknownRecord = JSON.parse(raw) as UnknownRecord;
  const cases = parsed.cases;
  if (!parsed || typeof parsed !== 'object') throw new Error('Validation suite must be a JSON object.');
  if (!Array.isArray(cases)) throw new Error('Validation suite must include a cases array.');
  for (const rawCase of cases) {
    validateValidationCase(rawCase);
  }
  return parsed as unknown as ValidationSuiteFile;
}

function validateValidationCase(rawCase: unknown): void {
  if (!rawCase || typeof rawCase !== 'object') {
    throw new Error('Each validation case must be an object with name, root, and target.');
  }
  const item = rawCase as UnknownRecord;
  const name = item.name;
  const root = item.root;
  const target = item.target;
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('Each validation case must include a non-empty name.');
  }
  if (typeof root !== 'string' || root.trim().length === 0) {
    throw new Error('Each validation case must include a non-empty root.');
  }
  if (typeof target !== 'string' || target.trim().length === 0) {
    throw new Error('Each validation case must include a non-empty target.');
  }
  if (item.mode !== undefined && !isValidImpactMode(item.mode)) {
    throw new Error(`Invalid validation case mode for "${name}": ${String(item.mode)}.`);
  }
  if (item.expect !== undefined && (!isRecord(item.expect) || Array.isArray(item.expect))) {
    throw new Error(`Validation case "${name}" has invalid expect configuration.`);
  }
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isValidImpactMode(value: unknown): value is ImpactMode {
  return value === 'references' || value === 'call' || value === 'api-flow' || value === 'patch-impact';
}

export async function runValidationSuiteFile(
  suiteFile: string,
  options: ValidationRunOptions = {},
): Promise<ValidationSuiteResult> {
  const suitePath = path.resolve(suiteFile);
  const suite = readValidationSuite(suitePath);
  return await runValidationSuite(suite, path.dirname(suitePath), options);
}

export async function runValidationSuite(
  suite: ValidationSuiteFile,
  baseDir: string,
  options: ValidationRunOptions = {},
): Promise<ValidationSuiteResult> {
  const start = performance.now();
  const cases: ValidationCaseResult[] = [];
  for (const item of suite.cases.map(testCase => resolveCase(testCase, baseDir))) {
    const caseStart = performance.now();
    try {
      cases.push(await runValidationCase(item, options));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      cases.push({
        name: item.name,
        root: item.rootDisplay,
        target: item.target,
        mode: item.mode ?? 'patch-impact',
        passed: false,
        durationMs: Math.round(performance.now() - caseStart),
        failures: [`Validation failed while building impact graph for ${item.target}: ${message}`],
        expected: item.expect ?? {},
        actual: {
          endpoints: [],
          testClasses: [],
          testFiles: [],
          trust: { level: 'low', score: 0 },
          unresolvedCalls: 0,
          summary: SUMMARY_ZERO,
        },
      });
    }
  }
  const passed = cases.filter(item => item.passed).length;
  const failed = cases.length - passed;
  return {
    name: suite.name ?? 'Java Impact Flow validation',
    generatedAt: new Date().toISOString(),
    passed: failed === 0,
    durationMs: Math.round(performance.now() - start),
    summary: {
      total: cases.length,
      passed,
      failed,
    },
    cases,
  };
}

export function validationMarkdown(result: ValidationSuiteResult): string {
  const lines = [
    `# ${result.name}`,
    '',
    `Status: ${result.passed ? 'PASS' : 'FAIL'}`,
    `Generated: ${result.generatedAt}`,
    `Duration: ${formatDuration(result.durationMs)}`,
    `Cases: ${result.summary.passed}/${result.summary.total} passed`,
    '',
    '| Case | Target | Status | Trust | Endpoints | Tests | Time |',
    '| --- | --- | --- | --- | ---: | ---: | ---: |',
  ];

  for (const item of result.cases) {
    lines.push([
      `| ${item.name}`,
      item.target,
      item.passed ? 'PASS' : 'FAIL',
      `${capitalize(item.actual.trust.level)} ${item.actual.trust.score}`,
      String(item.actual.endpoints.length),
      String(item.actual.testClasses.length),
      `${item.durationMs}ms |`,
    ].join(' | '));
  }

  for (const item of result.cases) {
    lines.push(
      '',
      `## ${item.name}`,
      '',
      `Target: ${item.target}`,
      `Root: ${item.root}`,
      `Mode: ${item.mode}`,
      `Status: ${item.passed ? 'PASS' : 'FAIL'}`,
      `Trust: ${capitalize(item.actual.trust.level)} (${item.actual.trust.score})`,
      `Unresolved calls: ${item.actual.unresolvedCalls}`,
      `Java files scanned: ${item.actual.summary.javaFilesScanned}`,
      `Flows: ${item.actual.summary.flows}`,
      `Endpoints: ${item.actual.endpoints.length ? item.actual.endpoints.join(', ') : '-'}`,
      `Suggested tests: ${item.actual.testClasses.length ? item.actual.testClasses.join(', ') : '-'}`,
    );
    if (item.failures.length > 0) {
      lines.push('', 'Failures:');
      for (const failure of item.failures) lines.push(`- ${failure}`);
    }
  }

  return lines.join('\n') + '\n';
}

async function runValidationCase(
  testCase: ResolvedValidationCase,
  options: ValidationRunOptions,
): Promise<ValidationCaseResult> {
  const start = performance.now();
  const mode = testCase.mode ?? 'patch-impact';
  const graph = await buildImpactGraph({
    root: testCase.rootAbs,
    target: testCase.target,
    mode,
    maxFiles: options.maxFiles,
    maxFileBytes: options.maxFileBytes,
    maxNodes: options.maxNodes,
    maxEdges: options.maxEdges,
    maxDepth: options.maxDepth,
    includeTests: options.includeTests,
  });
  const tests = suggestedTestsForGraph(graph);
  const actual = {
    endpoints: endpointLabelsForGraph(graph),
    testClasses: unique(tests.map(test => test.className)),
    testFiles: unique(tests.map(test => slash(test.file))),
    trust: {
      level: graph.metadata.trust.level,
      score: graph.metadata.trust.score,
    },
    unresolvedCalls: graph.metadata.trust.unresolvedCalls,
    summary: graph.summary,
  };
  const expected = testCase.expect ?? {};
  const failures = validateActual(expected, actual);
  return {
    name: testCase.name,
    root: testCase.rootDisplay,
    target: testCase.target,
    mode,
    passed: failures.length === 0,
    durationMs: Math.round(performance.now() - start),
    failures,
    expected,
    actual,
  };
}

function resolveCase(testCase: ValidationCaseFile, baseDir: string): ResolvedValidationCase {
  const rootAbs = path.isAbsolute(testCase.root) ? path.resolve(testCase.root) : path.resolve(baseDir, testCase.root);
  return {
    ...testCase,
    rootAbs,
    rootDisplay: slash(path.isAbsolute(testCase.root) ? path.basename(rootAbs) : testCase.root),
  };
}

function validateActual(
  expected: ValidationExpectations,
  actual: ValidationCaseResult['actual'],
): string[] {
  const failures: string[] = [];
  for (const endpoint of expected.endpoints ?? []) {
    if (!actual.endpoints.includes(endpoint)) failures.push(`Missing expected endpoint: ${endpoint}`);
  }
  for (const testClass of expected.testClasses ?? []) {
    if (!actual.testClasses.includes(testClass)) failures.push(`Missing expected test class: ${testClass}`);
  }
  if (expected.minTrustScore !== undefined && actual.trust.score < expected.minTrustScore) {
    failures.push(`Trust score ${actual.trust.score} is below expected minimum ${expected.minTrustScore}`);
  }
  if (expected.minTrustLevel && trustRank(actual.trust.level) < trustRank(expected.minTrustLevel)) {
    failures.push(`Trust level ${actual.trust.level} is below expected minimum ${expected.minTrustLevel}`);
  }
  if (expected.maxUnresolvedCalls !== undefined && actual.unresolvedCalls > expected.maxUnresolvedCalls) {
    failures.push(`Unresolved calls ${actual.unresolvedCalls} exceed expected maximum ${expected.maxUnresolvedCalls}`);
  }
  if (expected.minFlows !== undefined && actual.summary.flows < expected.minFlows) {
    failures.push(`Flow count ${actual.summary.flows} is below expected minimum ${expected.minFlows}`);
  }
  if (expected.minTests !== undefined && actual.testClasses.length < expected.minTests) {
    failures.push(`Suggested test count ${actual.testClasses.length} is below expected minimum ${expected.minTests}`);
  }
  return failures;
}

function endpointLabelsForGraph(graph: ImpactGraph): string[] {
  return unique([
    ...graph.nodes.filter(node => node.kind === 'endpoint').map(node => node.label),
    ...graph.flows.map(flow => flow.endpoint ? `${flow.endpoint.method} ${flow.endpoint.path}` : flow.label),
  ].filter(Boolean)).sort();
}

function trustRank(level: 'low' | 'medium' | 'high'): number {
  if (level === 'high') return 3;
  if (level === 'medium') return 2;
  return 1;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function slash(value: string): string {
  return value.replace(/\\/g, '/');
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}
