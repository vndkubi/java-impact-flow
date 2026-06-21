import type { FlowStep, ImpactGraph } from './impactGraph.js';

export type StaticDebugStepKind =
  | 'entry'
  | 'handler'
  | 'call'
  | 'callback'
  | 'control'
  | 'result'
  | 'unresolved';

export interface StaticDebugStep {
  id: string;
  flowStepId: string;
  index: number;
  kind: StaticDebugStepKind;
  title: string;
  label: string;
  file: string;
  line: number;
  code?: string;
  target?: string;
  depth: number;
  confidence: number;
  confidenceLabel: 'high' | 'medium' | 'low';
  why: string;
  status: 'resolved' | 'unresolved' | 'marker';
}

export interface StaticDebugSession {
  id: string;
  label: string;
  endpoint?: {
    method: string;
    path: string;
    handler: string;
    file: string;
    line: number;
  };
  steps: StaticDebugStep[];
  summary: {
    totalSteps: number;
    resolvedSteps: number;
    unresolvedSteps: number;
    controlMarkers: number;
    averageConfidence: number;
    staticWarning: string;
  };
}

export function buildStaticDebugSessions(graph: ImpactGraph): StaticDebugSession[] {
  return (graph.flows ?? []).map(flow => {
    const steps = (flow.steps ?? []).map((step, index) => staticDebugStep(step, index));
    const unresolvedSteps = steps.filter(step => step.status === 'unresolved').length;
    const controlMarkers = steps.filter(step => step.kind === 'control' || step.kind === 'result').length;
    const averageConfidence = steps.length
      ? Number((steps.reduce((sum, step) => sum + step.confidence, 0) / steps.length).toFixed(2))
      : 0;
    return {
      id: `static-debug:${flow.id}`,
      label: flow.label,
      endpoint: flow.endpoint,
      steps,
      summary: {
        totalSteps: steps.length,
        resolvedSteps: steps.length - unresolvedSteps - controlMarkers,
        unresolvedSteps,
        controlMarkers,
        averageConfidence,
        staticWarning: 'Static path only: this is possible source flow, not one runtime scenario.',
      },
    };
  });
}

export function staticDebugMarkdown(session: StaticDebugSession | undefined): string {
  if (!session) return 'Static Debugger: no endpoint flow selected.';
  const lines = [
    `Static Debug: ${session.label}`,
    session.summary.staticWarning,
    '',
    `Steps: ${session.summary.totalSteps}`,
    `Resolved: ${session.summary.resolvedSteps}`,
    `Unresolved: ${session.summary.unresolvedSteps}`,
    `Control markers: ${session.summary.controlMarkers}`,
    '',
  ];
  for (const step of session.steps) {
    lines.push(`${step.index}. ${step.title}`);
    lines.push(`   ${step.file}:${step.line}`);
    lines.push(`   Why: ${step.why}`);
    if (step.code) lines.push(`   Code: ${step.code}`);
  }
  return lines.join('\n');
}

function staticDebugStep(step: FlowStep, index: number): StaticDebugStep {
  const status = stepStatus(step);
  const kind = staticKind(step, status);
  return {
    id: `static-step:${step.id}`,
    flowStepId: step.id,
    index: index + 1,
    kind,
    title: stepTitle(step, kind),
    label: step.label,
    file: step.file,
    line: step.line,
    code: step.text,
    target: step.target,
    depth: step.depth,
    confidence: step.confidence,
    confidenceLabel: confidenceLabel(step.confidence),
    why: whyForStep(step, status),
    status,
  };
}

function staticKind(step: FlowStep, status: StaticDebugStep['status']): StaticDebugStepKind {
  if (status === 'unresolved') return 'unresolved';
  if (step.kind === 'endpoint') return 'entry';
  if (step.kind === 'handler') return 'handler';
  if (step.kind === 'call') return 'call';
  if (step.kind === 'lambda' || step.kind === 'method_reference') return 'callback';
  if (step.kind === 'return' || step.kind === 'throw') return 'result';
  return 'control';
}

function stepStatus(step: FlowStep): StaticDebugStep['status'] {
  if ((step.kind === 'call' || step.kind === 'lambda' || step.kind === 'method_reference' || step.kind === 'handler') && step.confidence < 0.6) {
    return 'unresolved';
  }
  if (step.kind === 'branch' || step.kind === 'loop' || step.kind === 'exception' || step.kind === 'return' || step.kind === 'throw') {
    return 'marker';
  }
  return 'resolved';
}

function confidenceLabel(confidence: number): StaticDebugStep['confidenceLabel'] {
  if (confidence >= 0.75) return 'high';
  if (confidence >= 0.6) return 'medium';
  return 'low';
}

function stepTitle(step: FlowStep, kind: StaticDebugStepKind): string {
  if (kind === 'entry') return `Enter ${step.label}`;
  if (kind === 'handler') return `Handle in ${step.label}`;
  if (kind === 'call') return `Call ${step.label}`;
  if (kind === 'callback') return `Follow ${step.label}`;
  if (kind === 'result') return `Exit via ${step.label}`;
  if (kind === 'unresolved') return `Inspect unresolved ${step.label}`;
  return `Observe ${step.label}`;
}

function whyForStep(step: FlowStep, status: StaticDebugStep['status']): string {
  if (status === 'unresolved') {
    return 'The static analyzer found a call-like step but could not uniquely resolve its target.';
  }
  switch (step.kind) {
    case 'endpoint':
      return 'Endpoint annotation maps this request to the handler.';
    case 'handler':
      return 'Handler method was resolved in the scanned Java sources.';
    case 'call':
      return 'Call target was resolved from receiver, field, parameter, or unique method evidence.';
    case 'lambda':
      return 'Lambda callback is part of the endpoint source path.';
    case 'method_reference':
      return 'Method reference callback is part of the endpoint source path.';
    case 'branch':
      return 'Branch marker shows a possible decision point, not a selected runtime branch.';
    case 'loop':
      return 'Loop marker shows repeated execution may happen on this source path.';
    case 'exception':
      return 'Exception marker shows try/catch/finally control flow on this source path.';
    case 'return':
      return 'Return marker shows a possible response exit point.';
    case 'throw':
      return 'Throw marker shows a possible exceptional exit point.';
    default:
      return 'Static source evidence links this step to the selected endpoint flow.';
  }
}
