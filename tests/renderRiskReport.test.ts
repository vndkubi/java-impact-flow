import { describe, expect, it } from 'vitest';
import { renderPatchRiskReportHtml } from '../src/renderRiskReport.js';
import type { PatchRiskReport } from '../src/riskReport.js';

describe('renderPatchRiskReportHtml', () => {
  it('renders decision, copy summary, and run top tests actions', () => {
    const html = renderPatchRiskReportHtml({
      decision: 'warn',
      changedTargets: ['OrderService.findOrders'],
      impactedEndpoints: ['GET /orders'],
      topTests: [{
        file: 'src/test/java/example/OrderServiceTest.java',
        className: 'example.OrderServiceTest',
        command: '.\\gradlew.bat test --tests "example.OrderServiceTest"',
        count: 1,
        line: 8,
        score: 10,
        kinds: ['test'],
        why: 'Covers OrderService.findOrders via GET /orders with 1 evidence hit.',
        evidenceChain: [],
      }],
      trust: { level: 'medium', score: 61 },
      unresolvedCalls: 3,
      reasons: ['Medium trust report; validate risky paths before merging.'],
      markdown: 'Decision: WARN',
    } satisfies PatchRiskReport);

    expect(html).toContain('Patch Risk Gate');
    expect(html).toContain('Copy PR Summary');
    expect(html).toContain('Run Top Tests');
    expect(html).toContain("type: 'copyText'");
    expect(html).toContain("type: 'runTestCommands'");
    expect(html).toContain('Covers OrderService.findOrders via GET /orders');
  });
});
