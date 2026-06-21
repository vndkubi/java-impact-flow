import { describe, expect, it } from 'vitest';
import { buildWorkbenchItems, type WorkbenchModelItem } from '../src/riskWorkbenchModel.js';
import type { PatchRiskReport } from '../src/riskReport.js';

describe('risk workbench model', () => {
  it('renders patch risk, scan, trust, unresolved, endpoints, and tests', () => {
    const report: PatchRiskReport = {
      decision: 'warn',
      changedTargets: ['OrderService.findOrders'],
      impactedEndpoints: ['GET /orders'],
      topTests: [{
        file: 'src/test/java/example/OrderControllerTest.java',
        className: 'example.OrderControllerTest',
        command: '.\\gradlew.bat test --tests "example.OrderControllerTest"',
        count: 2,
        line: 8,
        score: 30,
        kinds: ['test'],
        why: 'Covers OrderService.findOrders via GET /orders with 2 evidence hits.',
        evidenceChain: [],
      }],
      trust: { level: 'medium', score: 73 },
      unresolvedCalls: 1,
      reasons: ['Medium trust report; validate risky paths before merging.'],
      markdown: 'Decision: WARN',
    };

    const items = buildWorkbenchItems({
      status: 'ready',
      generatedAt: '2026-06-21T00:00:00.000Z',
      report,
      metrics: {
        scanMs: 287,
        analyzerMs: 287,
        cacheHits: 2,
        cacheMisses: 1,
        javaFilesScanned: 503,
        trust: report.trust,
        unresolvedCalls: report.unresolvedCalls,
      },
    });

    expect(items[0]).toEqual(expect.objectContaining({
      label: 'Patch Risk: WARN',
      description: 'Trust medium 73 | 287ms | 503 files | 1 unresolved',
    }));
    const labels = flatten(items).map(item => item.label);
    expect(labels).toContain('Scan: 287ms');
    expect(labels).toContain('Trust: Medium (73)');
    expect(labels).toContain('Unresolved calls: 1');
    expect(labels).toContain('GET /orders');
    expect(labels).toContain('example.OrderControllerTest');
    expect(labels).toContain('Medium trust report; validate risky paths before merging.');
  });
});

function flatten(items: WorkbenchModelItem[]): WorkbenchModelItem[] {
  return items.flatMap(item => [item, ...flatten(item.children ?? [])]);
}
