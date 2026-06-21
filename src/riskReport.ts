import type { ChangedJavaTarget } from './gitChanges.js';
import type { ImpactGraph } from './impactGraph.js';
import { buildTestCommandForFile, isTestFile, normalizeTestFilePath, testClassNameFromFile } from './testCommand.js';

export interface TestSuggestion {
  file: string;
  className: string;
  command: string;
  count: number;
  line: number;
  score: number;
  kinds: string[];
  why: string;
  evidenceChain: string[];
}

export interface PatchRiskReport {
  decision: 'pass' | 'warn' | 'fail';
  changedTargets: string[];
  impactedEndpoints: string[];
  topTests: TestSuggestion[];
  trust: {
    level: 'high' | 'medium' | 'low';
    score: number;
  };
  unresolvedCalls: number;
  reasons: string[];
  markdown: string;
}

export function buildPatchRiskReport(changes: ChangedJavaTarget[], graphs: ImpactGraph[]): PatchRiskReport {
  const changedTargets = unique([
    ...changes.map(change => change.target),
    ...graphs.map(graph => graph.metadata.target),
  ]);
  const impactedEndpoints = unique(graphs.flatMap(endpointLabelsForGraph));
  const topTests = mergeTestSuggestions(graphs).slice(0, 8);
  const unresolvedCalls = graphs.reduce((sum, graph) => sum + graph.metadata.trust.unresolvedCalls, 0);
  const trust = aggregateTrust(graphs);
  const reasons = riskReasons({ trust, impactedEndpoints, topTests, unresolvedCalls });
  const decision = reasons.some(reason => reason.startsWith('Low trust') || reason.includes('no suggested tests'))
    ? 'fail'
    : reasons.length > 0
      ? 'warn'
      : 'pass';

  const report: Omit<PatchRiskReport, 'markdown'> = {
    decision,
    changedTargets,
    impactedEndpoints,
    topTests,
    trust,
    unresolvedCalls,
    reasons,
  };

  return { ...report, markdown: patchRiskMarkdown(report) };
}

export function suggestedTestsForGraph(graph: ImpactGraph, limit = 8): TestSuggestion[] {
  const endpoints = endpointLabelsForGraph(graph);
  const groups = new Map<string, {
    file: string;
    count: number;
    line: number;
    kinds: Set<string>;
    score: number;
  }>();

  for (const item of graph.evidence ?? []) {
    if (!item.file || (!isTestFile(item.file) && item.kind !== 'test')) continue;
    const normalizedFile = normalizeTestFilePath(item.file);
    const group = groups.get(normalizedFile) ?? {
      file: normalizedFile,
      count: 0,
      line: item.line || 1,
      kinds: new Set<string>(),
      score: 0,
    };
    group.count++;
    group.line = Math.min(group.line, item.line || group.line);
    group.kinds.add(item.kind);
    group.score += 10 + (item.kind === 'test' ? 5 : 0) + Math.round(item.confidence * 5);
    groups.set(normalizedFile, group);
  }

  return [...groups.values()].map(group => {
    const className = testClassNameFromFile(group.file);
    const endpointLabel = endpoints[0] ?? 'reference evidence';
    const hitWord = group.count === 1 ? 'hit' : 'hits';
    return {
      file: group.file,
      className,
      command: buildTestCommandForFile(group.file, graph.metadata.buildSystem, graph.metadata.root),
      count: group.count,
      line: group.line,
      score: group.score + testNameBoost(group.file),
      kinds: [...group.kinds].sort(),
      why: `Covers ${graph.metadata.target} via ${endpointLabel} with ${group.count} evidence ${hitWord}.`,
      evidenceChain: [
        `Changed target: ${graph.metadata.target}`,
        `Impacted endpoint: ${endpointLabel}`,
        `Test evidence: ${group.file}`,
      ],
    };
  }).sort((a, b) => b.score - a.score || b.count - a.count || a.file.localeCompare(b.file)).slice(0, limit);
}

export function patchRiskMarkdown(report: Omit<PatchRiskReport, 'markdown'>): string {
  const lines = [
    `Decision: ${report.decision.toUpperCase()}`,
    `Changed: ${report.changedTargets.length ? report.changedTargets.join(', ') : '-'}`,
    `Impacted endpoints: ${report.impactedEndpoints.length ? report.impactedEndpoints.join(', ') : '-'}`,
    `Suggested tests: ${report.topTests.length ? report.topTests.map(test => test.className).join(', ') : '-'}`,
    `Trust: ${capitalize(report.trust.level)} (${report.trust.score})`,
    `Unresolved calls: ${report.unresolvedCalls}`,
  ];

  if (report.topTests.length > 0) {
    lines.push('', 'Test commands:');
    for (const test of report.topTests.slice(0, 5)) lines.push(`- ${test.command}`);
    lines.push('', 'Why these tests:');
    for (const test of report.topTests.slice(0, 5)) lines.push(`- ${test.className}: Why: ${test.why}`);
  }
  if (report.reasons.length > 0) {
    lines.push('', 'Risk reasons:');
    for (const reason of report.reasons) lines.push(`- ${reason}`);
  }
  return lines.join('\n');
}

function mergeTestSuggestions(graphs: ImpactGraph[]): TestSuggestion[] {
  const byFile = new Map<string, TestSuggestion>();
  for (const suggestion of graphs.flatMap(graph => suggestedTestsForGraph(graph))) {
    const normalizedFile = normalizeTestFilePath(suggestion.file);
    const keySuggestion = { ...suggestion, file: normalizedFile };
    const existing = byFile.get(normalizedFile);
    if (!existing) {
      byFile.set(normalizedFile, keySuggestion);
      continue;
    }
    existing.count += keySuggestion.count;
    existing.score += keySuggestion.score;
    existing.kinds = unique([...existing.kinds, ...keySuggestion.kinds]);
    existing.evidenceChain = unique([...existing.evidenceChain, ...keySuggestion.evidenceChain]);
    existing.why = `${existing.why} Also ${keySuggestion.why.charAt(0).toLowerCase()}${keySuggestion.why.slice(1)}`;
  }
  return [...byFile.values()].sort((a, b) => b.score - a.score || b.count - a.count || a.file.localeCompare(b.file));
}

function riskReasons(input: {
  trust: { level: 'high' | 'medium' | 'low'; score: number };
  impactedEndpoints: string[];
  topTests: TestSuggestion[];
  unresolvedCalls: number;
}): string[] {
  const reasons: string[] = [];
  if (input.trust.level === 'low') reasons.push('Low trust report requires manual validation.');
  else if (input.trust.level === 'medium') reasons.push('Medium trust report; validate risky paths before merging.');
  if (input.impactedEndpoints.length > 0 && input.topTests.length === 0) reasons.push('Endpoint impact has no suggested tests.');
  if (input.unresolvedCalls > 0) reasons.push(`${input.unresolvedCalls} unresolved call/callback step(s) need review.`);
  return reasons;
}

function aggregateTrust(graphs: ImpactGraph[]): { level: 'high' | 'medium' | 'low'; score: number } {
  if (graphs.length === 0) return { level: 'low', score: 0 };
  const lowest = graphs.reduce((min, graph) => graph.metadata.trust.score < min.metadata.trust.score ? graph : min, graphs[0]!);
  return {
    level: lowest.metadata.trust.level,
    score: lowest.metadata.trust.score,
  };
}

function endpointLabelsForGraph(graph: ImpactGraph): string[] {
  return unique([
    ...graph.nodes.filter(node => node.kind === 'endpoint').map(node => node.label),
    ...graph.flows.map(flow => flow.endpoint ? `${flow.endpoint.method} ${flow.endpoint.path}` : flow.label),
  ].filter(Boolean));
}

function testNameBoost(file: string): number {
  if (/ControllerTest\.java$/.test(file)) return 16;
  if (/ServiceTest\.java$/.test(file)) return 10;
  if (/RepositoryTest\.java$/.test(file)) return 6;
  return 0;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
