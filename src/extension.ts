import fs from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import { diagnosticItemsForImpactGraph } from './diagnostics.js';
import { collectChangedJavaTargets, type ChangedJavaTarget } from './gitChanges.js';
import { buildImpactGraph, type ImpactGraph, type ImpactMode } from './impactGraph.js';
import { findJavaSourceSymbols, impactLensTitle } from './javaSymbols.js';
import { renderImpactGraphHtml } from './render.js';

let impactDiagnostics: vscode.DiagnosticCollection | undefined;

export function activate(context: vscode.ExtensionContext): void {
  impactDiagnostics = vscode.languages.createDiagnosticCollection('java-impact-flow');
  context.subscriptions.push(
    impactDiagnostics,
    vscode.commands.registerCommand('extGraph.showImpactGraph', () => showImpactGraph(false)),
    vscode.commands.registerCommand('extGraph.exportImpactGraph', () => showImpactGraph(true)),
    vscode.commands.registerCommand('extGraph.analyzeCurrentChanges', analyzeCurrentChanges),
    vscode.commands.registerCommand('extGraph.showImpactForTarget', (target: string, mode?: ImpactMode) => showImpactForTarget(target, mode ?? 'patch-impact')),
    vscode.languages.registerCodeLensProvider({ language: 'java', scheme: 'file' }, new ImpactCodeLensProvider()),
  );
}

export function deactivate(): void {
  // No persistent resources.
}

async function showImpactGraph(exportOnly: boolean): Promise<void> {
  const workspace = workspaceRoot();
  if (!workspace) {
    vscode.window.showErrorMessage('Ext Graph needs an open workspace folder.');
    return;
  }
  const target = await resolveTarget();
  if (!target) return;

  const config = vscode.workspace.getConfiguration('extGraph');
  const mode = await pickMode();
  if (!mode) return;

  const graph = await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Ext Graph: building impact graph for ${target}`,
    cancellable: false,
  }, async () => buildImpactGraph({
    root: workspace,
    target,
    mode,
    maxFiles: config.get<number>('maxFiles') ?? 0,
    maxFileBytes: config.get<number>('maxFileBytes') ?? 300_000,
    maxDepth: config.get<number>('maxDepth') ?? 0,
    includeTests: config.get<boolean>('includeTests') ?? true,
  }));

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

  const config = vscode.workspace.getConfiguration('extGraph');
  const graph = await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Java Impact Flow: analyzing current change ${picked.target}`,
    cancellable: false,
  }, async () => buildImpactGraph({
    root: workspace,
    target: picked.target,
    mode: 'patch-impact',
    maxFiles: config.get<number>('maxFiles') ?? 0,
    maxFileBytes: config.get<number>('maxFileBytes') ?? 300_000,
    maxDepth: config.get<number>('maxDepth') ?? 0,
    includeTests: config.get<boolean>('includeTests') ?? true,
  }));

  const panel = vscode.window.createWebviewPanel(
    'extGraphImpact',
    `Current Change: ${picked.target}`,
    vscode.ViewColumn.Beside,
    { enableScripts: true },
  );
  openImpactPanel(workspace, panel, graph);
}

async function showImpactForTarget(target: string, mode: ImpactMode): Promise<void> {
  const workspace = workspaceRoot();
  if (!workspace) {
    vscode.window.showErrorMessage('Java Impact Flow needs an open workspace folder.');
    return;
  }
  const config = vscode.workspace.getConfiguration('extGraph');
  const graph = await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: `Java Impact Flow: building impact graph for ${target}`,
    cancellable: false,
  }, async () => buildImpactGraph({
    root: workspace,
    target,
    mode,
    maxFiles: config.get<number>('maxFiles') ?? 0,
    maxFileBytes: config.get<number>('maxFileBytes') ?? 300_000,
    maxDepth: config.get<number>('maxDepth') ?? 0,
    includeTests: config.get<boolean>('includeTests') ?? true,
  }));
  const panel = vscode.window.createWebviewPanel(
    'extGraphImpact',
    `Impact: ${target}`,
    vscode.ViewColumn.Beside,
    { enableScripts: true },
  );
  openImpactPanel(workspace, panel, graph);
}

function openImpactPanel(workspace: string, panel: vscode.WebviewPanel, graph: ImpactGraph): void {
  panel.webview.html = renderImpactGraphHtml(graph);
  panel.webview.onDidReceiveMessage(async message => {
    await handleWebviewMessage(workspace, graph, message);
  });
}

async function handleWebviewMessage(workspace: string, graph: ImpactGraph, message: unknown): Promise<void> {
  if (!message || typeof message !== 'object') return;
  const record = message as Record<string, unknown>;
  if (record.type === 'openLocation') {
    await openLocation(workspace, record.file, record.line);
    return;
  }
  if (record.type === 'copyText' && typeof record.text === 'string') {
    await vscode.env.clipboard.writeText(record.text);
    return;
  }
  if (record.type === 'runTestCommand' && typeof record.command === 'string') {
    runTestCommand(workspace, record.command);
    return;
  }
  if (record.type === 'runTestCommands' && Array.isArray(record.commands)) {
    for (const command of record.commands) {
      if (typeof command === 'string') runTestCommand(workspace, command);
    }
    return;
  }
  if (record.type === 'publishDiagnostics') {
    publishImpactDiagnostics(workspace, graph);
  }
}

function runTestCommand(workspace: string, command: string): void {
  if (command.startsWith('Run test class:')) {
    vscode.window.showInformationMessage(command);
    return;
  }
  const terminal = vscode.window.createTerminal({ name: 'Java Impact Flow Tests', cwd: workspace });
  terminal.sendText(command);
  terminal.show();
}

function publishImpactDiagnostics(workspace: string, graph: ImpactGraph): void {
  const diagnostics = diagnosticItemsForImpactGraph(graph);
  impactDiagnostics?.clear();
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
  if (typeof file !== 'string' || file.trim().length === 0) return;
  const requested = path.isAbsolute(file) ? path.normalize(file) : path.resolve(workspace, file);
  const workspaceRoot = path.resolve(workspace);
  const relative = path.relative(workspaceRoot, requested);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    vscode.window.showWarningMessage(`Ext Graph refused to open a path outside the workspace: ${file}`);
    return;
  }

  const lineNumber = typeof line === 'number' && Number.isFinite(line) ? Math.max(0, Math.floor(line) - 1) : 0;
  const document = await vscode.workspace.openTextDocument(vscode.Uri.file(requested));
  const editor = await vscode.window.showTextDocument(document, vscode.ViewColumn.One, false);
  const position = new vscode.Position(Math.min(lineNumber, Math.max(0, document.lineCount - 1)), 0);
  editor.selection = new vscode.Selection(position, position);
  editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
}

function workspaceRoot(): string | undefined {
  const editorUri = vscode.window.activeTextEditor?.document.uri;
  const folder = editorUri ? vscode.workspace.getWorkspaceFolder(editorUri) : vscode.workspace.workspaceFolders?.[0];
  return folder?.uri.fsPath;
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
        const graph = await buildImpactGraph({
          root,
          target: symbol.target,
          mode: 'patch-impact',
          maxFiles: config.get<number>('maxFiles') ?? 0,
          maxFileBytes: config.get<number>('maxFileBytes') ?? 300_000,
          maxDepth: config.get<number>('maxDepth') ?? 0,
          includeTests: config.get<boolean>('includeTests') ?? true,
        });
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
