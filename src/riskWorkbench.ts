import * as vscode from 'vscode';
import { collectChangedJavaTargets } from './gitChanges.js';
import type { BuildImpactGraphOptions, ImpactGraph } from './impactGraph.js';
import { ImpactGraphCache } from './impactCache.js';
import { buildWorkbenchItems, type PatchRiskWorkbenchSnapshot, type WorkbenchModelItem } from './riskWorkbenchModel.js';
import { buildPatchRiskReport, type PatchRiskReport } from './riskReport.js';

export type AnalyzerOptions = Omit<BuildImpactGraphOptions, 'root' | 'target' | 'mode'>;

export interface RiskWorkbenchProviderOptions {
  cache: ImpactGraphCache;
  getWorkspaceRoot: () => string | undefined;
  getAnalyzerOptions: () => AnalyzerOptions;
  openRiskReport: (workspace: string, report: PatchRiskReport) => void;
  runTestCommand: (workspace: string, command: string) => void;
  copyText: (text: string) => Thenable<void>;
}

export class RiskWorkbenchProvider implements vscode.TreeDataProvider<RiskWorkbenchTreeItem> {
  private readonly didChangeTreeData = new vscode.EventEmitter<RiskWorkbenchTreeItem | undefined>();
  readonly onDidChangeTreeData = this.didChangeTreeData.event;

  private snapshot: PatchRiskWorkbenchSnapshot = {
    status: 'idle',
    generatedAt: new Date().toISOString(),
    message: 'Refresh to analyze the current Java patch.',
  };

  constructor(private readonly options: RiskWorkbenchProviderOptions) {}

  getTreeItem(element: RiskWorkbenchTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: RiskWorkbenchTreeItem): RiskWorkbenchTreeItem[] {
    const children = element?.model.children ?? buildWorkbenchItems(this.snapshot);
    return children.map(item => new RiskWorkbenchTreeItem(item));
  }

  markStale(message = 'Workspace changed. Refresh Java Impact Flow to analyze the latest patch.'): void {
    this.snapshot = {
      status: 'idle',
      generatedAt: new Date().toISOString(),
      message,
    };
    this.didChangeTreeData.fire(undefined);
  }

  async refresh(): Promise<void> {
    const workspace = this.options.getWorkspaceRoot();
    if (!workspace) {
      this.snapshot = {
        status: 'error',
        generatedAt: new Date().toISOString(),
        message: 'Java Impact Flow needs an open workspace folder.',
      };
      this.didChangeTreeData.fire(undefined);
      return;
    }

    this.snapshot = {
      status: 'loading',
      generatedAt: new Date().toISOString(),
    };
    this.didChangeTreeData.fire(undefined);

    const started = nowMs();
    try {
      const targets = await collectChangedJavaTargets(workspace, { maxTargets: 12 });
      if (targets.length === 0) {
        this.snapshot = {
          status: 'empty',
          generatedAt: new Date().toISOString(),
          message: 'No changed Java files in Git status.',
        };
        this.didChangeTreeData.fire(undefined);
        return;
      }

      const analyzerOptions = this.options.getAnalyzerOptions();
      const graphs: ImpactGraph[] = [];
      let cacheHits = 0;
      let cacheMisses = 0;
      let analyzerMs = 0;
      for (const target of targets.slice(0, 8)) {
        const result = await this.options.cache.getGraph({
          root: workspace,
          target: target.target,
          mode: 'patch-impact',
          ...analyzerOptions,
        });
        graphs.push(result.graph);
        if (result.cacheHit) cacheHits++;
        else cacheMisses++;
        analyzerMs += result.durationMs;
      }

      const report = buildPatchRiskReport(targets, graphs);
      this.snapshot = {
        status: 'ready',
        generatedAt: new Date().toISOString(),
        report,
        metrics: {
          scanMs: roundMs(nowMs() - started),
          analyzerMs: roundMs(analyzerMs),
          cacheHits,
          cacheMisses,
          javaFilesScanned: Math.max(0, ...graphs.map(graph => graph.summary.javaFilesScanned)),
          trust: report.trust,
          unresolvedCalls: report.unresolvedCalls,
        },
      };
      this.didChangeTreeData.fire(undefined);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.snapshot = {
        status: 'error',
        generatedAt: new Date().toISOString(),
        message,
      };
      this.didChangeTreeData.fire(undefined);
      vscode.window.showErrorMessage(`Java Impact Flow workbench failed: ${message}`);
    }
  }

  async copyPrSummary(): Promise<void> {
    if (!this.snapshot.report) {
      vscode.window.showInformationMessage('Java Impact Flow has no patch risk report to copy yet.');
      return;
    }
    await this.options.copyText(this.snapshot.report.markdown);
    vscode.window.showInformationMessage('Java Impact Flow copied the patch risk summary.');
  }

  runTopTests(): void {
    const workspace = this.options.getWorkspaceRoot();
    if (!workspace || !this.snapshot.report) {
      vscode.window.showInformationMessage('Java Impact Flow has no suggested tests to run yet.');
      return;
    }
    const commands = [...new Set(this.snapshot.report.topTests.map(test => test.command))].slice(0, 3);
    if (commands.length === 0) {
      vscode.window.showInformationMessage('Java Impact Flow has no suggested tests to run yet.');
      return;
    }
    for (const command of commands) this.options.runTestCommand(workspace, command);
  }

  openRiskReport(): void {
    const workspace = this.options.getWorkspaceRoot();
    if (!workspace || !this.snapshot.report) {
      vscode.window.showInformationMessage('Java Impact Flow has no patch risk report to open yet.');
      return;
    }
    this.options.openRiskReport(workspace, this.snapshot.report);
  }
}

export class RiskWorkbenchTreeItem extends vscode.TreeItem {
  constructor(readonly model: WorkbenchModelItem) {
    super(model.label, model.children?.length ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
    this.id = model.id;
    this.description = model.description;
    this.tooltip = model.tooltip ?? model.description;
    this.contextValue = model.contextValue;
    if (model.icon) this.iconPath = new vscode.ThemeIcon(model.icon);
    if (model.command) this.command = model.command as vscode.Command;
  }
}

function nowMs(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function roundMs(value: number): number {
  return Math.max(0, Number(value.toFixed(3)));
}
