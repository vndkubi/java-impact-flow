import { describe, expect, it } from 'vitest';
import { buildPatchRiskReport, suggestedTestsForGraph } from '../src/riskReport.js';
import type { ImpactGraph } from '../src/impactGraph.js';

describe('patch risk report', () => {
  it('explains why a suggested test matters', () => {
    const graph = sampleGraph({
      target: 'OrderService.findOrders',
      endpointLabels: ['GET /orders'],
      testFiles: ['src/test/java/example/OrderServiceTest.java'],
    });

    expect(suggestedTestsForGraph(graph)).toEqual([
      expect.objectContaining({
        file: 'src/test/java/example/OrderServiceTest.java',
        className: 'example.OrderServiceTest',
        command: '.\\gradlew.bat test --tests "example.OrderServiceTest"',
        why: 'Covers OrderService.findOrders via GET /orders with 1 evidence hit.',
        evidenceChain: [
          'Changed target: OrderService.findOrders',
          'Impacted endpoint: GET /orders',
          'Test evidence: src/test/java/example/OrderServiceTest.java',
        ],
      }),
    ]);
  });

  it('builds a warn risk gate report from medium trust and unresolved calls', () => {
    const graph = sampleGraph({
      trustLevel: 'medium',
      trustScore: 61,
      unresolvedCalls: 3,
      target: 'OrderService.findOrders',
      endpointLabels: ['GET /orders'],
      testFiles: ['src/test/java/example/OrderServiceTest.java'],
    });

    const report = buildPatchRiskReport([{
      target: 'OrderService.findOrders',
      file: 'src/main/java/example/OrderService.java',
      line: 6,
      kind: 'method',
      reason: 'changed line 6',
    }], [graph]);

    expect(report.decision).toBe('warn');
    expect(report.changedTargets).toEqual(['OrderService.findOrders']);
    expect(report.impactedEndpoints).toEqual(['GET /orders']);
    expect(report.unresolvedCalls).toBe(3);
    expect(report.markdown).toContain('Decision: WARN');
    expect(report.markdown).toContain('Trust: Medium (61)');
    expect(report.markdown).toContain('Suggested tests: example.OrderServiceTest');
    expect(report.markdown).toContain('Why: Covers OrderService.findOrders via GET /orders with 1 evidence hit.');
  });

  it('fails when a patch impacts endpoints but has low trust and no tests', () => {
    const graph = sampleGraph({
      trustLevel: 'low',
      trustScore: 34,
      unresolvedCalls: 8,
      target: 'OrderController',
      endpointLabels: ['POST /orders'],
      testFiles: [],
    });

    const report = buildPatchRiskReport([{
      target: 'OrderController',
      file: 'src/main/java/example/OrderController.java',
      line: 3,
      kind: 'class',
      reason: 'changed line 3',
    }], [graph]);

    expect(report.decision).toBe('fail');
    expect(report.reasons).toContain('Low trust report requires manual validation.');
    expect(report.reasons).toContain('Endpoint impact has no suggested tests.');
  });
});

function sampleGraph(input: {
  target: string;
  endpointLabels: string[];
  testFiles: string[];
  trustLevel?: 'high' | 'medium' | 'low';
  trustScore?: number;
  unresolvedCalls?: number;
}): ImpactGraph {
  return {
    schemaVersion: 1,
    metadata: {
      root: '/workspace/repo',
      target: input.target,
      mode: 'patch-impact',
      generatedAt: '2026-06-21T00:00:00.000Z',
      analyzer: 'ext-graph-static-java',
      fileLimit: 100000,
      truncated: false,
      skippedLargeFiles: 0,
      buildSystem: { tool: 'gradle', wrapper: 'gradlew.bat' },
      trust: {
        level: input.trustLevel ?? 'high',
        score: input.trustScore ?? 86,
        reasons: ['Static regex analyzer; validate important paths against source or tests.'],
        resolvedCallRate: 0.9,
        averageConfidence: 0.78,
        unresolvedCalls: input.unresolvedCalls ?? 0,
        staticOnly: true,
      },
    },
    summary: {
      javaFilesScanned: 3,
      definitions: 1,
      references: input.testFiles.length,
      callSites: 1,
      fieldReads: 0,
      fieldWrites: 0,
      endpoints: input.endpointLabels.length,
      callbacks: 0,
      frameworkAnnotations: 0,
      flows: input.endpointLabels.length,
      maxFlowDepth: 2,
      tests: input.testFiles.length,
      topFiles: [],
    },
    nodes: input.endpointLabels.map((label, index) => ({
      id: `endpoint:${index}`,
      kind: 'endpoint',
      label,
      file: 'src/main/java/example/OrderController.java',
      line: 10 + index,
    })),
    edges: [],
    flows: input.endpointLabels.map((label, index) => ({
      id: `flow:${index}`,
      label,
      endpoint: {
        method: label.split(' ')[0] ?? 'GET',
        path: label.split(' ')[1] ?? '/',
        handler: input.target,
        file: 'src/main/java/example/OrderController.java',
        line: 10 + index,
      },
      maxDepth: 20,
      truncated: false,
      mermaid: 'sequenceDiagram',
      diagnostics: {
        resolvedCalls: 1,
        unresolvedCalls: input.unresolvedCalls ?? 0,
        branchMarkers: 0,
        loopMarkers: 0,
        exceptionMarkers: 0,
        returnMarkers: 1,
        averageConfidence: 0.75,
        staticOnly: true,
        notes: [],
      },
      steps: [],
    })),
    evidence: input.testFiles.map((file, index) => ({
      id: `ev:${index}`,
      kind: 'test',
      file,
      line: 8 + index,
      text: `new ${simpleClassName(file)}().coversPatch();`,
      symbol: input.target,
      confidence: 0.72,
    })),
    warnings: ['Static prototype output is regex-based.'],
  };
}

function simpleClassName(file: string): string {
  return file.replace(/\\/g, '/').split('/').pop()?.replace(/\.java$/, '') ?? file;
}
