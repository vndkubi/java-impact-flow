import type { PatchRiskReport } from './riskReport.js';

export interface WorkbenchMetrics {
  scanMs: number;
  analyzerMs: number;
  cacheHits: number;
  cacheMisses: number;
  javaFilesScanned: number;
  trust: {
    level: 'high' | 'medium' | 'low';
    score: number;
  };
  unresolvedCalls: number;
}

export interface PatchRiskWorkbenchSnapshot {
  status: 'idle' | 'loading' | 'empty' | 'ready' | 'error';
  generatedAt: string;
  report?: PatchRiskReport;
  metrics?: WorkbenchMetrics;
  message?: string;
}

export interface WorkbenchModelItem {
  id: string;
  label: string;
  description?: string;
  tooltip?: string;
  icon?: string;
  contextValue?: string;
  command?: {
    command: string;
    title: string;
    arguments?: unknown[];
  };
  children?: WorkbenchModelItem[];
}

export function buildWorkbenchItems(snapshot: PatchRiskWorkbenchSnapshot): WorkbenchModelItem[] {
  if (snapshot.status === 'loading') {
    return [messageItem('loading', 'Analyzing current Java patch...', 'sync~spin')];
  }
  if (snapshot.status === 'idle') {
    return [messageItem('idle', snapshot.message ?? 'Refresh to analyze the current Java patch.', 'debug-start')];
  }
  if (snapshot.status === 'empty') {
    return [messageItem('empty', snapshot.message ?? 'No changed Java files in Git status.', 'pass')];
  }
  if (snapshot.status === 'error' || !snapshot.report || !snapshot.metrics) {
    return [messageItem('error', snapshot.message ?? 'Patch risk analysis failed.', 'error')];
  }

  const report = snapshot.report;
  const metrics = snapshot.metrics;
  const decision = report.decision.toUpperCase();
  const summaryDescription = [
    `Trust ${metrics.trust.level} ${metrics.trust.score}`,
    `${formatMs(metrics.scanMs)}ms`,
    `${metrics.javaFilesScanned} files`,
    `${metrics.unresolvedCalls} unresolved`,
  ].join(' | ');

  return [
    {
      id: 'summary',
      label: `Patch Risk: ${decision}`,
      description: summaryDescription,
      tooltip: `Generated ${snapshot.generatedAt}`,
      icon: decisionIcon(report.decision),
      contextValue: 'javaImpactFlow.summary',
      children: [
        metricItem('scan', 'Scan', `${formatMs(metrics.scanMs)}ms`),
        metricItem('analyzer', 'Analyzer', `${formatMs(metrics.analyzerMs)}ms`),
        metricItem('cache', 'Cache', `${metrics.cacheHits} hit / ${metrics.cacheMisses} miss`),
        metricItem('files', 'Java files', String(metrics.javaFilesScanned)),
        metricItem('trust', 'Trust', `${capitalize(metrics.trust.level)} (${metrics.trust.score})`),
        metricItem('unresolved', 'Unresolved calls', String(metrics.unresolvedCalls)),
      ],
    },
    groupItem('changed', 'Changed Targets', report.changedTargets, 'symbol-method'),
    groupItem('endpoints', 'Impacted Endpoints', report.impactedEndpoints, 'globe'),
    {
      id: 'tests',
      label: 'Suggested Tests',
      description: countDescription(report.topTests.length),
      icon: 'beaker',
      contextValue: 'javaImpactFlow.tests',
      children: report.topTests.length
        ? report.topTests.map((test, index) => ({
          id: `test:${index}:${test.className}`,
          label: test.className,
          description: test.command,
          tooltip: test.why,
          icon: 'beaker',
          contextValue: 'javaImpactFlow.test',
        }))
        : [messageItem('tests:none', 'No suggested tests', 'warning')],
    },
    groupItem('reasons', 'Risk Reasons', report.reasons, 'warning'),
  ];
}

function metricItem(id: string, label: string, value: string): WorkbenchModelItem {
  return {
    id: `metric:${id}`,
    label: `${label}: ${value}`,
    icon: 'pulse',
    contextValue: 'javaImpactFlow.metric',
  };
}

function groupItem(id: string, label: string, values: string[], icon: string): WorkbenchModelItem {
  return {
    id,
    label,
    description: countDescription(values.length),
    icon,
    contextValue: `javaImpactFlow.${id}`,
    children: values.length
      ? values.map((value, index) => ({
        id: `${id}:${index}:${value}`,
        label: value,
        icon,
        contextValue: `javaImpactFlow.${id}.item`,
      }))
      : [messageItem(`${id}:none`, 'None', 'dash')],
  };
}

function messageItem(id: string, label: string, icon: string): WorkbenchModelItem {
  return {
    id,
    label,
    icon,
    contextValue: 'javaImpactFlow.message',
  };
}

function countDescription(count: number): string {
  return count === 1 ? '1 item' : `${count} items`;
}

function formatMs(value: number): number {
  return Math.max(0, Math.round(value));
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function decisionIcon(decision: PatchRiskReport['decision']): string {
  if (decision === 'pass') return 'pass-filled';
  if (decision === 'fail') return 'error';
  return 'warning';
}
