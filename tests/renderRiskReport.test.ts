import { describe, expect, it } from 'vitest';
import { renderPatchRiskReportHtml } from '../src/renderRiskReport.js';
import type { PatchRiskReport } from '../src/riskReport.js';
import { TEST_COMMAND_BATCH_LIMIT } from '../src/testCommandRunner.js';
import { WEBVIEW_MESSAGE_TYPES } from '../src/webviewMessageSchema.js';

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
    expect(html).toContain(`Run Top ${TEST_COMMAND_BATCH_LIMIT}`);
    expect(html).toContain(`type: WEBVIEW_MESSAGE_TYPES.${WEBVIEW_MESSAGE_TYPES.copyText}`);
    expect(html).toContain(`type: WEBVIEW_MESSAGE_TYPES.${WEBVIEW_MESSAGE_TYPES.runTestCommands}`);
    expect(html).toContain('Covers OrderService.findOrders via GET /orders');
  });

  it('normalizes and deduplicates top-test commands before posting runTestCommands', () => {
    const html = renderPatchRiskReportHtml({
      decision: 'warn',
      changedTargets: ['OrderService.findOrders'],
      impactedEndpoints: ['GET /orders'],
      topTests: [
        { file: 'src/test/java/example/OrderServiceTest.java', className: 'example.OrderServiceTest', command: ' .\\gradlew.bat test --tests "example.OrderServiceTest" ', count: 1, line: 8, score: 10, kinds: ['test'], why: 'first', evidenceChain: [] },
        { file: 'core/module/src/test/java/example/OrderServiceTest.java', className: 'example.OrderServiceTest', command: '.\\gradlew.bat test --tests "example.OrderServiceTest"', count: 2, line: 12, score: 9, kinds: ['test'], why: 'second', evidenceChain: [] },
        { file: 'src/test/java/example/RepoTest.java', className: 'example.RepoTest', command: '   ', count: 1, line: 3, score: 8, kinds: ['test'], why: 'empty', evidenceChain: [] },
        { file: 'src/test/java/example/OrderServiceTest.java', className: 'example.OrderServiceTest', command: 123 as never, count: 1, line: 7, score: 1, kinds: ['test'], why: 'invalid', evidenceChain: [] },
      ],
      trust: { level: 'medium', score: 61 },
      unresolvedCalls: 3,
      reasons: ['Medium trust report; validate risky paths before merging.'],
      markdown: 'Decision: WARN',
    } satisfies PatchRiskReport);

    expect(html).toContain('collectNormalizedCommands');
    expect(html).toContain(`const topCommandLimit = ${TEST_COMMAND_BATCH_LIMIT}`);
    expect(html).toContain('collectNormalizedCommands(report.topTests.map(test => test.command), topCommandLimit)');
    expect(html).toContain('new Set()');
  });

  it('uses sendWebviewMessage for risk report webview actions', () => {
    const html = renderPatchRiskReportHtml({
      decision: 'warn',
      changedTargets: ['OrderService.findOrders'],
      impactedEndpoints: ['GET /orders'],
      topTests: [],
      trust: { level: 'medium', score: 61 },
      unresolvedCalls: 3,
      reasons: ['Medium trust report; validate risky paths before merging.'],
      markdown: 'Decision: WARN',
    } satisfies PatchRiskReport);

    const messageFnIndex = html.indexOf('function sendWebviewMessage');
    expect(messageFnIndex).toBeGreaterThan(0);
    expect(html).toContain("if (sendWebviewMessage(message)) return;");
    expect(html).toContain('type: WEBVIEW_MESSAGE_TYPES.copyText');
    expect(html).toContain('type: WEBVIEW_MESSAGE_TYPES.runTestCommands');
    expect(html.slice(0, messageFnIndex)).not.toContain('vscodeApi.postMessage');
    expect((html.match(/vscodeApi\.postMessage\(/g) || []).length).toBe(2);
  });

  it('validates webview action payloads inside risk report sendWebviewMessage before posting', () => {
    const html = renderPatchRiskReportHtml({
      decision: 'warn',
      changedTargets: ['OrderService.findOrders'],
      impactedEndpoints: ['GET /orders'],
      topTests: [],
      trust: { level: 'medium', score: 61 },
      unresolvedCalls: 3,
      reasons: ['Medium trust report; validate risky paths before merging.'],
      markdown: 'Decision: WARN',
    } satisfies PatchRiskReport);

    expect(html).toContain('if (type === WEBVIEW_MESSAGE_TYPES.copyText)');
    expect(html).toContain('if (typeof message.text !== \'string\') return false;');
    expect(html).toContain('if (type === WEBVIEW_MESSAGE_TYPES.runTestCommands)');
    expect(html).toContain('if (!Array.isArray(message.commands)) return false;');
    expect(html).toContain('if (!commands.length) return false;');
  });
});
