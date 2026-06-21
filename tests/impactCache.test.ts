import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ImpactGraphCache } from '../src/impactCache.js';

describe('ImpactGraphCache', () => {
  it('reuses a graph for the same analyzer key and invalidates by root', async () => {
    const root = path.resolve('validation/fixtures/spring-orders');
    const cache = new ImpactGraphCache();
    const options = {
      root,
      target: 'OrderService.findOrders',
      mode: 'patch-impact' as const,
      maxFiles: 0,
      maxDepth: 0,
    };

    const cold = await cache.getGraph(options);
    const warm = await cache.getGraph(options);

    expect(cold.cacheHit).toBe(false);
    expect(warm.cacheHit).toBe(true);
    expect(warm.graph.metadata.target).toBe('OrderService.findOrders');
    expect(cache.stats()).toEqual({ hits: 1, misses: 1, size: 1 });

    cache.invalidateRoot(root);
    const afterInvalidation = await cache.getGraph(options);

    expect(afterInvalidation.cacheHit).toBe(false);
    expect(cache.stats()).toEqual({ hits: 1, misses: 2, size: 1 });
  });

  it('treats analyzer options as part of the cache key', async () => {
    const root = path.resolve('validation/fixtures/spring-orders');
    const cache = new ImpactGraphCache();

    await cache.getGraph({
      root,
      target: 'OrderService.findOrders',
      mode: 'patch-impact',
      maxFiles: 0,
      includeTests: true,
    });
    const withoutTests = await cache.getGraph({
      root,
      target: 'OrderService.findOrders',
      mode: 'patch-impact',
      maxFiles: 0,
      includeTests: false,
    });

    expect(withoutTests.cacheHit).toBe(false);
    expect(cache.stats()).toEqual({ hits: 0, misses: 2, size: 2 });
  });
});
