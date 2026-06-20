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
});
