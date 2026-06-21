import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import * as impactGraph from '../src/impactGraph.js';
import { runValidationSuite, runValidationSuiteFile, parseValidationSuite, validationMarkdown } from '../src/validation.js';
import type { ImpactGraph, ImpactMode } from '../src/impactGraph.js';

const emptyGraph: ImpactGraph = {
  schemaVersion: 1,
  metadata: {
    root: process.cwd(),
    target: 'placeholder',
    mode: 'patch-impact' as ImpactMode,
    generatedAt: new Date().toISOString(),
    analyzer: 'ext-graph-static-java',
    fileLimit: 0,
    truncated: false,
    skippedLargeFiles: 0,
    buildSystem: { tool: 'unknown' },
    trust: {
      level: 'low',
      score: 0,
      reasons: [],
      resolvedCallRate: 0,
      averageConfidence: 0,
      unresolvedCalls: 0,
      staticOnly: true,
    },
  },
  summary: {
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
  },
  nodes: [],
  edges: [],
  flows: [],
  evidence: [],
  warnings: [],
};

describe('validation pack', () => {
  it('passes the bundled Java sample suite and renders a scorecard', async () => {
    const result = await runValidationSuiteFile(path.resolve('validation/java-impact-flow.validation.json'), {
      maxFiles: 0,
      maxDepth: 0,
    });

    expect(result.passed).toBe(true);
    expect(result.summary).toEqual({ total: 2, passed: 2, failed: 0 });
    expect(result.cases.map(item => item.name)).toEqual([
      'spring-orders-service-impact',
      'jaxrs-admin-resource-impact',
    ]);
    expect(result.cases[0]?.actual.endpoints).toContain('GET /orders');
    expect(result.cases[0]?.actual.testClasses).toContain('example.OrderControllerTest');
    expect(result.cases[1]?.actual.endpoints).toEqual([
      'GET /admin/users/{id}',
      'POST /admin/users',
    ]);
    expect(result.cases[1]?.actual.testClasses).toContain('example.AdminUserResourceTest');

    const markdown = validationMarkdown(result);
    expect(markdown).toContain('Status: PASS');
    expect(markdown).toContain('| spring-orders-service-impact | OrderService.findOrders | PASS |');
    expect(markdown).toContain('Suggested tests: example.AdminUserResourceTest');
  });

  it('keeps running all cases when one or more cases fail to analyze', async () => {
    const buildImpactGraph = vi.spyOn(impactGraph, 'buildImpactGraph');
    buildImpactGraph
      .mockResolvedValueOnce(emptyGraph)
      .mockRejectedValueOnce(new Error('simulated analyzer failure.'));
    try {
      const result = await runValidationSuite({
        cases: [
          { name: 'good-case', root: '.', target: 'OrderService' },
          { name: 'bad-case', root: '.', target: 'BillingService' },
        ],
      }, process.cwd());

      expect(result.summary).toEqual({ total: 2, passed: 1, failed: 1 });
      expect(result.passed).toBe(false);
      expect(result.cases.map(item => item.passed)).toEqual([true, false]);
      expect(result.cases[1].failures.join('\n')).toMatch(/Validation failed while building impact graph for BillingService/);
      expect(result.cases[1].actual.endpoints).toEqual([]);
      expect(result.cases[1].actual.summary).toEqual({
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
      });
    } finally {
      buildImpactGraph.mockRestore();
    }
  });

  it('rejects malformed validation suites and invalid cases', () => {
    expect(() => parseValidationSuite('{}')).toThrow('Validation suite must include a cases array.');
    expect(() => parseValidationSuite(JSON.stringify({ cases: [{}] }))).toThrow('Each validation case must include a non-empty name.');
    expect(() => parseValidationSuite(JSON.stringify({ cases: [{ name: 'x', root: 'y' }] })))
      .toThrow('Each validation case must include a non-empty target.');
    expect(() => parseValidationSuite(JSON.stringify({ cases: [{ name: 'x', root: 'y', target: 'z', mode: 'invalid-mode' }]})))
      .toThrow('Invalid validation case mode for \"x\": invalid-mode.');
    expect(() => parseValidationSuite(JSON.stringify({ cases: [{ name: 'x', root: 'y', target: 'z', expect: 'no-object' }]})))
      .toThrow('Validation case "x" has invalid expect configuration.');
  });
});
