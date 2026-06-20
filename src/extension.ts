import fs from 'node:fs';
import path from 'node:path';
import * as vscode from 'vscode';
import { buildImpactGraph, type ImpactMode } from './impactGraph.js';
import { renderImpactGraphHtml } from './render.js';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('extGraph.showImpactGraph', () => showImpactGraph(false)),
    vscode.commands.registerCommand('extGraph.exportImpactGraph', () => showImpactGraph(true)),
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
  panel.webview.html = renderImpactGraphHtml(graph);
  panel.webview.onDidReceiveMessage(async message => {
    if (message?.type === 'openLocation') {
      await openLocation(workspace, message.file, message.line);
      return;
    }
    if (message?.type === 'copyText' && typeof message.text === 'string') {
      await vscode.env.clipboard.writeText(message.text);
    }
  });
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
