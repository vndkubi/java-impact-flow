import fs from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import { diagnosticItemsForImpactGraph } from './diagnostics.js';
import { collectChangedJavaTargets, type ChangedJavaTarget } from './gitChanges.js';
import { type ImpactGraph, type ImpactMode } from './impactGraph.js';
import { ImpactGraphCache } from './impactCache.js';
import { findJavaSourceSymbols, impactLensTitle } from './javaSymbols.js';
import { renderImpactGraphHtml, type ImpactViewTab } from './render.js';
import { renderPatchRiskReportHtml } from './renderRiskReport.js';
import { RiskWorkbenchProvider, type AnalyzerOptions } from './riskWorkbench.js';
import { buildPatchRiskReport, type PatchRiskReport } from './riskReport.js';
import { TEST_COMMAND_BATCH_LIMIT, runNormalizedTestCommands } from './testCommandRunner.js';
import { prepareTestCommandForExecution } from './testCommandExecutor.js';
import type { TestCommandRunner } from './testCommandRunner.js';
import {
  asWebviewMessageRecord,
  getWebviewMessageType,
  isImpactMessageType,
  isUtilityMessageType,
  WEBVIEW_MESSAGE_TYPES,
} from './webviewMessageSchema.js';

let impactDiagnostics: vscode.DiagnosticCollection | undefined;
const impactCache = new ImpactGraphCache();
let riskWorkbench: RiskWorkbenchProvider | undefined;
const TEST_TERMINAL_NAME = 'Java Impact Flow Tests';
const TEST_COMMAND_MISSING_WORKSPACE_WARNING = 'Java Impact Flow needs an open workspace folder to run test commands.';
const TEST_COMMAND_MISSING_SINGLE_COMMAND_WARNING = 'Java Impact Flow has no runnable test command to execute.';
const TEST_COMMAND_MISSING_COMMANDS_WARNING = 'Java Impact Flow has no runnable test commands to execute.';
const OPEN_LOCATION_INVALID_FILE_WARNING = 'Java Impact Flow received an invalid file path for openLocation.';
const OPEN_LOCATION_NO_WORKSPACE_WARNING = 'Ext Graph needs an open workspace folder to open files.';
const UNKNOWN_WEBVIEW_MESSAGE_WARNING = 'Java Impact Flow ignored unsupported webview message.';
const INVALID_WEBVIEW_MESSAGE_WARNING = 'Java Impact Flow ignored malformed webview message.';
const UNKNOWN_UTILITY_WEBVIEW_MESSAGE_WARNING = 'Java Impact Flow ignored unsupported risk utility message.';
const INVALID_UTILITY_WEBVIEW_MESSAGE_WARNING = 'Java Impact Flow ignored malformed risk utility message.';

interface SharedTestTerminalState {
  terminal: vscode.Terminal;
  workspace: string;
}

let sharedTestTerminal: SharedTestTerminalState | undefined;

export function activate(context: vscode.ExtensionContext): void {
  impactDiagnostics = vscode.languages.createDiagnosticCollection('java-impact-flow');
  riskWorkbench = new RiskWorkbenchProvider({
    cache: impactCache,
    getWorkspaceRoot: workspaceRoot,
    getAnalyzerOptions: currentAnalyzerOptions,
    openRiskReport: openRiskReportPanel,
    runTestCommand,
    copyText: text => vscode.env.clipboard.writeText(text),
  });
  const javaWatcher = vscode.workspace.createFileSystemWatcher('**/*.java');
  const invalidateAnalysis = () => {
    impactCache.clear();
    riskWorkbench?.markStale();
  };
  context.subscriptions.push(
    impactDiagnostics,
    vscode.window.createTreeView('javaImpactFlowWorkbench', {
      treeDataProvider: riskWorkbench,
      showCollapseAll: true,
    }),
    vscode.commands.registerCommand('extGraph.showImpactGraph', () => showImpactGraph(false)),
    vscode.commands.registerCommand('extGraph.exportImpactGraph', () => showImpactGraph(true)),
    vscode.commands.registerCommand('extGraph.analyzeCurrentChanges', analyzeCurrentChanges),
    vscode.commands.registerCommand('extGraph.staticDebugEndpoint', staticDebugEndpoint),
    vscode.commands.registerCommand('extGraph.checkPatchRisk', checkPatchRisk),
    vscode.commands.registerCommand('extGraph.refreshWorkbench', () => riskWorkbench?.refresh()),
    vscode.commands.registerCommand('extGraph.copyWorkbenchPrSummary', () => riskWorkbench?.copyPrSummary()),
    vscode.commands.registerCommand('extGraph.runWorkbenchTopTests', () => riskWorkbench?.runTopTests()),
    vscode.commands.registerCommand('extGraph.openWorkbenchRiskReport', () => riskWorkbench?.openRiskReport()),
    vscode.commands.registerCommand('extGraph.showImpactForTarget', (target: string, mode?: ImpactMode) => showImpactForTarget(target, mode ?? 'patch-impact')),
    vscode.languages.registerCodeLensProvider({ language: 'java', scheme: 'file' }, new ImpactCodeLensProvider(impactCache)),
    javaWatcher,
    javaWatcher.onDidCreate(invalidateAnalysis),
    javaWatcher.onDidChange(invalidateAnalysis),
    javaWatcher.onDidDelete(invalidateAnalysis),
    vscode.workspace.onDidSaveTextDocument(document => {
      if (document.languageId === 'java' || document.uri.fsPath.endsWith('.java')) invalidateAnalysis();
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (event.affectsConfiguration('extGraph')) invalidateAnalysis();
    }),
  );
}

export function deactivate(): void {
  if (impactDiagnostics) {
    impactDiagnostics.dispose();
    impactDiagnostics = undefined;
  }
  __resetSharedTestTerminalForTests();
}

async function showImpactGraph(exportOnly: boolean): Promise<void> {
  const workspace = workspaceRoot();
  if (!workspace) {
    vscode.window.showErrorMessage('Ext Graph needs an open workspace folder.');
    return;
  }
  const target = await resolveTarget();
  if (!target) return;

  const mode = await pickMode();
  if (!mode) return;

  const result = await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Ext Graph: building impact graph for ${target}`,
    cancellable: false,
  }, async () => impactCache.getGraph({
    root: workspace,
    target,
    mode,
    ...currentAnalyzerOptions(),
  }));
  const graph = result.graph;

  if (exportOnly) {
    const outDir = path.join(workspace, '.ext-graph');
    fs.mkdirSync(outDir, { recursive: true });
    const slug = target.replace(/[^a-z0-9_.-]+/gi, '-').replace(/^-+|-+$/g, '') || 'impact';
    const jsonPath = path.join(outDir, `${slug}.impact.json`);
    const htmlPath = path.join(outDir, `${slug}.impact.html`);
    fs.writeFileSync(jsonPath, JSON.stringify(graph, null, 2), 'utf-8');
    fs.writeFileSync(htmlPath, renderImpactGraphHtml(graph), 'utf-8');
    vscode.window.showInformationMessage(`Ext Graph exported ${path.relative(workspace, jsonPath)} and ${path.relative(workspace, htmlPath)}.`);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    'extGraphImpact',
    `Impact: ${target}`,
    vscode.ViewColumn.Beside,
    { enableScripts: true },
  );
  openImpactPanel(workspace, panel, graph);
}

async function analyzeCurrentChanges(): Promise<void> {
  const workspace = workspaceRoot();
  if (!workspace) {
    vscode.window.showErrorMessage('Java Impact Flow needs an open workspace folder.');
    return;
  }

  const targets = await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Java Impact Flow: scanning changed Java symbols',
    cancellable: false,
  }, async () => collectChangedJavaTargets(workspace, { maxTargets: 20 }));

  if (targets.length === 0) {
    vscode.window.showInformationMessage('Java Impact Flow did not find changed Java files in Git status.');
    return;
  }

  const picked = await pickChangedTarget(targets);
  if (!picked) return;

  const result = await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Java Impact Flow: analyzing current change ${picked.target}`,
    cancellable: false,
  }, async () => impactCache.getGraph({
    root: workspace,
    target: picked.target,
    mode: 'patch-impact',
    ...currentAnalyzerOptions(),
  }));
  const graph = result.graph;

  const panel = vscode.window.createWebviewPanel(
    'extGraphImpact',
    `Current Change: ${picked.target}`,
    vscode.ViewColumn.Beside,
    { enableScripts: true },
  );
  openImpactPanel(workspace, panel, graph);
}

async function staticDebugEndpoint(): Promise<void> {
  const workspace = workspaceRoot();
  if (!workspace) {
    vscode.window.showErrorMessage('Java Impact Flow needs an open workspace folder.');
    return;
  }
  const target = await resolveTarget();
  if (!target) return;

  const result = await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Java Impact Flow: static debugging ${target}`,
    cancellable: false,
  }, async () => impactCache.getGraph({
    root: workspace,
    target,
    mode: 'api-flow',
    ...currentAnalyzerOptions(),
  }));

  const panel = vscode.window.createWebviewPanel(
    'javaImpactFlowStaticDebug',
    `Static Debug: ${target}`,
    vscode.ViewColumn.Beside,
    { enableScripts: true },
  );
  openImpactPanel(workspace, panel, result.graph, 'static-debug');
}

async function checkPatchRisk(): Promise<void> {
  const workspace = workspaceRoot();
  if (!workspace) {
    vscode.window.showErrorMessage('Java Impact Flow needs an open workspace folder.');
    return;
  }
  const targets = await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: 'Java Impact Flow: checking patch risk',
    cancellable: false,
  }, async () => collectChangedJavaTargets(workspace, { maxTargets: 12 }));

  if (targets.length === 0) {
    vscode.window.showInformationMessage('Java Impact Flow did not find changed Java files in Git status.');
    return;
  }

  const graphs: ImpactGraph[] = [];
  for (const target of targets.slice(0, 8)) {
    const result = await impactCache.getGraph({
      root: workspace,
      target: target.target,
      mode: 'patch-impact',
      ...currentAnalyzerOptions(),
    });
    graphs.push(result.graph);
  }

  const report = buildPatchRiskReport(targets, graphs);
  const panel = vscode.window.createWebviewPanel(
    'javaImpactFlowRisk',
    `Patch Risk: ${report.decision.toUpperCase()}`,
    vscode.ViewColumn.Beside,
    { enableScripts: true },
  );
  openRiskPanel(workspace, panel, report);
}

async function showImpactForTarget(target: string, mode: ImpactMode): Promise<void> {
  const workspace = workspaceRoot();
  if (!workspace) {
    vscode.window.showErrorMessage('Java Impact Flow needs an open workspace folder.');
    return;
  }
  const result = await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Java Impact Flow: building impact graph for ${target}`,
    cancellable: false,
  }, async () => impactCache.getGraph({
    root: workspace,
    target,
    mode,
    ...currentAnalyzerOptions(),
  }));
  const graph = result.graph;
  const panel = vscode.window.createWebviewPanel(
    'extGraphImpact',
    `Impact: ${target}`,
    vscode.ViewColumn.Beside,
    { enableScripts: true },
  );
  openImpactPanel(workspace, panel, graph);
}

function openImpactPanel(workspace: string, panel: vscode.WebviewPanel, graph: ImpactGraph, initialTab?: ImpactViewTab): void {
  panel.webview.html = renderImpactGraphHtml(graph, { initialTab });
  panel.webview.onDidReceiveMessage(async message => {
    await handleWebviewMessage(workspace, graph, message);
  });
}

function openRiskPanel(workspace: string, panel: vscode.WebviewPanel, report: PatchRiskReport): void {
  panel.webview.html = renderPatchRiskReportHtml(report);
  panel.webview.onDidReceiveMessage(async message => {
    await handleUtilityWebviewMessage(workspace, message);
  });
}

function openRiskReportPanel(workspace: string, report: PatchRiskReport): void {
  const panel = vscode.window.createWebviewPanel(
    'javaImpactFlowRisk',
    `Patch Risk: ${report.decision.toUpperCase()}`,
    vscode.ViewColumn.Beside,
    { enableScripts: true },
  );
  openRiskPanel(workspace, panel, report);
}

export async function handleWebviewMessage(workspace: string, graph: ImpactGraph | null | undefined, message: unknown): Promise<void> {
  const record = asWebviewMessageRecord(message);
  if (!record) {
    vscode.window.showWarningMessage(INVALID_WEBVIEW_MESSAGE_WARNING);
    return;
  }
  const type = getWebviewMessageType(record);
  if (!type) {
    vscode.window.showWarningMessage(INVALID_WEBVIEW_MESSAGE_WARNING);
    return;
  }
  if (!isImpactMessageType(type)) {
    vscode.window.showWarningMessage(`${UNKNOWN_WEBVIEW_MESSAGE_WARNING} ${type}`);
    return;
  }
  if (type === WEBVIEW_MESSAGE_TYPES.openLocation) {
    await openLocation(workspace, record.file, record.line);
    return;
  }
  if (type === WEBVIEW_MESSAGE_TYPES.copyText && typeof record.text === 'string') {
    await vscode.env.clipboard.writeText(record.text);
    return;
  }
  if (type === WEBVIEW_MESSAGE_TYPES.runTestCommand) {
    handleRunTestMessage(
      workspace,
      type,
      record,
      runTestCommand,
      () => vscode.window.showInformationMessage(TEST_COMMAND_MISSING_SINGLE_COMMAND_WARNING),
      () => vscode.window.showInformationMessage(TEST_COMMAND_MISSING_COMMANDS_WARNING),
    );
    return;
  }
  if (type === WEBVIEW_MESSAGE_TYPES.runTestCommands) {
    handleRunTestMessage(
      workspace,
      type,
      record,
      runTestCommand,
      () => vscode.window.showInformationMessage(TEST_COMMAND_MISSING_SINGLE_COMMAND_WARNING),
      () => vscode.window.showInformationMessage(TEST_COMMAND_MISSING_COMMANDS_WARNING),
    );
    return;
  }
  if (type === WEBVIEW_MESSAGE_TYPES.publishDiagnostics) {
    publishImpactDiagnostics(workspace, graph);
    return;
  }
  vscode.window.showWarningMessage(`${UNKNOWN_WEBVIEW_MESSAGE_WARNING} ${type}`);
}

export async function handleUtilityWebviewMessage(workspace: string, message: unknown): Promise<void> {
  const record = asWebviewMessageRecord(message);
  if (!record) {
    vscode.window.showWarningMessage(INVALID_UTILITY_WEBVIEW_MESSAGE_WARNING);
    return;
  }
  const type = getWebviewMessageType(record);
  if (!type) {
    vscode.window.showWarningMessage(INVALID_UTILITY_WEBVIEW_MESSAGE_WARNING);
    return;
  }
  if (type === WEBVIEW_MESSAGE_TYPES.publishDiagnostics) {
    vscode.window.showWarningMessage('Java Impact Flow ignored risk utility publish diagnostics message.');
    return;
  }
  if (!isUtilityMessageType(type)) {
    vscode.window.showWarningMessage(`${UNKNOWN_UTILITY_WEBVIEW_MESSAGE_WARNING} ${type}`);
    return;
  }
  if (type === WEBVIEW_MESSAGE_TYPES.copyText && typeof record.text === 'string') {
    await vscode.env.clipboard.writeText(record.text);
    return;
  }
  if (type === WEBVIEW_MESSAGE_TYPES.runTestCommands) {
  handleRunTestMessage(
      workspace,
      type,
      record,
      runTestCommand,
      () => vscode.window.showInformationMessage(TEST_COMMAND_MISSING_SINGLE_COMMAND_WARNING),
      () => vscode.window.showInformationMessage(TEST_COMMAND_MISSING_COMMANDS_WARNING),
  );
  return;
  }
  vscode.window.showWarningMessage(`${UNKNOWN_UTILITY_WEBVIEW_MESSAGE_WARNING} ${type}`);
}

function handleRunTestMessage(
  workspace: string,
  type: typeof WEBVIEW_MESSAGE_TYPES.runTestCommand | typeof WEBVIEW_MESSAGE_TYPES.runTestCommands,
  message: Record<string, unknown>,
  runTestCommand: TestCommandRunner,
  onNoCommand: () => void,
  onNoCommands: () => void,
): void {
  if (!workspace) {
    vscode.window.showWarningMessage(TEST_COMMAND_MISSING_WORKSPACE_WARNING);
    return;
  }
  if (type === WEBVIEW_MESSAGE_TYPES.runTestCommand) {
    handleRunSingleTestCommandMessage(workspace, message.command, runTestCommand, onNoCommand);
    return;
  }
  if (!Array.isArray(message.commands)) {
    onNoCommands();
    return;
  }
  handleRunTestCommandsMessage(workspace, message.commands, runTestCommand, onNoCommands);
}

export function handleRunTestCommandsMessage(
  workspace: string,
  commands: unknown,
  runTestCommand: TestCommandRunner,
  onNoCommands: () => void,
  maxCommands: number = TEST_COMMAND_BATCH_LIMIT,
): number {
  if (!Array.isArray(commands)) return 0;
  return runNormalizedTestCommands(workspace, commands, runTestCommand, maxCommands, onNoCommands);
}

export function handleRunSingleTestCommandMessage(
  workspace: string,
  command: unknown,
  runTestCommand: TestCommandRunner,
  onNoCommand?: () => void,
): number {
  if (typeof command !== 'string') {
    if (onNoCommand) onNoCommand();
    return 0;
  }
  return runNormalizedTestCommands(workspace, [command], runTestCommand, 1, onNoCommand);
}

function runTestCommand(workspace: string, command: string): void {
  const execution = prepareTestCommandForExecution(command);
  if (execution.mode === 'ignore') return;
  if (execution.mode === 'information') {
    vscode.window.showInformationMessage(execution.command);
    return;
  }
  const terminal = getSharedTestTerminal(workspace);
  terminal.sendText(execution.command);
  terminal.show();
}

function getSharedTestTerminal(workspace: string): vscode.Terminal {
  const stale = sharedTestTerminal;
  if (stale && stale.workspace === workspace && !isTerminalClosed(stale.terminal)) {
    return stale.terminal;
  }
  stale?.terminal?.dispose();
  const terminal = vscode.window.createTerminal({ name: TEST_TERMINAL_NAME, cwd: workspace });
  sharedTestTerminal = { terminal, workspace };
  return terminal;
}

function isTerminalClosed(terminal: vscode.Terminal): boolean {
  return terminal.exitStatus !== undefined;
}

export function __resetSharedTestTerminalForTests(): void {
  const stale = sharedTestTerminal;
  sharedTestTerminal = undefined;
  stale?.terminal?.dispose();
}

function publishImpactDiagnostics(workspace: string, graph: ImpactGraph | null | undefined): void {
  if (!workspace) {
    vscode.window.showWarningMessage('Java Impact Flow needs an open workspace folder to publish diagnostics.');
    return;
  }
  impactDiagnostics?.clear();
  if (!graph || typeof graph !== 'object' || !Array.isArray(graph.flows)) {
    vscode.window.showWarningMessage('Java Impact Flow has no impact graph data to publish diagnostics.');
    return;
  }
  const diagnostics = diagnosticItemsForImpactGraph(graph);
  const byFile = new Map<string, vscode.Diagnostic[]>();
  for (const item of diagnostics) {
    const line = Math.max(0, item.line - 1);
    const range = new vscode.Range(line, 0, line, 1);
    const diagnostic = new vscode.Diagnostic(range, item.message, vscode.DiagnosticSeverity.Warning);
    diagnostic.source = item.source;
    byFile.set(item.file, [...(byFile.get(item.file) ?? []), diagnostic]);
  }
  for (const [file, items] of byFile) {
    impactDiagnostics?.set(vscode.Uri.file(path.resolve(workspace, file)), items);
  }
  vscode.window.showInformationMessage(diagnostics.length
    ? `Java Impact Flow published ${diagnostics.length} diagnostic(s).`
    : 'Java Impact Flow found no low-confidence unresolved flow steps to publish.');
}

async function openLocation(workspace: string, file: unknown, line: unknown): Promise<void> {
  if (!workspace) {
    vscode.window.showWarningMessage(OPEN_LOCATION_NO_WORKSPACE_WARNING);
    return;
  }
  if (typeof file !== 'string' || file.trim().length === 0) {
    vscode.window.showWarningMessage(OPEN_LOCATION_INVALID_FILE_WARNING);
    return;
  }
  const requested = path.isAbsolute(file) ? path.normalize(file) : path.resolve(workspace, file);
  const workspaceRoot = path.resolve(workspace);
  const relative = path.relative(workspaceRoot, requested);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    vscode.window.showWarningMessage(`Ext Graph refused to open a path outside the workspace: ${file}`);
    return;
  }

  const lineNumber = typeof line === 'number' && Number.isFinite(line) ? Math.max(0, Math.floor(line) - 1) : 0;
  try {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(requested));
    const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One, false);
    const position = new vscode.Position(Math.min(lineNumber, Math.max(0, document.lineCount - 1)), 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    vscode.window.showWarningMessage(`Ext Graph could not open file ${file}: ${message}`);
  }
}

function workspaceRoot(): string | undefined {
  const editorUri = vscode.window.activeTextEditor?.document.uri;
  const folder = editorUri ? vscode.workspace.getWorkspaceFolder(editorUri) : vscode.workspace.workspaceFolders?.[0];
  return folder?.uri.fsPath;
}

function currentAnalyzerOptions(uri?: vscode.Uri): AnalyzerOptions {
  const config = vscode.workspace.getConfiguration('extGraph', uri);
  return {
    maxFiles: config.get<number>('maxFiles') ?? 0,
    maxFileBytes: config.get<number>('maxFileBytes') ?? 300_000,
    maxDepth: config.get<number>('maxDepth') ?? 0,
    includeTests: config.get<boolean>('includeTests') ?? true,
  };
}

async function resolveTarget(): Promise<string | undefined> {
  const editor = vscode.window.activeTextEditor;
  const selected = editor ? editor.document.getText(editor.selection).trim() : '';
  const word = editor && selected.length === 0
    ? editor.document.getText(editor.document.getWordRangeAtPosition(editor.selection.active))
    : '';
  return await vscode.window.showInputBox({
    title: 'Ext Graph target',
    prompt: 'Java class, method, or field to visualize',
    value: selected || word,
    ignoreFocusOut: true,
  });
}

async function pickMode(): Promise<ImpactMode | undefined> {
  const picked = await vscode.window.showQuickPick([
    { label: 'references', description: 'Definitions, reads/writes, tests, and representative usages' },
    { label: 'call', description: 'Caller-like edges around method references' },
    { label: 'api-flow', description: 'Endpoint and handler-adjacent impact view' },
    { label: 'patch-impact', description: 'Blast-radius-style graph for planned edits' },
  ], {
    title: 'Ext Graph mode',
    ignoreFocusOut: true,
  });
  return picked?.label as ImpactMode | undefined;
}

async function pickChangedTarget(targets: ChangedJavaTarget[]): Promise<ChangedJavaTarget | undefined> {
  if (targets.length === 1) return targets[0];
  const picked = await vscode.window.showQuickPick(targets.map(target => ({
    label: target.target,
    description: `${target.kind} - ${target.file}:${target.line}`,
    detail: target.reason,
    target,
  })), {
    title: 'Java Impact Flow: changed Java symbol',
    placeHolder: 'Pick a changed symbol to analyze',
    ignoreFocusOut: true,
  });
  return picked?.target;
}

class ImpactCodeLensProvider implements vscode.CodeLensProvider {
  constructor(private readonly cache: ImpactGraphCache) {}

  async provideCodeLenses(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.CodeLens[]> {
    const folder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!folder) return [];
    const config = vscode.workspace.getConfiguration('extGraph', document.uri);
    if (config.get<boolean>('enableCodeLens') === false) return [];
    const root = folder.uri.fsPath;
    const relativeFile = path.relative(root, document.uri.fsPath).replace(/\\/g, '/');
    const maxSymbols = Math.max(1, Math.min(config.get<number>('codeLensMaxSymbols') ?? 6, 20));
    const symbols = findJavaSourceSymbols(relativeFile, document.getText()).slice(0, maxSymbols);
    const lenses: vscode.CodeLens[] = [];
    for (const symbol of symbols) {
      if (token.isCancellationRequested) break;
      let title = 'Impact: show report';
      try {
        const result = await this.cache.getGraph({
          root,
          target: symbol.target,
          mode: 'patch-impact',
          ...currentAnalyzerOptions(document.uri),
        });
        const graph = result.graph;
        title = impactLensTitle({
          endpoints: graph.summary.endpoints,
          tests: graph.summary.tests,
          references: graph.summary.references,
        });
      } catch {
        title = 'Impact: show report';
      }
      const line = Math.max(0, symbol.line - 1);
      lenses.push(new vscode.CodeLens(new vscode.Range(line, 0, line, 0), {
        title,
        command: 'extGraph.showImpactForTarget',
        arguments: [symbol.target, 'patch-impact'],
      }));
    }
    return lenses;
  }
}
