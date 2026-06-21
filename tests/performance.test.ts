import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runPerformanceBenchmark } from '../src/performance.js';

describe('performance benchmark', () => {
  it('reports cold and warm analyzer timings with threshold results', async () => {
    const result = await runPerformanceBenchmark({
      root: path.resolve('validation/fixtures/spring-orders'),
      target: 'OrderService.findOrders',
      mode: 'patch-impact',
      maxFiles: 0,
      maxDepth: 0,
      thresholds: {
        coldMs: 5_000,
        warmMs: 100,
        minTrustScore: 50,
        maxUnresolvedCalls: 2,
        minEndpoints: 1,
        minSuggestedTests: 1,
      },
    });

    expect(result.passed).toBe(true);
    expect(result.coldCacheHit).toBe(false);
    expect(result.warmCacheHit).toBe(true);
    expect(result.coldMs).toBeGreaterThanOrEqual(0);
    expect(result.warmMs).toBeGreaterThanOrEqual(0);
    expect(result.javaFilesScanned).toBeGreaterThanOrEqual(3);
    expect(result.endpoints).toContain('GET /orders');
    expect(result.suggestedTests.map(test => test.className)).toContain('example.OrderControllerTest');
    expect(result.failures).toEqual([]);
  });

  it('fails when a configured quality threshold is crossed', async () => {
    const result = await runPerformanceBenchmark({
      root: path.resolve('validation/fixtures/spring-orders'),
      target: 'OrderService.findOrders',
      mode: 'patch-impact',
      thresholds: {
        minTrustScore: 101,
      },
    });

    expect(result.passed).toBe(false);
    expect(result.failures.join('\n')).toContain('Trust score');
  });
});
