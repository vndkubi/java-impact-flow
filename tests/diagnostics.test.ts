import { describe, expect, it } from 'vitest';
import { diagnosticItemsForImpactGraph } from '../src/diagnostics.js';
import type { ImpactGraph } from '../src/impactGraph.js';

describe('impact diagnostics', () => {
  it('creates opt-in diagnostics for unresolved low-confidence flow steps', () => {
    const graph = {
      flows: [{
        steps: [
          {
            id: 'step-1',
            depth: 1,
            kind: 'call',
            label: 'service.load()',
            file: 'src/main/java/example/OrderController.java',
            line: 12,
            target: 'load',
            confidence: 0.48,
          },
          {
            id: 'step-2',
            depth: 1,
            kind: 'call',
            label: 'service.save()',
            file: 'src/main/java/example/OrderController.java',
            line: 14,
            target: 'example.OrderService.save',
            confidence: 0.82,
          },
        ],
      }],
    } as ImpactGraph;

    expect(diagnosticItemsForImpactGraph(graph)).toEqual([
      {
        file: 'src/main/java/example/OrderController.java',
        line: 12,
        message: 'Java Impact Flow unresolved call: service.load() (48% confidence)',
        source: 'Java Impact Flow',
      },
    ]);
  });

  it('ignores malformed steps and requires a valid minimal shape', () => {
    const graph = {
      flows: [
        {
          steps: [
            null,
            undefined,
            123,
            'step',
            { kind: 'call', confidence: 0.5, line: 10, file: '', label: 'ignore' },
            { kind: 'annotation', confidence: 0.4, line: 20, file: 'src/Main.java', label: 'ignored kind' },
            { kind: 'lambda', confidence: NaN, line: 30, file: 'src/Main.java', label: 'bad confidence' },
            { kind: 'lambda', confidence: 0.62, line: '30' as never, file: 'src/Main.java', label: 'bad line' },
            { kind: 'call', confidence: 0.48, line: 44, file: 'src/Main.java', label: 'good' },
          ],
        } as never,
      ],
    } as ImpactGraph;

    expect(diagnosticItemsForImpactGraph(graph)).toEqual([
      {
        file: 'src/Main.java',
        line: 44,
        message: 'Java Impact Flow unresolved call: good (48% confidence)',
        source: 'Java Impact Flow',
      },
    ]);
  });

  it('ignores low-confidence diagnostics with confidence outside [0, 1) range', () => {
    const graph = {
      flows: [{
        steps: [
          { kind: 'call', confidence: -0.1, line: 5, file: 'src/Main.java', label: 'bad' },
          { kind: 'lambda', confidence: 1, line: 8, file: 'src/Main.java', label: 'bad' },
          { kind: 'call', confidence: 1.2, line: 12, file: 'src/Main.java', label: 'bad' },
          { kind: 'method_reference', confidence: 0.68, line: 16, file: 'src/Main.java', label: 'good' },
        ],
      }],
    } as ImpactGraph;

    expect(diagnosticItemsForImpactGraph(graph)).toEqual([
      {
        file: 'src/Main.java',
        line: 16,
        message: 'Java Impact Flow unresolved method reference: good (68% confidence)',
        source: 'Java Impact Flow',
      },
    ]);
  });

  it('returns empty diagnostics for non-object graph payloads', () => {
    expect(diagnosticItemsForImpactGraph(null as never)).toEqual([]);
    expect(diagnosticItemsForImpactGraph(undefined as never)).toEqual([]);
    expect(diagnosticItemsForImpactGraph({} as never)).toEqual([]);
  });
});
