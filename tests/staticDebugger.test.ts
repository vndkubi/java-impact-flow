import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildImpactGraph } from '../src/impactGraph.js';
import { renderImpactGraphHtml } from '../src/render.js';
import { buildStaticDebugSessions, staticDebugMarkdown } from '../src/staticDebugger.js';

describe('static debugger', () => {
  it('builds ordered static debug steps from an endpoint flow', async () => {
    const graph = await buildImpactGraph({
      root: path.resolve('validation/fixtures/spring-orders'),
      target: 'OrderService.findOrders',
      mode: 'api-flow',
      maxFiles: 0,
      maxDepth: 6,
    });

    const sessions = buildStaticDebugSessions(graph);
    const session = sessions[0];

    expect(session?.label).toBe('GET /orders');
    expect(session?.summary.staticWarning).toContain('Static path only');
    expect(session?.summary.totalSteps).toBeGreaterThanOrEqual(5);
    expect(session?.summary.unresolvedSteps).toBe(0);
    expect(session?.steps.map(step => step.title)).toEqual(expect.arrayContaining([
      'Enter GET /orders',
      'Handle in OrderController.listOrders',
      'Call service.findOrders()',
      'Handle in OrderService.findOrders',
      'Call repository.findAll()',
      'Handle in OrderRepository.findAll',
    ]));
    expect(session?.steps[0]).toEqual(expect.objectContaining({
      kind: 'entry',
      why: 'Endpoint annotation maps this request to the handler.',
      confidenceLabel: 'high',
    }));

    const markdown = staticDebugMarkdown(session);
    expect(markdown).toContain('Static Debug: GET /orders');
    expect(markdown).toContain('Why: Endpoint annotation maps this request to the handler.');
    expect(markdown).toContain('OrderRepository.java');
  });

  it('renders the static debugger tab and controls in the impact webview', async () => {
    const graph = await buildImpactGraph({
      root: path.resolve('validation/fixtures/spring-orders'),
      target: 'OrderService.findOrders',
      mode: 'api-flow',
      maxFiles: 0,
      maxDepth: 6,
    });

    const html = renderImpactGraphHtml(graph, { initialTab: 'static-debug' });

    expect(html).toContain('data-tab="static-debug"');
    expect(html).toContain('Static Debugger');
    expect(html).toContain('debugNextStep');
    expect(html).toContain('copyStaticDebugTrace');
    expect(html).toContain('staticDebuggerSessions');
    expect(html).toContain('Static path only: this is possible source flow, not one runtime scenario.');
    expect(html).toContain('"title":"Enter GET /orders"');
  });
});
