import type { FlowStep, ImpactGraph } from './impactGraph.js';

export interface ImpactDiagnosticItem {
  file: string;
  line: number;
  message: string;
  source: 'Java Impact Flow';
}

const DIAGNOSTIC_KINDS = new Set<FlowStep['kind']>(['call', 'lambda', 'method_reference']);

export function diagnosticItemsForImpactGraph(graph: ImpactGraph): ImpactDiagnosticItem[] {
  if (!graph || typeof graph !== 'object') return [];
  const items: ImpactDiagnosticItem[] = [];
  const seen = new Set<string>();
  for (const flow of graph.flows ?? []) {
    const steps = Array.isArray(flow?.steps) ? flow.steps : [];
    for (const step of steps) {
      if (!step || typeof step !== 'object') continue;
      const candidate = step as Partial<FlowStep>;
      if (typeof candidate.kind !== 'string') continue;
      if (!DIAGNOSTIC_KINDS.has(candidate.kind)) continue;
      if (!isLowConfidenceDiagnostic(candidate.kind, candidate.confidence, candidate.line, candidate.file)) {
        continue;
      }
      const line = typeof candidate.line === 'number' ? Math.trunc(candidate.line) : NaN;
      if (!Number.isFinite(line)) continue;
      const file = typeof candidate.file === 'string' && candidate.file.trim().length > 0 ? candidate.file : undefined;
      if (!file) continue;
      const confidence = candidate.confidence;
      const label = typeof candidate.label === 'string' ? candidate.label : '';
      const key = `${file}\0${line}\0${candidate.kind}\0${label}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        file,
        line,
        message: `Java Impact Flow unresolved ${friendlyKind(candidate.kind)}: ${label} (${Math.round(confidence * 100)}% confidence)`,
        source: 'Java Impact Flow',
      });
    }
  }
  return items;
}

function isLowConfidenceDiagnostic(
  kind: FlowStep['kind'],
  confidence: unknown,
  line: unknown,
  file: unknown,
): confidence is number {
  if (!DIAGNOSTIC_KINDS.has(kind)) return false;
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return false;
  if (confidence < 0 || confidence >= 0.7) return false;
  if (typeof line !== 'number' || !Number.isFinite(line)) return false;
  if (typeof file !== 'string' || file.trim().length === 0) return false;
  return true;
}

function friendlyKind(kind: FlowStep['kind']): string {
  return kind === 'method_reference' ? 'method reference' : kind;
}
