import path from 'node:path';
import { ImpactGraphCache } from './impactCache.js';
import type { BuildImpactGraphOptions, ImpactMode } from './impactGraph.js';
import { suggestedTestsForGraph, type TestSuggestion } from './riskReport.js';

export interface PerformanceThresholds {
  coldMs?: number;
  warmMs?: number;
  minTrustScore?: number;
  maxUnresolvedCalls?: number;
  minEndpoints?: number;
  minSuggestedTests?: number;
}

export interface PerformanceBenchmarkOptions extends BuildImpactGraphOptions {
  mode?: ImpactMode;
  thresholds?: PerformanceThresholds;
  cache?: ImpactGraphCache;
}

export interface PerformanceBenchmarkResult {
  command: 'benchmark:performance';
  passed: boolean;
  root: string;
  target: string;
  mode: ImpactMode;
  coldMs: number;
  warmMs: number;
  coldCacheHit: boolean;
  warmCacheHit: boolean;
  analyzerMs: number;
  javaFilesScanned: number;
  endpoints: string[];
  suggestedTests: TestSuggestion[];
  trust: {
    level: 'high' | 'medium' | 'low';
    score: number;
  };
  unresolvedCalls: number;
  nodes: number;
  edges: number;
  thresholds: PerformanceThresholds;
  failures: string[];
}

export async function runPerformanceBenchmark(options: PerformanceBenchmarkOptions): Promise<PerformanceBenchmarkResult> {
  const cache = options.cache ?? new ImpactGraphCache();
  cache.clear();
  const graphOptions: BuildImpactGraphOptions = {
    root: path.resolve(options.root),
    target: options.target,
    mode: options.mode ?? 'patch-impact',
    maxFiles: options.maxFiles,
    maxFileBytes: options.maxFileBytes,
    maxNodes: options.maxNodes,
    maxEdges: options.maxEdges,
    maxDepth: options.maxDepth,
    includeTests: options.includeTests,
  };

  const cold = await cache.getGraph(graphOptions);
  const warm = await cache.getGraph(graphOptions);
  const graph = cold.graph;
  const suggestedTests = suggestedTestsForGraph(graph);
  const endpoints = unique([
    ...graph.nodes.filter(node => node.kind === 'endpoint').map(node => node.label),
    ...graph.flows.map(flow => flow.endpoint ? `${flow.endpoint.method} ${flow.endpoint.path}` : flow.label),
  ]);
  const thresholds = options.thresholds ?? {};
  const trust = {
    level: graph.metadata.trust.level,
    score: graph.metadata.trust.score,
  };
  const resultBase = {
    coldMs: cold.durationMs,
    warmMs: warm.durationMs,
    javaFilesScanned: graph.summary.javaFilesScanned,
    endpoints,
    suggestedTests,
    trust,
    unresolvedCalls: graph.metadata.trust.unresolvedCalls,
  };
  const failures = performanceFailures(resultBase, thresholds);

  return {
    command: 'benchmark:performance',
    passed: failures.length === 0,
    root: graph.metadata.root,
    target: graph.metadata.target,
    mode: graph.metadata.mode,
    coldMs: cold.durationMs,
    warmMs: warm.durationMs,
    coldCacheHit: cold.cacheHit,
    warmCacheHit: warm.cacheHit,
    analyzerMs: cold.analyzerDurationMs,
    javaFilesScanned: graph.summary.javaFilesScanned,
    endpoints,
    suggestedTests,
    trust,
    unresolvedCalls: graph.metadata.trust.unresolvedCalls,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    thresholds,
    failures,
  };
}

function performanceFailures(input: {
  coldMs: number;
  warmMs: number;
  javaFilesScanned: number;
  endpoints: string[];
  suggestedTests: TestSuggestion[];
  trust: { level: 'high' | 'medium' | 'low'; score: number };
  unresolvedCalls: number;
}, thresholds: PerformanceThresholds): string[] {
  const failures: string[] = [];
  if (thresholds.coldMs !== undefined && input.coldMs > thresholds.coldMs) {
    failures.push(`Cold scan ${input.coldMs}ms exceeded ${thresholds.coldMs}ms.`);
  }
  if (thresholds.warmMs !== undefined && input.warmMs > thresholds.warmMs) {
    failures.push(`Warm cache ${input.warmMs}ms exceeded ${thresholds.warmMs}ms.`);
  }
  if (thresholds.minTrustScore !== undefined && input.trust.score < thresholds.minTrustScore) {
    failures.push(`Trust score ${input.trust.score} was below ${thresholds.minTrustScore}.`);
  }
  if (thresholds.maxUnresolvedCalls !== undefined && input.unresolvedCalls > thresholds.maxUnresolvedCalls) {
    failures.push(`Unresolved calls ${input.unresolvedCalls} exceeded ${thresholds.maxUnresolvedCalls}.`);
  }
  if (thresholds.minEndpoints !== undefined && input.endpoints.length < thresholds.minEndpoints) {
    failures.push(`Endpoint count ${input.endpoints.length} was below ${thresholds.minEndpoints}.`);
  }
  if (thresholds.minSuggestedTests !== undefined && input.suggestedTests.length < thresholds.minSuggestedTests) {
    failures.push(`Suggested test count ${input.suggestedTests.length} was below ${thresholds.minSuggestedTests}.`);
  }
  return failures;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
