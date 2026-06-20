import type { FlowStep, ImpactGraph } from './impactGraph.js';

export interface ImpactDiagnosticItem {
  file: string;
  line: number;
  message: string;
  source: 'Java Impact Flow';
}

const DIAGNOSTIC_KINDS = new Set<FlowStep['kind']>(['call', 'lambda', 'method_reference']);

export function diagnosticItemsForImpactGraph(graph: ImpactGraph): ImpactDiagnosticItem[] {
  const items: ImpactDiagnosticItem[] = [];
  const seen = new Set<string>();
  for (const flow of graph.flows ?? []) {
    for (const step of flow.steps ?? []) {
      if (!DIAGNOSTIC_KINDS.has(step.kind) || step.confidence >= 0.7) continue;
      const key = `${step.file}\0${step.line}\0${step.kind}\0${step.label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        file: step.file,
        line: step.line,
        message: `Java Impact Flow unresolved ${friendlyKind(step.kind)}: ${step.label} (${Math.round(step.confidence * 100)}% confidence)`,
        source: 'Java Impact Flow',
      });
    }
  }
  return items;
}

function friendlyKind(kind: FlowStep['kind']): string {
  return kind === 'method_reference' ? 'method reference' : kind;
}
