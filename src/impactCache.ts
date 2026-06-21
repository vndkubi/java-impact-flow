import path from 'node:path';
import {
  buildImpactGraph,
  clearImpactGraphAnalyzerCache,
  type BuildImpactGraphOptions,
  type ImpactGraph,
} from './impactGraph.js';

export interface ImpactGraphCacheResult {
  graph: ImpactGraph;
  cacheHit: boolean;
  cacheKey: string;
  durationMs: number;
  analyzerDurationMs: number;
  cachedAt: string;
}

export interface ImpactGraphCacheStats {
  hits: number;
  misses: number;
  size: number;
}

interface CachedImpactGraph {
  root: string;
  graph: ImpactGraph;
  cacheKey: string;
  analyzerDurationMs: number;
  cachedAt: string;
}

type ImpactGraphBuilder = (options: BuildImpactGraphOptions) => Promise<ImpactGraph>;

export class ImpactGraphCache {
  private readonly entries = new Map<string, CachedImpactGraph>();
  private hits = 0;
  private misses = 0;

  constructor(private readonly builder: ImpactGraphBuilder = buildImpactGraph) {}

  async getGraph(options: BuildImpactGraphOptions): Promise<ImpactGraphCacheResult> {
    const normalized = normalizeImpactGraphOptions(options);
    const cacheKey = impactGraphCacheKey(normalized);
    const started = nowMs();
    const cached = this.entries.get(cacheKey);
    if (cached) {
      this.hits++;
      return {
        graph: cached.graph,
        cacheHit: true,
        cacheKey,
        durationMs: roundMs(nowMs() - started),
        analyzerDurationMs: cached.analyzerDurationMs,
        cachedAt: cached.cachedAt,
      };
    }

    this.misses++;
    const graph = await this.builder(normalized);
    const analyzerDurationMs = roundMs(nowMs() - started);
    const cachedAt = new Date().toISOString();
    this.entries.set(cacheKey, {
      root: normalized.root,
      graph,
      cacheKey,
      analyzerDurationMs,
      cachedAt,
    });
    return {
      graph,
      cacheHit: false,
      cacheKey,
      durationMs: analyzerDurationMs,
      analyzerDurationMs,
      cachedAt,
    };
  }

  invalidateRoot(root: string): void {
    const normalizedRoot = path.resolve(root);
    for (const [key, entry] of this.entries) {
      if (entry.root === normalizedRoot) this.entries.delete(key);
    }
    clearImpactGraphAnalyzerCache(normalizedRoot);
  }

  clear(): void {
    this.entries.clear();
    clearImpactGraphAnalyzerCache();
  }

  stats(): ImpactGraphCacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.entries.size,
    };
  }
}

export function impactGraphCacheKey(options: Required<BuildImpactGraphOptions>): string {
  return JSON.stringify(options);
}

export function normalizeImpactGraphOptions(options: BuildImpactGraphOptions): Required<BuildImpactGraphOptions> {
  return {
    root: path.resolve(options.root),
    target: options.target.trim(),
    mode: options.mode ?? 'references',
    maxFiles: options.maxFiles ?? 0,
    maxFileBytes: options.maxFileBytes ?? 300_000,
    maxNodes: options.maxNodes ?? 160,
    maxEdges: options.maxEdges ?? 320,
    maxDepth: options.maxDepth ?? 0,
    includeTests: options.includeTests ?? true,
  };
}

function nowMs(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function roundMs(value: number): number {
  return Math.max(0, Number(value.toFixed(3)));
}
