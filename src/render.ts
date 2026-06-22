import fs from 'node:fs';
import type { ImpactGraph } from './impactGraph.js';
import { buildStaticDebugSessions } from './staticDebugger.js';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  buildTestCommandsByFile,
  isTestFile,
  normalizeTestFilePath,
  testClassNameFromFile,
} from './testCommand.js';
import { TEST_COMMAND_BATCH_LIMIT } from './testCommandRunner.js';
import { webviewMessageTypesJs, webviewNormalizedCommandsJs } from './webviewMessageSnippets.js';

export type ImpactViewTab = 'sequence' | 'static-debug' | 'references' | 'graph';

export interface RenderImpactGraphOptions {
  initialTab?: ImpactViewTab;
  productVersion?: string;
}

export function renderImpactGraphHtml(graph: ImpactGraph, options: RenderImpactGraphOptions = {}): string {
  const data = safeJsonForHtml(graph);
  const staticDebuggerData = safeJsonForHtml(buildStaticDebugSessions(graph));
  const testCommandsByFile = safeJsonForHtml(buildTestCommandsByFile(graph));
  const initialTab = safeJsonForHtml(options.initialTab ?? 'sequence');
  const productVersion = formatVersionLabel(resolveManifestVersion(options.productVersion));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Ext Graph Impact View</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: var(--vscode-editor-background, #0f1117);
      --panel: var(--vscode-sideBar-background, #151923);
      --panel-2: var(--vscode-editorWidget-background, #1b2130);
      --panel-3: var(--vscode-input-background, #111722);
      --text: var(--vscode-foreground, #e7edf6);
      --muted: var(--vscode-descriptionForeground, #9aa6b8);
      --subtle: var(--vscode-disabledForeground, #6d7787);
      --border: var(--vscode-panel-border, #2a3343);
      --border-strong: var(--vscode-focusBorder, #3d8f88);
      --target: #2dd4bf;
      --symbol: #a78bfa;
      --method: #c084fc;
      --file: #60a5fa;
      --test: #f59e0b;
      --endpoint: #f472b6;
      --callback: #22d3ee;
      --annotation: #94a3b8;
      --edge: #697586;
      --selected: #fb923c;
      --danger: #f87171;
      --shadow: 0 10px 30px rgba(0, 0, 0, .28);
      font-family: var(--vscode-font-family, Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
    }
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body { margin: 0; min-height: 100vh; overflow: hidden; background: var(--bg); color: var(--text); }
    button, input { font: inherit; }
    button { color: var(--text); }
    .window-titlebar {
      position: fixed;
      left: 0;
      right: 0;
      top: 0;
      height: 32px;
      z-index: 25;
      display: grid;
      grid-template-columns: 1fr auto 1fr;
      align-items: center;
      padding: 0 12px;
      border-bottom: 1px solid var(--border);
      background: color-mix(in srgb, var(--bg) 72%, #000 28%);
      color: var(--muted);
      font-size: 12px;
    }
    .window-titlebar strong { color: var(--text); font-size: 12px; font-weight: 650; }
    .window-actions { justify-self: end; display: flex; gap: 9px; align-items: center; }
    .window-dot { width: 12px; height: 12px; border: 1px solid var(--border); border-radius: 3px; }
    .shell { height: calc(100vh - 32px); margin-top: 32px; min-width: 0; display: flex; flex-direction: column; background: var(--bg); }
    .topbar {
      min-height: 48px;
      display: grid;
      grid-template-columns: minmax(260px, 1fr) auto;
      align-items: center;
      gap: 16px;
      padding: 7px 14px;
      border-bottom: 1px solid var(--border);
      background: color-mix(in srgb, var(--bg) 88%, #000 12%);
    }
    .brand { min-width: 0; }
    h1 { margin: 0; font-size: 17px; line-height: 1.25; font-weight: 760; letter-spacing: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    h2 { margin: 0; font-size: 12px; line-height: 1.2; font-weight: 760; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; }
    .meta { margin-top: 5px; color: var(--muted); font-size: 12px; line-height: 1.4; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .top-stats { display: flex; gap: 8px; align-items: center; justify-content: flex-end; flex-wrap: wrap; }
    .topbar .top-stats { display: none; }
    .stat-chip {
      min-width: 72px;
      min-height: 38px;
      padding: 6px 9px;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--panel);
      display: grid;
      gap: 1px;
    }
    .stat-chip span { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .06em; }
    .stat-chip strong { color: var(--text); font-size: 14px; line-height: 1.1; }
    .tabs { display: inline-flex; border: 1px solid var(--border); border-radius: 7px; overflow: hidden; background: var(--panel); }
    .tab {
      height: 34px;
      min-width: 96px;
      border: 0;
      border-right: 1px solid var(--border);
      border-radius: 0;
      background: transparent;
      cursor: pointer;
      font-size: 13px;
      font-weight: 640;
    }
    .tab:last-child { border-right: 0; }
    .tab.active { background: var(--target); color: #06231f; }
    .workspace {
      min-height: 0;
      flex: 1;
      display: grid;
      grid-template-columns: 330px minmax(0, 1fr) 360px;
      overflow: hidden;
    }
    .workspace.graph-mode {
      grid-template-columns: minmax(0, 1fr);
    }
    .workspace.graph-mode .nav-panel,
    .workspace.graph-mode .inspector {
      display: none;
    }
    .workspace.graph-mode .main-panel {
      grid-column: 1;
    }
    .workspace.sequence-focus-mode {
      grid-template-columns: 330px minmax(0, 1fr);
    }
    .workspace.sequence-focus-mode .inspector {
      display: none;
    }
    .workspace.sequence-focus-mode .main-panel {
      grid-column: 2;
    }
    .nav-panel, .inspector {
      min-height: 0;
      overflow: auto;
      background: var(--panel);
    }
    .nav-panel { border-right: 1px solid var(--border); }
    .inspector { border-left: 1px solid var(--border); }
    .main-panel { min-width: 0; min-height: 0; overflow: hidden; display: flex; flex-direction: column; }
    .panel-section { padding: 14px; border-bottom: 1px solid var(--border); }
    .product-head { padding: 15px 14px 13px; }
    .product-row { display: flex; align-items: center; gap: 8px; margin-bottom: 18px; }
    .product-row strong { font-size: 16px; }
    .version-pill { border: 1px solid var(--border); border-radius: 999px; padding: 1px 6px; color: var(--muted); font-size: 10px; }
    .branch-line { margin-top: 8px; color: var(--muted); font-size: 12px; }
    .trust-pill {
      min-width: 58px;
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 2px 7px;
      text-align: center;
      font-size: 10px;
      font-weight: 800;
      letter-spacing: .05em;
      text-transform: uppercase;
    }
    .trust-pill.high { color: var(--target); border-color: color-mix(in srgb, var(--target) 55%, var(--border) 45%); background: rgba(45, 212, 191, .1); }
    .trust-pill.medium { color: #fde68a; border-color: rgba(245, 158, 11, .48); background: rgba(245, 158, 11, .1); }
    .trust-pill.low { color: var(--danger); border-color: rgba(248, 113, 113, .52); background: rgba(248, 113, 113, .1); }
    .trust-card {
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--panel-2);
      padding: 9px;
      display: grid;
      gap: 8px;
    }
    .trust-card.high { border-color: color-mix(in srgb, var(--target) 45%, var(--border) 55%); }
    .trust-card.medium { border-color: rgba(245, 158, 11, .42); }
    .trust-card.low { border-color: rgba(248, 113, 113, .48); }
    .trust-score-line { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .trust-score-line strong { font-size: 22px; line-height: 1; }
    .trust-score-line span { color: var(--muted); font-size: 11px; }
    .trust-metrics { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
    .trust-metric { border: 1px solid var(--border); border-radius: 6px; background: var(--panel-3); padding: 6px; }
    .trust-metric span { display: block; color: var(--muted); font-size: 10px; }
    .trust-metric strong { display: block; margin-top: 3px; font-size: 13px; }
    .trust-reasons { margin: 0; padding-left: 16px; color: var(--muted); font-size: 11px; line-height: 1.45; }
    .section-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
    .count { color: var(--muted); font-size: 12px; }
    .metric-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px; }
    .metric {
      min-height: 50px;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--panel-2);
      padding: 7px 6px;
    }
    .metric span { display: block; color: var(--muted); font-size: 10px; line-height: 1.2; text-align: center; }
    .metric strong { display: block; margin-top: 4px; font-size: 16px; line-height: 1.1; text-align: center; }
    .flow-list { display: grid; gap: 8px; }
    .flow-card, .ref-item, .step-item, .file-pill, .test-suggestion {
      width: 100%;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--panel-2);
      color: var(--text);
      text-align: left;
    }
    .flow-card, .step-item, .ref-item, .test-suggestion { cursor: pointer; }
    .flow-card { padding: 9px; display: grid; gap: 6px; }
    .flow-card:hover, .step-item:hover, .ref-item:hover, .test-suggestion:hover { border-color: color-mix(in srgb, var(--target) 45%, var(--border) 55%); }
    .flow-card.active { border-color: var(--endpoint); background: color-mix(in srgb, var(--endpoint) 18%, var(--panel-2) 82%); box-shadow: inset 3px 0 0 var(--endpoint); }
    .flow-main { display: flex; align-items: center; gap: 7px; min-width: 0; }
    .method-pill {
      flex: none;
      min-width: 42px;
      border-radius: 5px;
      padding: 3px 6px;
      color: #fff;
      background: var(--endpoint);
      font-size: 11px;
      font-weight: 760;
      text-align: center;
    }
    .flow-path { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 700; }
    .flow-sub { color: var(--muted); font-size: 11px; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .file-list { display: grid; gap: 7px; }
    .file-pill { padding: 8px; font-size: 12px; color: var(--muted); cursor: default; }
    .file-pill strong { color: var(--text); font-weight: 650; }
    .test-suggestion-list { display: grid; gap: 7px; }
    .test-suggestion { min-height: 68px; padding: 8px; display: grid; gap: 5px; }
    .test-suggestion.active { border-color: var(--test); background: color-mix(in srgb, var(--test) 14%, var(--panel-2) 86%); box-shadow: inset 3px 0 0 var(--test); }
    .test-suggestion-top { display: flex; align-items: center; gap: 7px; min-width: 0; }
    .test-rank {
      flex: none;
      width: 24px;
      height: 22px;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: color-mix(in srgb, var(--test) 18%, var(--panel-3) 82%);
      color: var(--test);
      font-size: 11px;
      font-weight: 800;
    }
    .test-file { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); font-size: 12px; font-weight: 700; }
    .test-meta { color: var(--muted); font-size: 11px; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .test-command-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: 6px; align-items: center; }
    .test-command-row code {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      border: 1px solid var(--border);
      border-radius: 5px;
      background: var(--panel-3);
      color: var(--muted);
      padding: 3px 5px;
      font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace);
      font-size: 10px;
      line-height: 1.3;
    }
    .copy-test-command {
      height: 24px;
      border: 1px solid var(--border);
      border-radius: 5px;
      background: var(--panel-3);
      color: var(--text);
      padding: 0 7px;
      cursor: pointer;
      font-size: 10px;
      font-weight: 760;
      text-transform: uppercase;
      letter-spacing: .04em;
    }
    .copy-test-command:hover { border-color: var(--test); color: var(--test); }
    .warning { color: #fde68a; background: rgba(245, 158, 11, .09); border: 1px solid rgba(245, 158, 11, .36); border-radius: 7px; padding: 9px; font-size: 12px; line-height: 1.45; }
    .view { display: none; min-height: 0; flex: 1; overflow: hidden; }
    .view.active { display: flex; flex-direction: column; }
    .view-head {
      min-height: 58px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 11px 14px;
      border-bottom: 1px solid var(--border);
      background: var(--panel);
    }
    .view-title { min-width: 0; }
    .view-title strong { display: block; font-size: 14px; line-height: 1.2; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .view-title span { display: block; margin-top: 4px; color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .toolbar-actions { display: flex; align-items: center; justify-content: flex-end; gap: 7px; flex-wrap: wrap; }
    .segmented-control { display: inline-flex; border: 1px solid var(--border); border-radius: 7px; overflow: hidden; background: var(--panel-2); }
    .segmented-control button {
      height: 30px;
      border: 0;
      border-right: 1px solid var(--border);
      border-radius: 0;
      background: transparent;
      color: var(--muted);
      padding: 0 9px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 650;
    }
    .segmented-control button:last-child { border-right: 0; }
    .segmented-control button.active { background: rgba(45, 212, 191, .12); color: var(--target); }
    .action-btn, .icon-btn {
      height: 30px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--panel-2);
      color: var(--text);
      padding: 0 9px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 650;
    }
    .icon-btn { width: 30px; padding: 0; text-align: center; }
    .action-btn:hover, .icon-btn:hover { border-color: var(--border-strong); }
    .action-btn.active { border-color: var(--target); color: var(--target); }
    .zoom-readout { min-width: 46px; color: var(--muted); font-size: 12px; text-align: center; }
    .sequence-stage { min-height: 0; flex: 1; display: flex; flex-direction: column; overflow: hidden; background: color-mix(in srgb, var(--bg) 90%, #000 10%); }
    .debugger-stage {
      min-height: 0;
      flex: 1;
      display: grid;
      grid-template-columns: minmax(0, 1fr) 330px;
      overflow: hidden;
      background: color-mix(in srgb, var(--bg) 92%, #000 8%);
    }
    .debugger-main {
      min-width: 0;
      min-height: 0;
      overflow: auto;
      padding: 16px;
      background-image: radial-gradient(circle at 1px 1px, rgba(148, 163, 184, .14) 1px, transparent 0);
      background-size: 24px 24px;
    }
    .debugger-card {
      max-width: 880px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel);
      box-shadow: var(--shadow);
      overflow: hidden;
    }
    .debugger-card-head {
      min-height: 54px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--border);
      background: var(--panel-2);
    }
    .debugger-step-num {
      flex: none;
      width: 38px;
      height: 38px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 8px;
      background: color-mix(in srgb, var(--target) 18%, var(--panel-3) 82%);
      color: var(--target);
      font-size: 15px;
      font-weight: 800;
    }
    .debugger-step-title { min-width: 0; flex: 1; }
    .debugger-step-title strong { display: block; font-size: 15px; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .debugger-step-title span { display: block; margin-top: 3px; color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .debug-confidence {
      flex: none;
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 3px 8px;
      font-size: 10px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: .05em;
    }
    .debug-confidence.high { color: var(--target); border-color: color-mix(in srgb, var(--target) 50%, var(--border) 50%); }
    .debug-confidence.medium { color: #fde68a; border-color: rgba(245, 158, 11, .45); }
    .debug-confidence.low { color: var(--danger); border-color: rgba(248, 113, 113, .55); }
    .debugger-card-body { display: grid; gap: 12px; padding: 14px; }
    .debugger-why {
      border: 1px solid color-mix(in srgb, var(--target) 34%, var(--border) 66%);
      border-radius: 7px;
      background: color-mix(in srgb, var(--target) 8%, var(--panel-2) 92%);
      padding: 10px;
      color: var(--text);
      font-size: 13px;
      line-height: 1.45;
    }
    .debugger-code {
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--panel-3);
      color: var(--text);
      padding: 10px;
      font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace);
      font-size: 12px;
      line-height: 1.55;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .debugger-meta-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
    .debugger-meta {
      min-width: 0;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--panel-2);
      padding: 8px;
    }
    .debugger-meta span { display: block; color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .06em; }
    .debugger-meta strong { display: block; margin-top: 4px; color: var(--text); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .debugger-warning {
      border: 1px solid rgba(245, 158, 11, .38);
      border-radius: 7px;
      background: rgba(245, 158, 11, .08);
      color: #fde68a;
      padding: 9px 10px;
      font-size: 12px;
      line-height: 1.45;
    }
    .debugger-timeline {
      min-width: 0;
      min-height: 0;
      overflow: auto;
      border-left: 1px solid var(--border);
      background: var(--panel);
      padding: 12px;
    }
    .debugger-timeline-list { display: grid; gap: 7px; }
    .debugger-timeline-item {
      width: 100%;
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--panel-2);
      color: var(--text);
      text-align: left;
      padding: 8px;
      cursor: pointer;
    }
    .debugger-timeline-item:hover { border-color: var(--target); }
    .debugger-timeline-item.active { border-color: var(--selected); box-shadow: inset 3px 0 0 var(--selected); }
    .debugger-timeline-item.unresolved { border-color: rgba(248, 113, 113, .46); }
    .debugger-timeline-top { display: flex; align-items: center; gap: 7px; min-width: 0; }
    .debugger-timeline-index {
      flex: none;
      width: 22px;
      height: 20px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      background: var(--panel-3);
      color: var(--muted);
      font-size: 10px;
      font-weight: 800;
    }
    .debugger-timeline-kind { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }
    .debugger-timeline-title { margin-top: 5px; font-size: 12px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .debugger-timeline-loc { margin-top: 4px; color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sequence-scroller {
      min-height: 0;
      flex: 1;
      overflow: auto;
      padding: 14px;
      background-image: radial-gradient(circle at 1px 1px, rgba(148, 163, 184, .16) 1px, transparent 0);
      background-size: 24px 24px;
      cursor: grab;
      overscroll-behavior: contain;
      touch-action: none;
    }
    .sequence-scroller.dragging { cursor: grabbing; user-select: none; }
    .sequence-svg {
      display: block;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel-3);
      box-shadow: var(--shadow);
    }
    .message-label { paint-order: stroke; stroke: var(--bg); stroke-width: 4; stroke-linejoin: round; }
    .message-meta { paint-order: stroke; stroke: var(--bg); stroke-width: 3; stroke-linejoin: round; }
    .message-route { fill: var(--target); font-size: 9px; font-weight: 760; }
    .message { cursor: pointer; }
    .message:hover text.label { fill: var(--target); }
    .message.selected .message-line, .message.selected path { stroke: var(--selected); stroke-width: 2.8; }
    .message.selected text.label { fill: var(--selected); font-weight: 760; }
    .sequence-legend {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      min-height: 42px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--border);
      border-top: 1px solid var(--border);
      background: color-mix(in srgb, var(--panel) 92%, #000 8%);
    }
    .sequence-legend-title {
      color: var(--muted);
      font-size: 11px;
      font-weight: 760;
      text-transform: uppercase;
      letter-spacing: .05em;
    }
    .sequence-legend-item {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      border: 1px solid var(--border);
      border-radius: 999px;
      padding: 3px 8px;
      background: var(--panel-2);
      color: var(--muted);
      font-size: 11px;
      line-height: 1.2;
    }
    .sequence-legend-dot {
      width: 8px;
      height: 8px;
      border-radius: 999px;
      display: inline-flex;
    }
    .sequence-hint {
      min-height: 28px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border-bottom: 1px solid var(--border);
      border-top: 1px solid var(--border);
      color: var(--muted);
      font-size: 11px;
      line-height: 1.25;
      background: color-mix(in srgb, var(--panel) 92%, #000 8%);
    }
    .sequence-hint strong {
      color: var(--target);
      font-weight: 760;
    }
    .mermaid-box {
      border-top: 1px solid var(--border);
      background: var(--panel);
    }
    .sequence-refs-dock {
      height: 196px;
      min-height: 160px;
      display: flex;
      flex-direction: column;
      border-top: 1px solid var(--border);
      background: color-mix(in srgb, var(--panel) 92%, #000 8%);
    }
    .quick-refs-head {
      min-height: 42px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 14px;
      border-bottom: 1px solid var(--border);
    }
    .quick-refs-tools {
      display: grid;
      grid-template-columns: minmax(180px, 270px) minmax(0, 1fr);
      gap: 10px;
      align-items: center;
      padding: 9px 14px;
      border-bottom: 1px solid var(--border);
    }
    .quick-refs-list {
      min-height: 0;
      flex: 1;
      overflow: auto;
      padding: 0 14px 12px;
    }
    .quick-refs-list .ref-group { margin-top: 10px; margin-bottom: 0; }
    .mermaid-box summary {
      min-height: 36px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 0 14px;
      cursor: pointer;
      color: var(--muted);
      font-size: 12px;
      font-weight: 700;
    }
    pre {
      max-height: 220px;
      margin: 0;
      padding: 12px 14px;
      overflow: auto;
      border-top: 1px solid var(--border);
      color: var(--text);
      background: var(--panel-3);
      font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace);
      font-size: 12px;
      line-height: 1.55;
    }
    .refs-view { overflow: hidden; }
    .refs-toolbar {
      display: grid;
      gap: 10px;
      padding: 14px;
      border-bottom: 1px solid var(--border);
      background: var(--panel);
    }
    .search-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 10px; align-items: center; }
    input[type="search"] {
      width: 100%;
      height: 34px;
      border: 1px solid var(--border);
      border-radius: 7px;
      padding: 0 11px;
      color: var(--text);
      background: var(--panel-3);
      outline: none;
      font-size: 13px;
    }
    input[type="search"]:focus { border-color: var(--target); box-shadow: 0 0 0 3px rgba(45, 212, 191, .12); }
    .kind-filter { display: flex; gap: 7px; flex-wrap: wrap; }
    .kind-filter button {
      min-height: 27px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--panel-2);
      color: var(--muted);
      padding: 3px 9px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 650;
    }
    .kind-filter button.active { background: rgba(45, 212, 191, .12); border-color: var(--target); color: var(--target); }
    .map-filter-banner {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      border: 1px solid color-mix(in srgb, var(--target) 42%, var(--border) 58%);
      border-radius: 7px;
      background: color-mix(in srgb, var(--target) 10%, var(--panel-2) 90%);
      padding: 8px 9px;
      color: var(--text);
      font-size: 12px;
      line-height: 1.35;
    }
    .map-filter-banner[hidden] { display: none; }
    .map-filter-banner strong { color: var(--target); font-weight: 760; }
    .map-filter-banner span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .map-filter-banner button {
      flex: none;
      height: 26px;
      border: 1px solid var(--border);
      border-radius: 6px;
      background: var(--panel-3);
      color: var(--text);
      padding: 0 8px;
      cursor: pointer;
      font-size: 12px;
      font-weight: 650;
    }
    .refs-list { min-height: 0; overflow: auto; padding: 12px 14px 22px; }
    .ref-group { margin-bottom: 12px; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; background: var(--panel); }
    .ref-group-title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      padding: 8px 10px;
      border-bottom: 1px solid var(--border);
      background: var(--panel-2);
      color: var(--muted);
      font-size: 12px;
    }
    .ref-group-title strong { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); font-weight: 670; }
    .ref-item {
      border: 0;
      border-bottom: 1px solid var(--border);
      border-radius: 0;
      padding: 9px 10px;
      background: transparent;
    }
    .ref-item:hover .item-title, .step-item:hover .item-title { color: var(--target); }
    .ref-item:last-child { border-bottom: 0; }
    .ref-item.selected, .step-item.selected { outline: 2px solid var(--selected); outline-offset: -2px; }
    .item-top { display: flex; align-items: baseline; gap: 8px; min-width: 0; }
    .kind-tag {
      flex: none;
      min-width: 92px;
      font-size: 10px;
      font-weight: 760;
      letter-spacing: .05em;
      text-transform: uppercase;
    }
    .item-title { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 690; }
    .item-meta {
      margin-top: 5px;
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--muted);
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: .04em;
      flex-wrap: wrap;
    }
    .open-hint {
      margin-left: auto;
      flex: none;
      color: var(--target);
      font-size: 10px;
      font-weight: 760;
      text-transform: uppercase;
      letter-spacing: .05em;
    }
    .item-loc { margin-top: 4px; color: var(--muted); font-size: 11px; line-height: 1.35; word-break: break-word; }
    .line { margin-top: 5px; color: var(--subtle); font-family: var(--vscode-editor-font-family, ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace); font-size: 11px; line-height: 1.45; word-break: break-word; }
    .graph-stage { min-height: 0; flex: 1; overflow: hidden; background: color-mix(in srgb, var(--bg) 92%, #000 8%); }
    .graph-svg {
      width: 100%;
      height: 100%;
      min-height: 520px;
      display: block;
      background-image: radial-gradient(circle at 1px 1px, rgba(148, 163, 184, .16) 1px, transparent 0);
      background-size: 24px 24px;
    }
    .map-lane rect { fill: rgba(27, 33, 48, .52); stroke: var(--border); }
    .map-lane text { fill: var(--muted); font-size: 11px; font-weight: 760; letter-spacing: .06em; text-transform: uppercase; }
    .map-node { cursor: pointer; }
    .map-node rect { fill: var(--panel-2); stroke: var(--border); stroke-width: 1.2; filter: drop-shadow(0 8px 18px rgba(0,0,0,.24)); }
    .map-node:hover rect { stroke: var(--target); }
    .map-node.selected rect { stroke: var(--selected); stroke-width: 2.2; }
    .map-node .map-title { fill: var(--text); font-size: 12px; font-weight: 760; }
    .map-node .map-subtitle { fill: var(--muted); font-size: 10px; }
    .map-node .map-count { fill: var(--target); font-size: 12px; font-weight: 800; text-anchor: end; }
    .map-edge { fill: none; stroke: rgba(148, 163, 184, .72); stroke-width: 1.45; marker-end: url(#arrow); }
    .map-edge.hot { stroke: var(--target); stroke-width: 2; }
    .node { cursor: pointer; }
    .node circle { stroke: var(--panel-3); stroke-width: 2.4; filter: drop-shadow(0 4px 10px rgba(0,0,0,.26)); }
    .node text { font-size: 11px; fill: var(--text); paint-order: stroke; stroke: var(--bg); stroke-width: 4px; stroke-linejoin: round; }
    .graph-svg.dense .node text { display: none; }
    .graph-svg.dense .edge { opacity: .46; stroke-width: 1.2; }
    .graph-svg.dense .node circle { stroke-width: 2; }
    .graph-svg.dense .node.selected circle { stroke: var(--selected); stroke-width: 3.4; }
    .edge { stroke: var(--edge); stroke-width: 1.5; opacity: .74; marker-end: url(#arrow); cursor: pointer; }
    .edge.call { stroke: var(--method); }
    .edge.write { stroke: var(--danger); }
    .edge.read { stroke: #22c55e; }
    .edge.endpoint_handler { stroke: var(--endpoint); }
    .edge.callback { stroke: var(--callback); }
    .edge.annotation { stroke: var(--annotation); stroke-dasharray: 4 4; }
    .edge.selected { stroke: var(--selected); stroke-width: 3.4; opacity: 1; }
    .inspector .panel-section { padding: 14px; }
    .selected-box {
      min-height: 120px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--panel-2);
      padding: 11px;
      color: var(--muted);
      font-size: 12px;
      line-height: 1.45;
    }
    .selected-box strong { display: block; margin-bottom: 6px; color: var(--text); font-size: 13px; }
    .selected-table { display: grid; gap: 10px; }
    .selected-row { display: grid; grid-template-columns: 72px minmax(0, 1fr); gap: 10px; align-items: baseline; }
    .selected-row span { color: var(--muted); font-size: 11px; font-weight: 700; }
    .selected-row div { color: var(--text); font-size: 12px; line-height: 1.45; word-break: break-word; }
    .selected-method { display: inline-block; margin-right: 8px; border-radius: 5px; padding: 2px 7px; background: var(--endpoint); color: #fff; font-size: 11px; font-weight: 800; }
    .diagnostics-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
    .diag-card {
      border: 1px solid var(--border);
      border-radius: 7px;
      background: var(--panel-2);
      padding: 8px;
      min-height: 50px;
    }
    .diag-card span { display: block; color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .05em; }
    .diag-card strong { display: block; margin-top: 4px; color: var(--text); font-size: 16px; }
    .diag-notes { margin-top: 10px; display: grid; gap: 6px; }
    .diag-note { border-left: 2px solid var(--selected); padding-left: 8px; color: var(--muted); font-size: 12px; line-height: 1.45; }
    .step-list { display: grid; gap: 7px; }
    .step-item {
      min-height: 58px;
      padding: 8px 9px 8px calc(9px + var(--depth, 0) * 12px);
      display: grid;
      gap: 4px;
      position: relative;
    }
    .step-item::before {
      content: "";
      position: absolute;
      left: calc(8px + var(--depth, 0) * 12px);
      top: 12px;
      bottom: 12px;
      width: 2px;
      border-radius: 999px;
      background: color-mix(in srgb, var(--target) 38%, var(--border) 62%);
    }
    .step-num {
      flex: none;
      min-width: 24px;
      height: 20px;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: var(--panel-3);
      color: var(--muted);
      font-size: 10px;
      font-weight: 760;
    }
    .empty { padding: 16px; color: var(--muted); font-size: 13px; line-height: 1.45; }
    @media (max-width: 1240px) {
      .workspace { grid-template-columns: 270px minmax(0, 1fr); overflow: auto; }
      .workspace.sequence-focus-mode { grid-template-columns: 270px minmax(0, 1fr); overflow: hidden; }
      .inspector { grid-column: 1 / -1; min-height: 260px; max-height: 360px; border-left: 0; border-top: 1px solid var(--border); display: grid; grid-template-columns: minmax(280px, 380px) minmax(0, 1fr); }
      .inspector .panel-section { border-bottom: 0; border-right: 1px solid var(--border); }
      .inspector .panel-section:last-child { border-right: 0; }
    }
    @media (max-width: 860px) {
      body { overflow: auto; }
      .window-titlebar { display: none; }
      .shell { min-height: 100vh; height: auto; margin: 0; }
      .topbar { grid-template-columns: 1fr; align-items: start; }
      .top-stats { justify-content: flex-start; }
      .workspace { display: flex; flex-direction: column; overflow: visible; }
      .nav-panel, .inspector, .main-panel { min-height: auto; max-height: none; border: 0; }
      .main-panel { order: 1; min-height: 680px; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
      .nav-panel { order: 2; }
      .inspector { order: 3; display: block; }
      .sequence-refs-dock { display: none; }
      .view-head, .search-row { grid-template-columns: 1fr; flex-wrap: wrap; align-items: flex-start; }
      .tabs { width: 100%; }
      .tab { flex: 1; min-width: 0; }
      .metric-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
  </style>
</head>
<body>
  <div class="window-titlebar" aria-hidden="true">
    <span></span>
    <strong>Ext Graph: Java Impact Graph</strong>
    <div class="window-actions"><span class="window-dot"></span><span class="window-dot"></span><span class="window-dot"></span></div>
  </div>
  <div class="shell">
    <header class="topbar">
      <div class="brand">
        <h1 id="flowCrumbTitle"></h1>
        <div class="meta" id="flowCrumbMeta"></div>
      </div>
      <div class="top-stats" id="topStats"></div>
      <div class="tabs" aria-label="Impact views">
        <button class="tab active" data-tab="sequence">Sequence</button>
        <button class="tab" data-tab="static-debug">Static Debug</button>
        <button class="tab" data-tab="references">References</button>
        <button class="tab" data-tab="graph">Graph</button>
      </div>
    </header>
    <div id="workspace" class="workspace">
      <aside class="nav-panel">
        <section class="panel-section product-head">
          <div class="product-row"><strong>Ext Graph</strong><span class="version-pill">${productVersion}</span></div>
          <h1 id="targetTitle"></h1>
          <div class="meta" id="targetMeta"></div>
          <div class="branch-line">local Java analyzer</div>
        </section>
        <section class="panel-section">
          <div class="section-head"><h2>Trust Score</h2><span id="trustPill" class="trust-pill"></span></div>
          <div id="trustScore"></div>
        </section>
        <section class="panel-section">
          <div class="section-head"><h2>Summary</h2></div>
          <div id="summary" class="metric-grid"></div>
        </section>
        <section class="panel-section">
          <div class="section-head"><h2>API Flows</h2><span class="count" id="flowCount"></span></div>
          <div id="flowList" class="flow-list"></div>
        </section>
        <section class="panel-section">
          <div class="section-head"><h2>Top Files</h2></div>
          <div id="files" class="file-list"></div>
        </section>
        <section class="panel-section">
          <div class="section-head"><h2>Suggested Tests</h2><span class="count" id="testSuggestionCount"></span></div>
          <div id="suggestedTests" class="test-suggestion-list"></div>
        </section>
        <section class="panel-section">
          <div class="section-head"><h2>Warnings</h2></div>
          <div id="warnings"></div>
        </section>
      </aside>
      <main class="main-panel">
        <section id="sequence" class="view active">
          <div class="view-head">
            <div class="view-title"><strong id="flowTitle"></strong><span id="flowMeta"></span></div>
            <div class="toolbar-actions">
              <button class="action-btn" id="fitSequence">Fit</button>
              <button class="icon-btn" id="zoomOut" aria-label="Zoom out">-</button>
              <span class="zoom-readout" id="zoomValue">100%</span>
              <button class="icon-btn" id="zoomIn" aria-label="Zoom in">+</button>
              <button class="action-btn active" id="toggleLabels">Labels</button>
              <button class="action-btn" id="copyMermaid">Copy Mermaid</button>
            </div>
          </div>
          <div class="sequence-stage">
            <div id="sequenceLegend" class="sequence-legend" role="note" aria-label="Sequence legend"></div>
            <div id="sequenceHint" class="sequence-hint" role="status" aria-live="polite">Select an API flow step to inspect details.</div>
            <div id="sequenceScroller" class="sequence-scroller">
              <svg id="sequenceSvg" class="sequence-svg" role="img" aria-label="API sequence flow"></svg>
            </div>
            <details class="mermaid-box">
              <summary><span>Mermaid sequence</span></summary>
              <pre id="mermaidText"></pre>
            </details>
          </div>
          <div class="sequence-refs-dock">
            <div class="quick-refs-head"><h2>References</h2><span class="count" id="quickRefCount"></span></div>
            <div class="quick-refs-tools">
              <input id="quickRefSearch" type="search" placeholder="Search references">
              <div id="quickKindFilter" class="kind-filter"></div>
            </div>
            <div id="quickRefsList" class="quick-refs-list"></div>
          </div>
        </section>
        <section id="static-debug" class="view">
          <div class="view-head">
            <div class="view-title"><strong id="debugTitle">Static Debugger</strong><span id="debugMeta"></span></div>
            <div class="toolbar-actions">
              <button class="icon-btn" id="debugPrevStep" aria-label="Previous static debug step">-</button>
              <span class="zoom-readout" id="debugStepReadout">0/0</span>
              <button class="icon-btn" id="debugNextStep" aria-label="Next static debug step">+</button>
              <button class="action-btn" id="debugOpenSource">Open Source</button>
              <button class="action-btn" id="copyStaticDebugTrace">Copy Trace</button>
            </div>
          </div>
          <div class="debugger-stage">
            <div class="debugger-main">
              <div id="debuggerCard" class="debugger-card"></div>
            </div>
            <aside class="debugger-timeline">
              <div class="section-head"><h2>Debugger Timeline</h2><span class="count" id="debugTimelineCount"></span></div>
              <div id="debugTimeline" class="debugger-timeline-list"></div>
            </aside>
          </div>
        </section>
        <section id="references" class="view refs-view">
          <div class="refs-toolbar">
            <div class="search-row">
              <input id="refSearch" type="search" placeholder="Search symbol, file, line, annotation, callback">
              <span class="count" id="refResultCount"></span>
            </div>
            <div id="kindFilter" class="kind-filter"></div>
            <div id="mapFilterBanner" class="map-filter-banner" hidden></div>
          </div>
          <div id="refsList" class="refs-list"></div>
        </section>
        <section id="graph" class="view">
          <div class="view-head">
            <div class="view-title"><strong>Impact graph</strong><span id="graphMeta"></span></div>
            <div class="toolbar-actions">
              <div class="segmented-control" aria-label="Graph scope">
                <button id="graphScopeMap" class="active" data-graph-scope="map">Map</button>
                <button id="graphScopeRaw" data-graph-scope="raw">Raw</button>
              </div>
              <button class="action-btn" id="toggleGraphLabels">Labels</button>
              <button class="action-btn" id="redrawGraph">Fit Graph</button>
            </div>
          </div>
          <div class="graph-stage">
            <svg id="graphSvg" class="graph-svg" role="img" aria-label="Impact graph"></svg>
          </div>
        </section>
      </main>
      <aside class="inspector">
        <section class="panel-section">
          <div class="section-head"><h2>Selected</h2></div>
          <div id="selected" class="selected-box">Select a flow step, reference, node, or edge.</div>
        </section>
        <section class="panel-section">
          <div class="section-head"><h2>Flow Diagnostics</h2></div>
          <div id="flowDiagnostics"></div>
        </section>
        <section class="panel-section">
          <div class="section-head"><h2>Flow Steps</h2><span class="count" id="stepCount"></span></div>
          <div id="flowSteps" class="step-list"></div>
        </section>
      </aside>
    </div>
  </div>
  <script>
    const graph = ${data};
    const staticDebuggerSessions = ${staticDebuggerData};
    const testCommandsByFile = ${testCommandsByFile};
    const initialTab = ${initialTab};
    const vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
${webviewMessageTypesJs}
    const denseGraph = graph.nodes.length > 90 || graph.edges.length > 140;
    const colors = {
      target: 'var(--target)',
      symbol: 'var(--symbol)',
      method: 'var(--method)',
      file: 'var(--file)',
      test: 'var(--test)',
      endpoint: 'var(--endpoint)',
      callback: 'var(--callback)',
      annotation: 'var(--annotation)'
    };
    const state = {
      activeTab: initialTab || 'sequence',
      activeFlow: 0,
      activeDebugStep: 0,
      activeKind: 'all',
      activeMapFilter: null,
      selectedType: null,
      selectedId: null,
      selectedMapNode: null,
      selectedFilter: null,
      sequenceZoom: 1,
      showLabels: true,
      sequencePan: {
        active: false,
        moved: false,
        pointerId: null,
        startX: 0,
        startY: 0,
        scrollLeft: 0,
        scrollTop: 0,
        suppressClick: false
      },
      graphScope: 'map',
      graphLabels: !denseGraph
    };
    const graphSvg = document.getElementById('graphSvg');
    const sequenceSvg = document.getElementById('sequenceSvg');
    const sequenceScroller = document.getElementById('sequenceScroller');
    const MIN_SEQUENCE_ZOOM = 0.38;
    const MAX_SEQUENCE_FIT_ZOOM = 1.08;
    let sequenceFitFrame = 0;

    document.getElementById('targetTitle').textContent = graph.metadata.target + ' impact view';
    document.getElementById('targetMeta').textContent = graph.metadata.root + ' | ' + graph.metadata.mode + ' | ' + graph.metadata.generatedAt;
    document.getElementById('graphMeta').textContent = graph.nodes.length + ' nodes, ' + graph.edges.length + ' edges';

    bindShell();
    renderTrust();
    renderSummary();
    renderSuggestedTests();
    renderFlowList();
    renderReferences();
    renderQuickReferences();
    renderSelected();
    renderSequence();
    renderStaticDebugger();
    setActiveTab(state.activeTab);

    function bindShell() {
      document.querySelectorAll('.tab').forEach(button => {
        button.onclick = () => setActiveTab(button.dataset.tab || 'sequence');
      });
      document.getElementById('fitSequence').onclick = () => fitSequence({ resetScroll: true });
      document.getElementById('zoomOut').onclick = () => setSequenceZoom(state.sequenceZoom - .12);
      document.getElementById('zoomIn').onclick = () => setSequenceZoom(state.sequenceZoom + .12);
      document.getElementById('toggleLabels').onclick = () => {
        state.showLabels = !state.showLabels;
        document.getElementById('toggleLabels').classList.toggle('active', state.showLabels);
        drawSequence(activeFlow());
      };
      document.getElementById('copyMermaid').onclick = async () => {
        const text = document.getElementById('mermaidText').textContent || '';
        try { await navigator.clipboard.writeText(text); } catch {}
      };
      bindSequencePan();
      document.getElementById('refSearch').oninput = renderReferences;
      document.getElementById('quickRefSearch').oninput = renderQuickReferences;
      document.querySelectorAll('[data-graph-scope]').forEach(button => {
        button.onclick = () => {
          state.graphScope = button.dataset.graphScope || 'core';
          drawGraph();
        };
      });
      document.getElementById('toggleGraphLabels').onclick = () => {
        state.graphLabels = !state.graphLabels;
        drawGraph();
      };
      document.getElementById('redrawGraph').onclick = drawGraph;
      document.getElementById('debugPrevStep').onclick = () => selectStaticDebugStep(state.activeDebugStep - 1);
      document.getElementById('debugNextStep').onclick = () => selectStaticDebugStep(state.activeDebugStep + 1);
      document.getElementById('debugOpenSource').onclick = () => {
        const step = activeStaticDebugStep();
        if (step) openLocation(step.file, step.line);
      };
      document.getElementById('copyStaticDebugTrace').onclick = async () => {
        await copyText(staticDebugTraceMarkdown(activeStaticDebugSession()));
      };
      window.addEventListener('resize', () => {
        if (state.activeTab === 'sequence') scheduleSequenceFit();
        if (state.activeTab === 'graph') drawGraph();
      });
      renderGraphControls();
    }

    function setActiveTab(tabName) {
      state.activeTab = tabName || 'sequence';
      document.querySelectorAll('.tab').forEach(item => item.classList.toggle('active', item.dataset.tab === state.activeTab));
      document.querySelectorAll('.view').forEach(item => item.classList.toggle('active', item.id === state.activeTab));
      applyActiveTabLayout();
      if (state.activeTab === 'graph') drawGraph();
      if (state.activeTab === 'sequence') renderSequence();
      if (state.activeTab === 'static-debug') renderStaticDebugger();
      if (state.activeTab === 'references') renderReferences();
    }

    function applyActiveTabLayout() {
      const workspace = document.getElementById('workspace');
      workspace.classList.toggle('graph-mode', state.activeTab === 'graph');
      workspace.classList.toggle('sequence-focus-mode', state.activeTab === 'sequence');
    }

    function renderGraphControls() {
      document.querySelectorAll('[data-graph-scope]').forEach(button => {
        button.classList.toggle('active', button.dataset.graphScope === state.graphScope);
      });
      document.getElementById('toggleGraphLabels').classList.toggle('active', state.graphLabels);
    }

    function renderTrust() {
      const trust = graph.metadata.trust || {
        level: 'medium',
        score: 50,
        reasons: ['Trust score is unavailable for this report schema.'],
        resolvedCallRate: 0,
        averageConfidence: 0,
        unresolvedCalls: 0,
        staticOnly: true
      };
      const level = String(trust.level || 'medium').toLowerCase();
      const pill = document.getElementById('trustPill');
      pill.textContent = level;
      pill.className = 'trust-pill ' + level;
      document.getElementById('trustScore').innerHTML =
        '<div class="trust-card ' + level + '">' +
          '<div class="trust-score-line"><strong>' + Number(trust.score || 0) + '</strong><span>report confidence</span></div>' +
          '<div class="trust-metrics">' +
            '<div class="trust-metric"><span>Resolved calls</span><strong>' + Math.round(Number(trust.resolvedCallRate || 0) * 100) + '%</strong></div>' +
            '<div class="trust-metric"><span>Avg confidence</span><strong>' + Math.round(Number(trust.averageConfidence || 0) * 100) + '%</strong></div>' +
          '</div>' +
          '<ul class="trust-reasons">' + (trust.reasons || []).slice(0, 4).map(reason => '<li>' + escapeHtml(reason) + '</li>').join('') + '</ul>' +
          '<button class="action-btn" id="publishDiagnostics" type="button">Publish Diagnostics</button>' +
          '<button class="action-btn" id="copyPrSummary" type="button">Copy PR Summary</button>' +
        '</div>';
      document.getElementById('publishDiagnostics').onclick = () => {
        sendWebviewMessage({ type: WEBVIEW_MESSAGE_TYPES.publishDiagnostics });
      };
      document.getElementById('copyPrSummary').onclick = async () => {
        await copyText(impactPrSummaryMarkdown());
      };
    }

    function renderSummary() {
      const summaryItems = [
        ['Endpoints', graph.summary.endpoints],
        ['References', graph.evidence.length || graph.summary.references],
        ['Callbacks', graph.summary.callbacks || 0],
        ['Java files', graph.summary.javaFilesScanned],
        ['Nodes', graph.nodes.length],
        ['Edges', graph.edges.length],
        ['Tests', graph.summary.tests],
        ['Annotations', graph.summary.frameworkAnnotations || 0]
      ];
      document.getElementById('topStats').innerHTML = summaryItems.slice(0, 4).map(([label, value]) =>
        '<div class="stat-chip"><span>' + escapeHtml(label) + '</span><strong>' + value + '</strong></div>'
      ).join('');
      document.getElementById('summary').innerHTML = summaryItems.map(([label, value]) =>
        '<div class="metric"><span>' + escapeHtml(label) + '</span><strong>' + value + '</strong></div>'
      ).join('');
      const files = graph.summary.topFiles || [];
      document.getElementById('files').innerHTML = files.length ? files.map(file =>
        '<div class="file-pill" title="' + escapeHtml(file.file) + '"><strong>' + escapeHtml(shortFile(file.file)) + '</strong><div>' + escapeHtml(file.file) + '</div><div>' + file.references + ' refs' + (file.tests ? ' | test' : '') + '</div></div>'
      ).join('') : '<div class="empty">No files found.</div>';
      document.getElementById('warnings').innerHTML = graph.warnings.length
        ? graph.warnings.map(w => '<div class="warning">' + escapeHtml(w) + '</div>').join('')
        : '<div class="empty">No warnings.</div>';
    }

    function renderSuggestedTests() {
      const suggestions = suggestedTestFiles();
      const topTestCommandLimit = ${TEST_COMMAND_BATCH_LIMIT};
      const topTestCommandLabel = 'Run Top ${TEST_COMMAND_BATCH_LIMIT}';
      document.getElementById('testSuggestionCount').innerHTML = suggestions.length
        ? '<button class="copy-test-command" id="runTopTests" type="button">' + topTestCommandLabel + '</button>'
        : '0';
      const runTop = document.getElementById('runTopTests');
      if (runTop) {
        runTop.onclick = event => {
          event.stopPropagation();
          runTestCommands(suggestions.slice(0, topTestCommandLimit).map(item => testCommandForFile(item.file)));
        };
      }
      const list = document.getElementById('suggestedTests');
      if (!suggestions.length) {
        list.innerHTML = '<div class="empty">No related test files found.</div>';
        return;
      }
      list.innerHTML = suggestions.map((item, index) => {
        const command = testCommandForFile(item.file);
        return '<div class="test-suggestion ' + (state.activeMapFilter?.file === item.file ? 'active' : '') + '" role="button" tabindex="0" data-test-file="' + escapeHtml(item.file) + '">' +
          '<div class="test-suggestion-top"><span class="test-rank">' + (index + 1) + '</span><span class="test-file">' + escapeHtml(shortFile(item.file)) + '</span></div>' +
          '<div class="test-meta">' + item.count + ' evidence | first line ' + item.line + '</div>' +
          '<div class="test-meta">' + escapeHtml(item.kinds.join(', ')) + '</div>' +
          '<div class="test-meta"><strong>Why:</strong> ' + escapeHtml(item.why) + '</div>' +
          '<div class="test-command-row"><code title="' + escapeHtml(command) + '">' + escapeHtml(command) + '</code><button class="copy-test-command" type="button" data-run-test-command="' + escapeHtml(item.file) + '">Run</button><button class="copy-test-command" type="button" data-copy-test-command="' + escapeHtml(item.file) + '">Copy</button></div>' +
        '</div>';
      }).join('');
      list.querySelectorAll('[data-run-test-command]').forEach(button => {
        button.onclick = async event => {
          event.stopPropagation();
          const file = button.dataset.runTestCommand || '';
          const started = await runTestCommand(testCommandForFile(file));
          button.textContent = started ? 'Started' : 'Failed';
          setTimeout(() => { button.textContent = 'Run'; }, 1200);
        };
      });
      list.querySelectorAll('[data-copy-test-command]').forEach(button => {
        button.onclick = async event => {
          event.stopPropagation();
          const file = button.dataset.copyTestCommand || '';
          const copied = await copyText(testCommandForFile(file));
          button.textContent = copied ? 'Copied' : 'Failed';
          setTimeout(() => { button.textContent = 'Copy'; }, 1200);
        };
      });
      list.querySelectorAll('[data-test-file]').forEach(button => {
        button.onclick = () => {
          const file = button.dataset.testFile || '';
          state.activeKind = 'all';
          state.activeMapFilter = {
            label: shortFile(file),
            file,
            description: 'Suggested test file'
          };
          state.selectedType = 'filter';
          state.selectedId = file;
          state.selectedMapNode = null;
          state.selectedFilter = state.activeMapFilter;
          clearReferenceSearches();
          renderSuggestedTests();
          renderSelected();
          setActiveTab('references');
        };
        button.onkeydown = event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            button.click();
          }
        };
      });
    }

    function renderFlowList() {
      const flows = graph.flows || [];
      document.getElementById('flowCount').textContent = flows.length + ' flow' + (flows.length === 1 ? '' : 's');
      const list = document.getElementById('flowList');
      if (!flows.length) {
        list.innerHTML = '<div class="empty">No endpoint flow for this target. Use references or call mode for non-controller symbols.</div>';
        return;
      }
      list.innerHTML = flows.map((flow, index) => {
        const endpoint = flow.endpoint || endpointFromLabel(flow.label);
        return '<button class="flow-card ' + (index === state.activeFlow ? 'active' : '') + '" data-flow="' + index + '">' +
          '<div class="flow-main"><span class="method-pill">' + escapeHtml(endpoint.method || 'API') + '</span><span class="flow-path">' + escapeHtml(endpoint.path || flow.label) + '</span></div>' +
          '<div class="flow-sub">' + escapeHtml(flow.endpoint?.handler || flow.label) + '</div>' +
          '<div class="flow-sub">' + flow.steps.length + ' steps | depth ' + flow.maxDepth + (flow.truncated ? ' | truncated' : '') + '</div>' +
          '</button>';
      }).join('');
      list.querySelectorAll('[data-flow]').forEach(button => {
        button.onclick = () => {
          state.activeFlow = Number(button.dataset.flow || 0);
          state.activeDebugStep = 0;
          clearSelection();
          renderFlowList();
          renderSequence();
          renderStaticDebugger();
        };
      });
    }

    function renderSequence() {
      const flow = activeFlow();
      if (!flow) {
        document.getElementById('flowTitle').textContent = 'No sequence';
        document.getElementById('flowMeta').textContent = 'No API endpoint flow was detected for this target.';
        document.getElementById('flowCrumbTitle').textContent = graph.metadata.target + ' | ' + graph.metadata.mode;
        document.getElementById('flowCrumbMeta').textContent = 'No endpoint handler flow detected';
        document.getElementById('mermaidText').textContent = '';
        document.getElementById('flowSteps').innerHTML = '<div class="empty">No flow selected.</div>';
        renderFlowDiagnostics(undefined);
        renderSequenceLegend([]);
        drawEmptySequence();
        scheduleSequenceFit();
        return;
      }
      const endpoint = flow.endpoint || endpointFromLabel(flow.label);
      document.getElementById('flowTitle').textContent = flow.label;
      const model = sequenceModel(flow);
      const kindCounts = summarizeSequenceKinds(flow.steps);
      const unresolvedCount = flow.diagnostics?.unresolvedCalls || 0;
      const detail = [
        flow.steps.length + ' steps',
        'max depth ' + flow.maxDepth,
        (kindCounts['call'] ? kindCounts['call'] + ' calls' : ''),
        (kindCounts['return'] ? kindCounts['return'] + ' returns' : ''),
        unresolvedCount ? unresolvedCount + ' unresolved' : '',
      ].filter(Boolean).join(' | ');
      document.getElementById('flowMeta').textContent = detail + (flow.truncated ? ' | truncated' : '');
      document.getElementById('flowCrumbTitle').textContent = (endpoint.method || 'API') + ' ' + (endpoint.path || flow.label);
      document.getElementById('flowCrumbMeta').textContent = flow.endpoint?.handler || flow.label;
      document.getElementById('mermaidText').textContent = flow.mermaid || '';
      renderSequenceLegend(model.messages);
      renderSequenceHint(flow, model);
      drawSequence(flow, model);
      renderFlowDiagnostics(flow);
      renderFlowSteps(flow);
      scheduleSequenceFit();
    }

    function renderSequenceHint(flow, model) {
      const hint = document.getElementById('sequenceHint');
      if (!hint) return;
      if (!flow) {
        hint.innerHTML = '<span>No flow selected.</span>';
        return;
      }
      const counts = summarizeSequenceKinds(model.messages);
      const unresolvedCount = flow.diagnostics?.unresolvedCalls || 0;
      const kindOrder = ['endpoint', 'handler', 'call', 'return', 'throw', 'branch', 'loop', 'exception', 'method_reference', 'lambda', 'annotation'];
      const headline = kindOrder.find(kind => counts[kind]) || Object.keys(counts)[0] || 'step';
      const lead = model.messages.length + ' / ' + (model.messages.length + 1) + ' transitions';
      const unresolved = unresolvedCount > 0 ? ' | ' + unresolvedCount + ' unresolved' : '';
      hint.innerHTML = '<strong>' + escapeHtml(sequenceKindLabel(headline)) + '</strong> flow across <strong>' + model.participants.length + '</strong> participants | ' +
        '<span>' + escapeHtml(lead) + unresolved + ' | max depth ' + flow.maxDepth + '</span>';
    }

    function drawSequence(flow, model = sequenceModel(flow)) {
      if (!flow) return;
      const left = 98;
      const lanePadding = 42;
      const laneWidth = Math.max(190, Math.min(280, Math.ceil(Math.max(...model.participants.map(item => String(item.label).length), 14) * 11)));
      const headerHeight = 94;
      const messageTop = headerHeight + 28;
      const rowHeight = 76;
      const top = 22;
      const width = Math.max(980, left * 2 + model.participants.length * laneWidth);
      const height = Math.max(540, top + messageTop + model.messages.length * rowHeight);
      sequenceSvg.dataset.baseWidth = String(width);
      sequenceSvg.dataset.baseHeight = String(height);
      sequenceSvg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
      sequenceSvg.setAttribute('width', String(width));
      sequenceSvg.setAttribute('height', String(height));
      sequenceSvg.style.width = Math.round(width * state.sequenceZoom) + 'px';
      sequenceSvg.style.height = Math.round(height * state.sequenceZoom) + 'px';
      document.getElementById('zoomValue').textContent = Math.round(state.sequenceZoom * 100) + '%';
      sequenceSvg.innerHTML = '';

      const defs = svgEl('defs');
      defs.innerHTML = [
        markerDef('seqArrow', '#9aa6b8'),
        markerDef('seqArrowLogic', '#f59e0b'),
        markerDef('seqArrowReturn', '#34d399'),
        markerDef('seqArrowThrow', '#f87171'),
      ].join('');
      sequenceSvg.appendChild(defs);
      const headerBg = svgEl('rect', { x: 0, y: 0, width, height: 94, fill: 'rgba(27, 33, 48, .94)' });
      sequenceSvg.appendChild(headerBg);

      model.participants.forEach((participant, index) => {
        const x = left + index * laneWidth + laneWidth / 2;
        const participantWidth = laneWidth - lanePadding;
        participant.x = x;
        const box = svgEl('rect', { x: x - participantWidth / 2, y: top, width: participantWidth, height: 44, rx: 7, fill: '#151923', stroke: '#2a3343' });
        const text = svgEl('text', { x, y: top + 22, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 760, fill: '#e7edf6' });
        text.textContent = trimLabel(participant.label, 22);
        const role = svgEl('text', { x, y: top + 38, 'text-anchor': 'middle', 'font-size': 10, fill: '#9aa6b8' });
        role.textContent = trimLabel(participant.role || 'participant', 16);
        const line = svgEl('line', { x1: x, y1: top + 48, x2: x, y2: height - 24, stroke: '#334155', 'stroke-dasharray': '5 6' });
        sequenceSvg.appendChild(box);
        sequenceSvg.appendChild(text);
        sequenceSvg.appendChild(role);
        sequenceSvg.appendChild(line);
      });

      const stepById = new Map(flow.steps.map(step => [step.id, step]));
      model.messages.forEach((message, index) => {
        const y = top + messageTop + index * rowHeight;
        const from = model.participants.find(item => item.id === message.from);
        const to = model.participants.find(item => item.id === message.to);
        if (!from || !to) return;
        const band = svgEl('rect', { x: 0, y: y - 34, width, height: rowHeight, fill: index % 2 === 0 ? 'rgba(255,255,255,.018)' : 'rgba(255,255,255,.04)' });
        const markerId = message.kind === 'return'
          ? 'seqArrowReturn'
          : message.kind === 'throw'
            ? 'seqArrowThrow'
            : message.kind === 'branch' || message.kind === 'loop' || message.kind === 'exception'
              ? 'seqArrowLogic'
              : 'seqArrow';
        const lineStyle = message.kind === 'branch' || message.kind === 'loop' || message.kind === 'exception' ? '4 6' : '';
        sequenceSvg.appendChild(band);
        const group = svgEl('g', {
          class: 'message message-' + message.kind + (state.selectedId === message.stepId ? ' selected' : ''),
          'data-step-id': message.stepId,
        });
        const same = from.id === to.id;
        const x1 = from.x;
        const x2 = same ? from.x + 72 : to.x;
        const color = sequenceColor(message.kind);
        const arrowX = same ? x1 + 72 : (x1 + x2) / 2;
        const source = stepById.get(message.stepId);
        const confidence = Math.max(0, Math.min(1, source?.confidence ?? 1));
        const lineOpacity = String(Math.max(0.42, 0.35 + confidence * 0.55));
        if (same) {
          const path = svgEl('path', {
            class: 'message-line',
            d: 'M ' + x1 + ' ' + y + ' C ' + (x1 + 112) + ' ' + y + ', ' + (x1 + 112) + ' ' + (y + 31) + ', ' + x1 + ' ' + (y + 31),
            fill: 'none',
            stroke: color,
            'stroke-width': 1.7,
            'stroke-dasharray': lineStyle,
            'stroke-opacity': lineOpacity,
            'marker-end': 'url(#' + markerId + ')',
          });
          group.appendChild(path);
        } else {
          const line = svgEl('line', {
            class: 'message-line',
            x1,
            y1: y,
            x2,
            y2: y,
            stroke: color,
            'stroke-width': 1.7,
            'stroke-dasharray': lineStyle,
            'stroke-opacity': lineOpacity,
            'marker-end': 'url(#' + markerId + ')',
          });
          group.appendChild(line);
        }
        const badge = svgEl('circle', { cx: Math.min(x1, x2) + 16, cy: y - 17, r: 11, fill: '#111722', stroke: color });
        const badgeText = svgEl('text', { x: Math.min(x1, x2) + 16, y: y - 13, 'text-anchor': 'middle', 'font-size': 9, 'font-weight': 760, fill: '#e7edf6' });
        badgeText.textContent = String(index + 1);
        const endpointMeta = message.kind === 'return' ? 'return' : message.kind;
        group.appendChild(badge);
        group.appendChild(badgeText);
        if (state.showLabels) {
          const labelX = same ? x1 + 92 : (x1 + x2) / 2;
          const routeLabel = svgEl('text', { class: 'message-route label', x: labelX, y: y - 28, 'text-anchor': same ? 'start' : 'middle', 'font-size': 9 });
          routeLabel.textContent = sequenceDirectionLabel(message.kind, from.label, to.label);
          group.appendChild(routeLabel);
          const label = svgEl('text', { class: 'label', x: labelX, y: y - 10, 'text-anchor': same ? 'start' : 'middle', 'font-size': 12, 'font-weight': 650, fill: '#e7edf6' });
          label.setAttribute('class', 'label message-label');
          label.textContent = trimLabel(message.label, same ? 34 : 48);
          const loc = svgEl('text', { x: labelX, y: y + 18, 'text-anchor': same ? 'start' : 'middle', 'font-size': 10, fill: '#9aa6b8' });
          const endpointHint = endpointMeta === 'return' ? ' | return' : '';
          loc.setAttribute('class', 'message-meta');
          loc.textContent = message.fileLine + (endpointHint ? endpointHint : '');
          group.appendChild(label);
          group.appendChild(loc);
        }
        if (state.showLabels && message.fileLine) {
          const confidenceLine = svgEl('text', {
            x: arrowX,
            y: y + 34,
            'text-anchor': same ? 'start' : 'middle',
            'font-size': 9,
            fill: '#6d7787',
          });
          confidenceLine.textContent = source?.confidence !== undefined
            ? 'confidence ' + Math.round(source.confidence * 100) + '%'
            : '';
          if (confidenceLine.textContent) {
            group.appendChild(confidenceLine);
          }
        }
        const title = svgEl('title', {});
        const lineDetails = [];
        if (source) {
          lineDetails.push('kind: ' + sequenceKindLabel(source.kind));
          lineDetails.push('confidence: ' + Math.round(source.confidence * 100) + '%');
          lineDetails.push('file: ' + message.fileLine);
        }
        const route = sequenceDirectionLabel(message.kind, from.label, to.label);
        title.textContent = [
          String(index + 1) + '. ' + escapeHtml(message.label),
          route,
        ].concat(lineDetails).join('\\n');
        group.appendChild(title);
        group.onclick = () => {
          if (state.sequencePan.suppressClick) return;
          selectFlowStep(flow.steps.find(step => step.id === message.stepId));
        };
        sequenceSvg.appendChild(group);
      });
    }

    function drawEmptySequence() {
      const width = Math.max(720, sequenceScroller.clientWidth || 860);
      const height = Math.max(420, sequenceScroller.clientHeight || 520);
      sequenceSvg.dataset.baseWidth = String(width);
      sequenceSvg.dataset.baseHeight = String(height);
      sequenceSvg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
      sequenceSvg.setAttribute('width', String(width));
      sequenceSvg.setAttribute('height', String(height));
      sequenceSvg.style.width = Math.round(width * state.sequenceZoom) + 'px';
      sequenceSvg.style.height = Math.round(height * state.sequenceZoom) + 'px';
      sequenceSvg.innerHTML = '';
      const panel = svgEl('rect', { x: 32, y: 32, width: Math.min(540, width - 64), height: 154, rx: 10, fill: '#151923', stroke: '#2a3343' });
      const title = svgEl('text', { x: 58, y: 78, 'font-size': 18, 'font-weight': 760, fill: '#e7edf6' });
      title.textContent = 'No endpoint sequence for this target';
      const line1 = svgEl('text', { x: 58, y: 112, 'font-size': 13, fill: '#9aa6b8' });
      line1.textContent = 'This mode has graph and reference evidence, but no API handler flow.';
      const line2 = svgEl('text', { x: 58, y: 140, 'font-size': 13, fill: '#9aa6b8' });
      line2.textContent = 'Open References or Graph to inspect impact details.';
      sequenceSvg.appendChild(panel);
      sequenceSvg.appendChild(title);
      sequenceSvg.appendChild(line1);
      sequenceSvg.appendChild(line2);
    }

    function renderFlowSteps(flow) {
      const steps = flow.steps || [];
      document.getElementById('stepCount').textContent = steps.length + ' steps';
      document.getElementById('flowSteps').innerHTML = steps.map((step, index) =>
        '<button class="step-item ' + (state.selectedId === step.id ? 'selected' : '') + '" style="--depth:' + Math.min(step.depth, 5) + '" data-step="' + step.id + '">' +
          '<div class="item-top"><span class="step-num">' + (index + 1) + '</span><span class="kind-tag" style="color: ' + escapeHtml(sequenceColor(step.kind)) + '">' + escapeHtml(step.kind) + '</span></div>' +
          '<div class="item-title">' + escapeHtml(step.label) + '</div>' +
          '<div class="item-meta"><span>depth ' + step.depth + '</span><span>confidence ' + Math.round(step.confidence * 100) + '%</span>' +
          (step.target ? '<span>target ' + escapeHtml(step.target) + '</span>' : '') + '</div>' +
          '<div class="item-loc">' + escapeHtml(shortFile(step.file)) + ':' + step.line + '</div>' +
        '</button>'
      ).join('');
      document.querySelectorAll('[data-step]').forEach(button => {
        button.onclick = () => selectFlowStep(steps.find(step => step.id === button.dataset.step));
      });
    }

    function renderFlowDiagnostics(flow) {
      const container = document.getElementById('flowDiagnostics');
      if (!flow || !flow.diagnostics) {
        container.innerHTML = '<div class="empty">No flow diagnostics available.</div>';
        return;
      }
      const diag = flow.diagnostics;
      const controlCount = diag.branchMarkers + diag.loopMarkers + diag.exceptionMarkers + diag.returnMarkers;
      container.innerHTML =
        '<div class="diagnostics-grid">' +
          diagCard('Resolved', diag.resolvedCalls) +
          diagCard('Unresolved', diag.unresolvedCalls) +
          diagCard('Control', controlCount) +
          diagCard('Confidence', Math.round(diag.averageConfidence * 100) + '%') +
          diagCard('Branches', diag.branchMarkers) +
          diagCard('Loops', diag.loopMarkers) +
          diagCard('Exceptions', diag.exceptionMarkers) +
          diagCard('Returns', diag.returnMarkers) +
        '</div>' +
        '<div class="diag-notes">' + diag.notes.map(note => '<div class="diag-note">' + escapeHtml(note) + '</div>').join('') + '</div>';
    }

    function diagCard(label, value) {
      return '<div class="diag-card"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>';
    }

    function renderStaticDebugger() {
      const session = activeStaticDebugSession();
      const card = document.getElementById('debuggerCard');
      const timeline = document.getElementById('debugTimeline');
      if (!session || !session.steps.length) {
        document.getElementById('debugTitle').textContent = 'Static Debugger';
        document.getElementById('debugMeta').textContent = 'No endpoint flow was detected for this target.';
        document.getElementById('debugStepReadout').textContent = '0/0';
        document.getElementById('debugTimelineCount').textContent = '0 steps';
        card.innerHTML =
          '<div class="debugger-card-body">' +
            '<div class="debugger-warning">Static Debugger needs an endpoint flow. Try api-flow or patch-impact on a controller/resource target.</div>' +
          '</div>';
        timeline.innerHTML = '<div class="empty">No static debug timeline.</div>';
        return;
      }
      state.activeDebugStep = Math.max(0, Math.min(state.activeDebugStep, session.steps.length - 1));
      const step = session.steps[state.activeDebugStep];
      document.getElementById('debugTitle').textContent = 'Static Debugger';
      document.getElementById('debugMeta').textContent = session.label + ' | ' + session.summary.totalSteps + ' steps | ' + session.summary.unresolvedSteps + ' unresolved';
      document.getElementById('debugStepReadout').textContent = step.index + '/' + session.steps.length;
      document.getElementById('debugTimelineCount').textContent = session.steps.length + ' steps';
      card.innerHTML =
        '<div class="debugger-card-head">' +
          '<span class="debugger-step-num">' + step.index + '</span>' +
          '<div class="debugger-step-title"><strong>' + escapeHtml(step.title) + '</strong><span>' + escapeHtml(step.file) + ':' + step.line + '</span></div>' +
          '<span class="debug-confidence ' + escapeHtml(step.confidenceLabel) + '">' + escapeHtml(step.confidenceLabel) + ' ' + Math.round(step.confidence * 100) + '%</span>' +
        '</div>' +
        '<div class="debugger-card-body">' +
          '<div class="debugger-warning">' + escapeHtml(session.summary.staticWarning) + '</div>' +
          '<div class="debugger-why"><strong>Why:</strong> ' + escapeHtml(step.why) + '</div>' +
          '<div class="debugger-meta-grid">' +
            debugMeta('Kind', step.kind) +
            debugMeta('Status', step.status) +
            debugMeta('Depth', step.depth) +
            debugMeta('Target', step.target || '-') +
          '</div>' +
          (step.code ? '<div class="debugger-code">' + escapeHtml(step.code) + '</div>' : '') +
        '</div>';
      timeline.innerHTML = session.steps.map((item, index) =>
        '<button class="debugger-timeline-item ' + (index === state.activeDebugStep ? 'active ' : '') + (item.status === 'unresolved' ? 'unresolved' : '') + '" data-debug-step="' + index + '">' +
          '<div class="debugger-timeline-top"><span class="debugger-timeline-index">' + item.index + '</span><span class="debugger-timeline-kind">' + escapeHtml(item.kind) + '</span></div>' +
          '<div class="debugger-timeline-title">' + escapeHtml(item.title) + '</div>' +
          '<div class="debugger-timeline-loc">' + escapeHtml(shortFile(item.file)) + ':' + item.line + '</div>' +
        '</button>'
      ).join('');
      timeline.querySelectorAll('[data-debug-step]').forEach(button => {
        button.onclick = () => selectStaticDebugStep(Number(button.dataset.debugStep || 0));
      });
    }

    function debugMeta(label, value) {
      return '<div class="debugger-meta"><span>' + escapeHtml(label) + '</span><strong title="' + escapeHtml(value) + '">' + escapeHtml(value) + '</strong></div>';
    }

    function sequenceModel(flow) {
      const participants = new Map();
      const stack = new Map();
      const messages = [];
      const actorFor = (step, parent) => {
        if (step.kind === 'endpoint') return { id: 'Client', label: 'Client' };
        if (step.kind === 'handler') return actor(classFromStep(step) || 'Handler', 'handler');
        if (step.kind === 'branch' || step.kind === 'loop' || step.kind === 'exception') return actor('Logic', 'logic');
        if (step.kind === 'return' || step.kind === 'throw') return actor('Result', 'return');
        if (step.kind === 'method_reference' || step.kind === 'lambda') {
          if (isLikelyUnresolvedLocalStep(step)) return actor(parent?.label || 'Callback', 'callback');
          return actor(classFromStep(step) || simpleOwner(step.target || step.label) || parent?.label || 'Callback', 'callback');
        }
        if (step.kind === 'annotation') return actor('Framework', 'framework');
        if (step.kind === 'call') {
          if (isLikelyUnresolvedLocalStep(step)) return actor(parent?.label || 'Call', 'call');
          return actor(classFromStep(step) || simpleOwner(step.target || step.label) || parent?.label || 'Call', 'call');
        }
        return actor(classFromStep(step) || simpleOwner(step.target || step.label) || 'Call', 'call');
      };
      const ensure = item => {
        if (!participants.has(item.id)) participants.set(item.id, { id: item.id, label: item.label, role: item.role || 'participant', x: 0 });
      };
      flow.steps.forEach((step, index) => {
        const parent = nearestStack(stack, step.depth) || { id: 'Client', label: 'Client', role: 'client' };
        const current = actorFor(step, parent);
        ensure(current);
        ensure(parent);
        if (index > 0) {
          messages.push({
            from: parent.id,
            to: current.id,
            label: step.label,
            kind: step.kind,
            fileLine: shortFile(step.file) + ':' + step.line,
            stepId: step.id
          });
        }
        stack.set(step.depth, current);
      });
      return { participants: [...participants.values()], messages };
    }

    function sequenceColor(kind) {
      if (kind === 'endpoint') return '#f472b6';
      if (kind === 'lambda' || kind === 'method_reference') return '#22d3ee';
      if (kind === 'branch') return '#f59e0b';
      if (kind === 'loop') return '#a78bfa';
      if (kind === 'exception' || kind === 'throw') return '#f87171';
      if (kind === 'return') return '#34d399';
      return '#9aa6b8';
    }

    function summarizeSequenceKinds(steps) {
      return steps.reduce((acc, step) => {
        acc[step.kind] = (acc[step.kind] || 0) + 1;
        return acc;
      }, {});
    }

    function sequenceKindLabel(kind) {
      if (kind === 'method_reference') return 'callback';
      if (kind === 'endpoint') return 'endpoint';
      if (kind === 'handler') return 'handler';
      if (kind === 'lambda') return 'lambda';
      if (kind === 'annotation') return 'annotation';
      if (kind === 'branch') return 'branch';
      if (kind === 'loop') return 'loop';
      if (kind === 'exception') return 'exception';
      if (kind === 'return') return 'return';
      if (kind === 'throw') return 'throw';
      return kind;
    }

    function sequenceDirectionLabel(kind, fromLabel, toLabel) {
      const from = String(fromLabel || '');
      const to = String(toLabel || '');
      if (!from || !to) {
        return sequenceKindLabel(kind);
      }
      if (from === to) {
        return sequenceKindLabel(kind) + ' | ' + from;
      }
      if (kind === 'return' || kind === 'throw') {
        return sequenceKindLabel(kind) + ' : ' + to + ' <- ' + from;
      }
      if (kind === 'branch' || kind === 'loop' || kind === 'exception') {
        return sequenceKindLabel(kind) + ' | ' + from + ' -> ' + to;
      }
      return sequenceKindLabel(kind) + ': ' + from + ' -> ' + to;
    }

    function markerDef(id, color) {
      return '<marker id="' + id + '" markerWidth="10" markerHeight="10" refX="9" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="' + color + '"></path></marker>';
    }

    function renderSequenceLegend(messages) {
      const legend = document.getElementById('sequenceLegend');
      if (!legend) return;
      if (!messages || !messages.length) {
        legend.innerHTML = '<span class="sequence-legend-title">No sequence steps</span>';
        return;
      }
      const counts = summarizeSequenceKinds(messages);
      const entries = Object.entries(counts).sort((left, right) => {
        if (left[1] === right[1]) return String(left[0]).localeCompare(String(right[0]));
        return right[1] - left[1];
      });
      legend.innerHTML =
        '<span class="sequence-legend-title">Flow legend</span>' +
        entries.map(([kind, count]) =>
          '<span class="sequence-legend-item"><span class="sequence-legend-dot" style="background:' + escapeHtml(sequenceColor(kind)) + '"></span>' + escapeHtml(sequenceKindLabel(kind)) + ' (' + Number(count) + ')</span>'
        ).join('');
    }

    function renderReferences() {
      const evidence = graph.evidence || [];
      const mapFiltered = mapFilteredEvidence(evidence);
      const counts = mapFiltered.reduce((acc, item) => {
        acc[item.kind] = (acc[item.kind] || 0) + 1;
        return acc;
      }, {});
      const kinds = ['all', ...Object.keys(counts).sort()];
      const filter = document.getElementById('kindFilter');
      filter.innerHTML = kinds.map(kind => {
        const count = kind === 'all' ? mapFiltered.length : counts[kind];
        return '<button data-kind="' + kind + '" class="' + (kind === state.activeKind ? 'active' : '') + '">' + escapeHtml(kind) + ' ' + count + '</button>';
      }).join('');
      filter.querySelectorAll('[data-kind]').forEach(button => {
        button.onclick = () => {
          state.activeKind = button.dataset.kind || 'all';
          renderReferences();
          renderQuickReferences();
        };
      });

      renderMapFilterBanner(mapFiltered.length, evidence.length);
      const query = (document.getElementById('refSearch').value || '').toLowerCase();
      const filtered = mapFiltered.filter(item => {
        if (state.activeKind !== 'all' && item.kind !== state.activeKind) return false;
        const haystack = [item.kind, item.file, item.line, item.text, item.symbol, item.enclosingSymbol].join(' ').toLowerCase();
        return !query || haystack.includes(query);
      });
      document.getElementById('refResultCount').textContent = filtered.length + ' of ' + evidence.length;
      const groups = groupBy(filtered, item => item.file);
      const list = document.getElementById('refsList');
      if (!filtered.length) {
        list.innerHTML = '<div class="empty">No matching references. Clear search or switch kind filter.</div>';
        return;
      }
      list.innerHTML = Object.entries(groups).map(([file, items]) =>
        '<section class="ref-group"><div class="ref-group-title"><strong>' + escapeHtml(file) + '</strong><span>' + items.length + '</span></div>' +
        items.map(item =>
          '<button class="ref-item ' + (state.selectedId === item.id ? 'selected' : '') + '" data-ev="' + item.id + '" title="Open ' + escapeHtml(shortFile(item.file)) + ':' + item.line + '">' +
            '<div class="item-top"><span class="kind-tag">' + escapeHtml(item.kind) + '</span><span class="item-title">' + escapeHtml(item.symbol || item.text) + '</span><span class="open-hint">Open</span></div>' +
            '<div class="item-loc">line ' + item.line + (item.enclosingSymbol ? ' | ' + escapeHtml(item.enclosingSymbol) : '') + '</div>' +
            '<div class="line">' + escapeHtml(item.text) + '</div>' +
          '</button>'
        ).join('') + '</section>'
      ).join('');
      list.querySelectorAll('[data-ev]').forEach(button => {
        button.onclick = () => selectEvidence(evidence.find(item => item.id === button.dataset.ev), true);
      });
    }

    function renderQuickReferences() {
      const evidence = graph.evidence || [];
      const mapFiltered = mapFilteredEvidence(evidence);
      const counts = mapFiltered.reduce((acc, item) => {
        acc[item.kind] = (acc[item.kind] || 0) + 1;
        return acc;
      }, {});
      const kinds = ['all', ...Object.keys(counts).sort()];
      const filter = document.getElementById('quickKindFilter');
      filter.innerHTML = kinds.map(kind => {
        const count = kind === 'all' ? mapFiltered.length : counts[kind];
        return '<button data-quick-kind="' + kind + '" class="' + (kind === state.activeKind ? 'active' : '') + '">' + escapeHtml(kind) + ' ' + count + '</button>';
      }).join('');
      filter.querySelectorAll('[data-quick-kind]').forEach(button => {
        button.onclick = () => {
          state.activeKind = button.dataset.quickKind || 'all';
          renderQuickReferences();
          renderReferences();
        };
      });

      const query = (document.getElementById('quickRefSearch').value || '').toLowerCase();
      const filtered = mapFiltered.filter(item => {
        if (state.activeKind !== 'all' && item.kind !== state.activeKind) return false;
        const haystack = [item.kind, item.file, item.line, item.text, item.symbol, item.enclosingSymbol].join(' ').toLowerCase();
        return !query || haystack.includes(query);
      });
      document.getElementById('quickRefCount').textContent = filtered.length + ' result' + (filtered.length === 1 ? '' : 's');
      const visible = filtered.slice(0, 24);
      const groups = groupBy(visible, item => item.file);
      const list = document.getElementById('quickRefsList');
      if (!filtered.length) {
        list.innerHTML = '<div class="empty">No matching references.</div>';
        return;
      }
      list.innerHTML = Object.entries(groups).map(([file, items]) =>
        '<section class="ref-group"><div class="ref-group-title"><strong>' + escapeHtml(shortFile(file)) + '</strong><span>' + items.length + '</span></div>' +
        items.map(item =>
          '<button class="ref-item ' + (state.selectedId === item.id ? 'selected' : '') + '" data-quick-ev="' + item.id + '" title="Open ' + escapeHtml(shortFile(item.file)) + ':' + item.line + '">' +
            '<div class="item-top"><span class="kind-tag">' + escapeHtml(item.kind) + '</span><span class="item-title">' + escapeHtml(item.symbol || item.text) + '</span><span class="open-hint">Open</span></div>' +
            '<div class="item-loc">line ' + item.line + (item.enclosingSymbol ? ' | ' + escapeHtml(item.enclosingSymbol) : '') + '</div>' +
            '<div class="line">' + escapeHtml(item.text) + '</div>' +
          '</button>'
        ).join('') + '</section>'
      ).join('') + (filtered.length > visible.length ? '<div class="empty">' + (filtered.length - visible.length) + ' more references. Open the References tab for the full list.</div>' : '');
      list.querySelectorAll('[data-quick-ev]').forEach(button => {
        button.onclick = () => selectEvidence(evidence.find(item => item.id === button.dataset.quickEv), true);
      });
    }

    function renderMapFilterBanner(filteredCount, totalCount) {
      const banner = document.getElementById('mapFilterBanner');
      if (!state.activeMapFilter) {
        banner.hidden = true;
        banner.innerHTML = '';
        return;
      }
      const label = state.activeMapFilter.label || 'Impact map';
      const detail = state.activeMapFilter.description || state.activeMapFilter.file || 'Filtered evidence';
      banner.hidden = false;
      banner.innerHTML =
        '<span><strong>Map filter:</strong> ' + escapeHtml(label) + ' | ' + escapeHtml(detail) + ' | ' + filteredCount + ' of ' + totalCount + '</span>' +
        '<button id="clearMapFilter" type="button">Clear</button>';
      document.getElementById('clearMapFilter').onclick = () => {
        state.activeMapFilter = null;
        state.activeKind = 'all';
        if (state.selectedType === 'filter') clearSelection();
        renderSuggestedTests();
        renderReferences();
        renderQuickReferences();
      };
    }

    function mapFilteredEvidence(evidence) {
      return evidence.filter(item => matchesMapFilter(item, state.activeMapFilter));
    }

    function matchesMapFilter(item, filter) {
      if (!filter) return true;
      if (filter.file && item.file !== filter.file) return false;
      if (filter.files && !filter.files.includes(item.file)) return false;
      if (filter.kinds && !filter.kinds.includes(item.kind)) return false;
      if (filter.testFiles && !isTestFile(item.file)) return false;
      if (filter.excludeTestFiles && isTestFile(item.file)) return false;
      if (filter.excludeKinds && filter.excludeKinds.includes(item.kind)) return false;
      return true;
    }

    function suggestedTestFiles() {
      const endpoints = endpointLabelsForGraph();
      const groups = new Map();
      (graph.evidence || []).forEach(item => {
        if (!item.file || (!isTestFile(item.file) && item.kind !== 'test')) return;
        const normalizedFile = normalizeTestFilePath(item.file);
        const group = groups.get(normalizedFile) || { file: normalizedFile, count: 0, line: item.line || 1, kinds: new Set(), score: 0 };
        group.count++;
        group.line = Math.min(group.line, item.line || group.line);
        group.kinds.add(item.kind);
        group.score += 10 + (item.kind === 'test' ? 5 : 0);
        groups.set(normalizedFile, group);
      });
      return [...groups.values()].map(group => {
        const name = shortFile(group.file);
        let score = group.score;
        if (/ControllerTest\.java$/.test(group.file)) score += 16;
        if (/ServiceTest\.java$/.test(group.file)) score += 10;
        if (/RepositoryTest\.java$/.test(group.file)) score += 6;
        return {
          file: group.file,
          count: group.count,
          line: group.line,
          score,
          kinds: [...group.kinds].sort(),
          name,
          why: testSuggestionWhy(group.file, group.count, endpoints),
          evidenceChain: [
            'Changed target: ' + graph.metadata.target,
            'Impacted endpoint: ' + (endpoints[0] || 'reference evidence'),
            'Test evidence: ' + group.file
          ]
        };
      }).sort((a, b) => b.score - a.score || b.count - a.count || a.file.localeCompare(b.file)).slice(0, 8);
    }

    function testSuggestionWhy(file, count, endpoints) {
      const endpoint = endpoints[0] || 'reference evidence';
      return 'Covers ' + graph.metadata.target + ' via ' + endpoint + ' with ' + count + ' evidence ' + (count === 1 ? 'hit.' : 'hits.');
    }

    function endpointLabelsForGraph() {
      const labels = [];
      (graph.nodes || []).forEach(node => {
        if (node.kind === 'endpoint' && node.label) labels.push(node.label);
      });
      (graph.flows || []).forEach(flow => {
        if (flow.endpoint) labels.push(flow.endpoint.method + ' ' + flow.endpoint.path);
        else if (flow.label) labels.push(flow.label);
      });
      return [...new Set(labels)].filter(Boolean);
    }

    function impactPrSummaryMarkdown() {
      const tests = suggestedTestFiles().slice(0, 5);
      const endpoints = endpointLabelsForGraph();
      const trust = graph.metadata.trust || { level: 'medium', score: 0, unresolvedCalls: 0 };
      const lines = [
        'Changed: ' + graph.metadata.target,
        'Impacted endpoints: ' + (endpoints.length ? endpoints.join(', ') : '-'),
        'Suggested tests: ' + (tests.length ? tests.map(test => testClassNameFromFile(test.file)).join(', ') : '-'),
        'Trust: ' + capitalize(String(trust.level || 'medium')) + ' (' + Number(trust.score || 0) + ')',
        'Unresolved calls: ' + Number(trust.unresolvedCalls || 0)
      ];
      if (tests.length) {
        lines.push('', 'Run:');
        tests.forEach(test => lines.push('- ' + testCommandForFile(test.file)));
        lines.push('', 'Why these tests:');
        tests.forEach(test => lines.push('- ' + testClassNameFromFile(test.file) + ': ' + test.why));
      }
      return lines.join('\\n');
    }

    function testCommandForFile(file) {
      const key = normalizeTestFilePath(String(file));
      return testCommandsByFile[key] || testCommandsByFile[String(file)] || 'Run test class: ' + testClassNameFromFile(file);
    }

    function capitalize(value) {
      const text = String(value || '');
      return text.charAt(0).toUpperCase() + text.slice(1);
    }

    async function copyText(text) {
      if (sendWebviewMessage({ type: WEBVIEW_MESSAGE_TYPES.copyText, text })) {
        return true;
      }
      try {
        await navigator.clipboard.writeText(String(text));
        return true;
      } catch {
        try {
          const textarea = document.createElement('textarea');
          textarea.value = text;
          textarea.setAttribute('readonly', '');
          textarea.style.position = 'fixed';
          textarea.style.left = '-9999px';
          document.body.appendChild(textarea);
          textarea.select();
          const copied = document.execCommand('copy');
          textarea.remove();
          return copied;
        } catch {
          return false;
        }
      }
    }

    async function runTestCommand(command) {
      if (sendWebviewMessage({ type: WEBVIEW_MESSAGE_TYPES.runTestCommand, command })) {
        return true;
      }
      return copyText(command);
    }

    function runTestCommands(commands) {
      const filtered = collectNormalizedCommands(commands);
      if (!filtered.length) return false;
      if (sendWebviewMessage({ type: WEBVIEW_MESSAGE_TYPES.runTestCommands, commands: filtered })) {
        return true;
      }
      copyText(filtered.join('\\n'));
      return true;
    }

    function sendWebviewMessage(message) {
      if (!vscodeApi || !message || typeof message !== 'object') return false;
      const type = message.type;
      if (type === WEBVIEW_MESSAGE_TYPES.copyText) {
        if (typeof message.text !== 'string') return false;
        vscodeApi.postMessage({ type: WEBVIEW_MESSAGE_TYPES.copyText, text: message.text });
        return true;
      }
      if (type === WEBVIEW_MESSAGE_TYPES.runTestCommand) {
        if (typeof message.command !== 'string') return false;
        const command = message.command.trim();
        if (!command.length) return false;
        vscodeApi.postMessage({ type: WEBVIEW_MESSAGE_TYPES.runTestCommand, command });
        return true;
      }
      if (type === WEBVIEW_MESSAGE_TYPES.runTestCommands) {
        if (!Array.isArray(message.commands)) return false;
        const commands = collectNormalizedCommands(message.commands);
        if (!commands.length) return false;
        vscodeApi.postMessage({ type: WEBVIEW_MESSAGE_TYPES.runTestCommands, commands });
        return true;
      }
      if (type === WEBVIEW_MESSAGE_TYPES.openLocation) {
        if (typeof message.file !== 'string' || !message.file.trim().length) return false;
        const rawLine = Number(message.line);
        const normalizedLine = Number.isFinite(rawLine) && rawLine > 0 ? Math.floor(rawLine) : 1;
        vscodeApi.postMessage({ type: WEBVIEW_MESSAGE_TYPES.openLocation, file: message.file, line: normalizedLine });
        return true;
      }
      if (type === WEBVIEW_MESSAGE_TYPES.publishDiagnostics) {
        vscodeApi.postMessage({ type: WEBVIEW_MESSAGE_TYPES.publishDiagnostics });
        return true;
      }
      return false;
    }
${webviewNormalizedCommandsJs}

    function clearReferenceSearches() {
      document.getElementById('refSearch').value = '';
      document.getElementById('quickRefSearch').value = '';
    }

    function drawGraph() {
      renderGraphControls();
      const width = Math.max(820, graphSvg.clientWidth || 960);
      const height = Math.max(560, graphSvg.clientHeight || 640);
      graphSvg.setAttribute('viewBox', '0 0 ' + width + ' ' + height);
      graphSvg.innerHTML = '<defs><marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" fill="#697586"></path></marker></defs>';
      if (state.graphScope === 'map') {
        graphSvg.classList.remove('dense');
        drawImpactMap(width, height);
        return;
      }

      graphSvg.classList.toggle('dense', !state.graphLabels);
      const display = rawGraphDisplayModel();
      document.getElementById('graphMeta').textContent =
        display.nodes.length + ' of ' + graph.nodes.length + ' nodes, ' +
        display.edges.length + ' of ' + graph.edges.length + ' edges | raw';
      const positions = graphLayout(width, height, display.nodes);
      display.edges.forEach(edge => {
        const from = positions.get(edge.from);
        const to = positions.get(edge.to);
        if (!from || !to) return;
        const line = svgEl('line', {
          class: 'edge ' + edge.kind + (state.selectedId === edge.id || state.selectedId === edge.meta?.evidenceId ? ' selected' : ''),
          x1: from.x,
          y1: from.y,
          x2: to.x,
          y2: to.y,
          'data-edge-id': edge.id
        });
        line.onclick = () => selectEdge(edge);
        graphSvg.appendChild(line);
      });
      positions.forEach(item => {
        const selected = state.selectedId === item.node.id;
        const group = svgEl('g', { class: 'node' + (selected ? ' selected' : ''), 'data-node-id': item.node.id });
        const circle = svgEl('circle', {
          cx: item.x,
          cy: item.y,
          r: item.node.kind === 'target' ? 20 : 11,
          fill: colors[item.node.kind] || '#697586'
        });
        group.appendChild(circle);
        if (state.graphLabels || selected || item.node.kind === 'target') {
          const text = svgEl('text', { x: item.x + 15, y: item.y + 4 });
          text.textContent = trimLabel(item.node.label, 28);
          group.appendChild(text);
        }
        group.onclick = () => selectNode(item.node);
        graphSvg.appendChild(group);
      });
    }

    function rawGraphDisplayModel() {
      return { nodes: graph.nodes || [], edges: graph.edges || [] };
    }

    function drawImpactMap(width, height) {
      const model = impactMapModel();
      document.getElementById('graphMeta').textContent =
        model.entryNodes.length + ' entrypoints, ' +
        model.prodNodes.length + ' production groups, ' +
        model.signalNodes.length + ' signal groups | map';

      const laneTop = 34;
      const laneBottom = height - 24;
      const laneHeight = Math.max(460, laneBottom - laneTop);
      const laneLeft = 26;
      const laneGap = 24;
      const cardWidth = Math.min(210, Math.max(160, (width - laneLeft * 2 - laneGap * 3) / 4));
      const columnX = index => laneLeft + index * (cardWidth + laneGap);
      const columns = [
        { key: 'entry', title: 'Entry', x: columnX(0), nodes: model.entryNodes },
        { key: 'target', title: 'Target', x: columnX(1), nodes: [model.targetNode] },
        { key: 'prod', title: 'Production impact', x: columnX(2), nodes: model.prodNodes },
        { key: 'signals', title: 'Signals', x: columnX(3), nodes: model.signalNodes }
      ];
      columns.forEach(column => {
        const lane = svgEl('g', { class: 'map-lane' });
        lane.appendChild(svgEl('rect', { x: column.x - 10, y: laneTop, width: cardWidth + 20, height: laneHeight, rx: 10 }));
        const label = svgEl('text', { x: column.x, y: laneTop + 22 });
        label.textContent = column.title;
        lane.appendChild(label);
        graphSvg.appendChild(lane);
      });

      const positions = new Map();
      columns.forEach(column => {
        const nodes = column.nodes.length ? column.nodes : [emptyMapNode(column.key)];
        const cardHeight = column.key === 'target' ? 88 : 58;
        const gap = 11;
        const total = nodes.length * cardHeight + (nodes.length - 1) * gap;
        const startY = column.key === 'target'
          ? laneTop + laneHeight / 2 - cardHeight / 2
          : Math.max(laneTop + 44, laneTop + 52 + Math.max(0, (laneHeight - 76 - total) / 2));
        nodes.forEach((node, index) => {
          const y = startY + index * (cardHeight + gap);
          positions.set(node.id, { x: column.x, y, width: cardWidth, height: cardHeight, node });
        });
      });

      const drawEdge = (fromId, toId, hot) => {
        const from = positions.get(fromId);
        const to = positions.get(toId);
        if (!from || !to) return;
        const x1 = from.x + from.width;
        const y1 = from.y + from.height / 2;
        const x2 = to.x;
        const y2 = to.y + to.height / 2;
        const bend = Math.max(34, Math.abs(x2 - x1) * .42);
        const edge = svgEl('path', {
          class: 'map-edge' + (hot ? ' hot' : ''),
          d: 'M ' + x1 + ' ' + y1 + ' C ' + (x1 + bend) + ' ' + y1 + ', ' + (x2 - bend) + ' ' + y2 + ', ' + x2 + ' ' + y2
        });
        graphSvg.appendChild(edge);
      };
      model.entryNodes.forEach(node => drawEdge(node.id, model.targetNode.id, true));
      model.prodNodes.forEach((node, index) => drawEdge(model.targetNode.id, node.id, index < 3));
      model.signalNodes.forEach(node => drawEdge(model.targetNode.id, node.id, false));

      positions.forEach(item => drawMapNode(item));
    }

    function drawMapNode(item) {
      const node = item.node;
      const selected = state.selectedType === 'map' && state.selectedId === node.id;
      const group = svgEl('g', { class: 'map-node' + (selected ? ' selected' : ''), 'data-map-node': node.id });
      group.appendChild(svgEl('rect', { x: item.x, y: item.y, width: item.width, height: item.height, rx: 8 }));
      const color = node.color || colors[node.kind] || '#697586';
      group.appendChild(svgEl('rect', { x: item.x, y: item.y, width: 5, height: item.height, rx: 5, fill: color, stroke: 'none' }));
      const title = svgEl('text', { class: 'map-title', x: item.x + 13, y: item.y + 22 });
      const countReserve = node.count !== undefined ? 28 + String(node.count).length * 8 : 0;
      const titleSpace = item.width - 22 - countReserve;
      title.textContent = trimLabel(node.title, Math.max(12, Math.floor(titleSpace / 7)));
      group.appendChild(title);
      const subtitle = svgEl('text', { class: 'map-subtitle', x: item.x + 13, y: item.y + 42 });
      subtitle.textContent = trimLabel(node.subtitle || '', Math.max(20, Math.floor(item.width / 7)));
      group.appendChild(subtitle);
      if (node.count !== undefined) {
        const count = svgEl('text', { class: 'map-count', x: item.x + item.width - 12, y: item.y + 22 });
        count.textContent = String(node.count);
        group.appendChild(count);
      }
      group.onclick = () => selectMapNode(node);
      graphSvg.appendChild(group);
    }

    function impactMapModel() {
      const evidence = graph.evidence || [];
      const flows = graph.flows || [];
      const targetNode = {
        id: 'map:target',
        kind: 'target',
        title: graph.metadata.target,
        subtitle: graph.summary.references + ' refs | ' + graph.summary.tests + ' tests | ' + graph.summary.callbacks + ' callbacks',
        count: evidence.length,
        color: colors.target
      };
      const entryNodes = flows.slice(0, 5).map((flow, index) => {
        const endpoint = flow.endpoint || endpointFromLabel(flow.label);
        return {
          id: 'map:entry:' + index,
          kind: 'endpoint',
          title: (endpoint.method || 'API') + ' ' + (endpoint.path || flow.label),
          subtitle: trimLabel(flow.endpoint?.handler || flow.label, 42),
          count: flow.steps.length,
          file: flow.endpoint?.file,
          line: flow.endpoint?.line,
          filter: flow.endpoint?.file
            ? { label: (endpoint.method || 'API') + ' ' + (endpoint.path || flow.label), file: flow.endpoint.file, description: 'Endpoint handler file' }
            : { label: (endpoint.method || 'API') + ' ' + (endpoint.path || flow.label), kinds: ['endpoint'], description: 'Endpoint evidence' },
          color: colors.endpoint
        };
      });

      const prodItems = evidence.filter(item =>
        !isTestFile(item.file) &&
        item.kind !== 'framework_annotation' &&
        item.kind !== 'lambda' &&
        item.kind !== 'method_reference' &&
        item.kind !== 'endpoint'
      );
      const prodGroups = fileGroups(prodItems);
      const shownProd = prodGroups.slice(0, 8);
      const prodNodes = shownProd.map((group, index) => ({
        id: 'map:prod:' + index,
        kind: 'file',
        title: shortFile(group.file),
        subtitle: group.count + ' refs | ' + fileRole(group.file),
        count: group.count,
        file: group.file,
        line: group.line,
        filter: { label: shortFile(group.file), file: group.file, description: fileRole(group.file) + ' file' },
        color: colors.file
      }));
      const remainingProd = prodGroups.slice(8).reduce((sum, group) => sum + group.count, 0);
      if (remainingProd > 0) {
        prodNodes.push({
          id: 'map:prod:other',
          kind: 'file',
          title: 'Other production files',
          subtitle: (prodGroups.length - 8) + ' more files',
          count: remainingProd,
          filter: {
            label: 'Other production files',
            files: prodGroups.slice(8).map(group => group.file),
            description: (prodGroups.length - 8) + ' remaining files'
          },
          color: colors.file
        });
      }

      const testItems = evidence.filter(item => item.kind === 'test');
      const callbackItems = evidence.filter(item => item.kind === 'lambda' || item.kind === 'method_reference');
      const frameworkItems = evidence.filter(item => item.kind === 'framework_annotation');
      const signalNodes = [
        signalNode('tests', 'Tests', testItems, colors.test, graph.summary.tests),
        signalNode('callbacks', 'Callbacks', callbackItems, colors.callback, graph.summary.callbacks),
        signalNode('framework', 'Framework annotations', frameworkItems, colors.annotation, graph.summary.frameworkAnnotations)
      ].filter(Boolean);
      const mappedCount = prodItems.length + graph.summary.tests + graph.summary.callbacks + graph.summary.frameworkAnnotations + flows.length;
      const otherCount = Math.max(0, evidence.length - mappedCount);
      if (otherCount > 0) {
        signalNodes.push({
          id: 'map:signal:other',
          kind: 'symbol',
          title: 'Other evidence',
          subtitle: 'Remaining matched facts',
          count: otherCount,
          filter: { label: 'Other evidence', excludeTestFiles: true, excludeKinds: ['framework_annotation', 'lambda', 'method_reference'], description: 'Non-signal evidence' },
          color: colors.symbol
        });
      }

      return { targetNode, entryNodes, prodNodes, signalNodes };
    }

    function signalNode(id, title, items, color, displayCount) {
      const count = Number(displayCount || items.length);
      if (!count) return null;
      const files = new Set(items.map(item => item.file));
      const first = items[0];
      return {
        id: 'map:signal:' + id,
        kind: id === 'tests' ? 'test' : id === 'callbacks' ? 'callback' : 'annotation',
        title,
        subtitle: files.size + ' file' + (files.size === 1 ? '' : 's'),
        count,
        file: first?.file,
        line: first?.line,
        filter: id === 'tests'
          ? { label: title, testFiles: true, description: 'Test file evidence' }
          : id === 'callbacks'
            ? { label: title, kinds: ['lambda', 'method_reference'], description: 'Callback evidence' }
            : { label: title, kinds: ['framework_annotation'], description: 'Framework annotation evidence' },
        color
      };
    }

    function fileGroups(items) {
      const groups = new Map();
      items.forEach(item => {
        const group = groups.get(item.file) || { file: item.file, count: 0, line: item.line };
        group.count++;
        group.line = Math.min(group.line, item.line);
        groups.set(item.file, group);
      });
      return [...groups.values()].sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));
    }

    function emptyMapNode(key) {
      return { id: 'map:empty:' + key, kind: 'symbol', title: 'None', subtitle: '', count: 0, color: '#697586' };
    }

    function graphLayout(width, height, nodes) {
      const center = { x: width / 2, y: height / 2 };
      const byId = new Map(nodes.map((node, index) => [node.id, { node, index, x: center.x, y: center.y }]));
      const groups = ['target', 'endpoint', 'method', 'callback', 'annotation', 'symbol', 'file', 'test'];
      groups.forEach(kind => {
        const items = [...byId.values()].filter(item => item.node.kind === kind);
        const radius = kind === 'target' ? 0 : 110 + groups.indexOf(kind) * 54;
        items.forEach((item, i) => {
          const angle = (Math.PI * 2 * i / Math.max(items.length, 1)) + groups.indexOf(kind) * .42;
          item.x = center.x + Math.cos(angle) * Math.min(radius, width * .44);
          item.y = center.y + Math.sin(angle) * Math.min(radius, height * .40);
        });
      });
      return byId;
    }

    function selectFlowStep(step) {
      if (!step) return;
      state.selectedType = 'step';
      state.selectedId = step.id;
      const debugIndex = (activeStaticDebugSession()?.steps || []).findIndex(item => item.flowStepId === step.id);
      if (debugIndex >= 0) state.activeDebugStep = debugIndex;
      renderSelected();
      renderFlowSteps(activeFlow());
      drawSequence(activeFlow());
      renderStaticDebugger();
    }

    function selectStaticDebugStep(index) {
      const session = activeStaticDebugSession();
      if (!session || !session.steps.length) return;
      state.activeDebugStep = Math.max(0, Math.min(Number(index) || 0, session.steps.length - 1));
      const step = session.steps[state.activeDebugStep];
      state.selectedType = 'step';
      state.selectedId = step.flowStepId;
      renderStaticDebugger();
      renderSelected();
      renderFlowSteps(activeFlow());
      drawSequence(activeFlow());
    }

    function selectEvidence(item, openSource) {
      if (!item) return;
      state.selectedType = 'evidence';
      state.selectedId = item.id;
      renderSelected();
      renderReferences();
      renderQuickReferences();
      drawGraph();
      if (openSource) openLocation(item.file, item.line);
    }

    function selectMapNode(node) {
      if (!node || node.id.startsWith('map:empty:')) return;
      state.selectedType = 'map';
      state.selectedId = node.id;
      state.selectedMapNode = node;
      state.selectedFilter = null;
      state.activeKind = 'all';
      state.activeMapFilter = node.filter || null;
      clearReferenceSearches();
      renderSelected();
      renderSuggestedTests();
      setActiveTab('references');
    }

    function selectNode(node) {
      if (!node) return;
      state.selectedType = 'node';
      state.selectedId = node.id;
      renderSelected();
      drawGraph();
    }

    function selectEdge(edge) {
      if (!edge) return;
      state.selectedType = 'edge';
      state.selectedId = edge.id;
      renderSelected();
      drawGraph();
    }

    function bindSequencePan() {
      sequenceScroller.addEventListener('pointerdown', startSequencePan);
      sequenceScroller.addEventListener('pointermove', moveSequencePan);
      sequenceScroller.addEventListener('pointerup', endSequencePan);
      sequenceScroller.addEventListener('pointercancel', endSequencePan);
      sequenceScroller.addEventListener('pointerleave', endSequencePan);
    }

    function startSequencePan(event) {
      if (event.button !== undefined && event.button !== 0) return;
      if (event.target && event.target.closest && event.target.closest('button, input, textarea, select, a, summary')) return;
      state.sequencePan.active = true;
      state.sequencePan.moved = false;
      state.sequencePan.pointerId = event.pointerId;
      state.sequencePan.startX = event.clientX;
      state.sequencePan.startY = event.clientY;
      state.sequencePan.scrollLeft = sequenceScroller.scrollLeft;
      state.sequencePan.scrollTop = sequenceScroller.scrollTop;
      sequenceScroller.classList.add('dragging');
      if (sequenceScroller.setPointerCapture && event.pointerId !== undefined) {
        sequenceScroller.setPointerCapture(event.pointerId);
      }
    }

    function moveSequencePan(event) {
      if (!state.sequencePan.active || state.sequencePan.pointerId !== event.pointerId) return;
      const dx = event.clientX - state.sequencePan.startX;
      const dy = event.clientY - state.sequencePan.startY;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        state.sequencePan.moved = true;
        state.sequencePan.suppressClick = true;
        event.preventDefault();
      }
      sequenceScroller.scrollLeft = state.sequencePan.scrollLeft - dx;
      sequenceScroller.scrollTop = state.sequencePan.scrollTop - dy;
    }

    function endSequencePan(event) {
      if (!state.sequencePan.active || (event.pointerId !== undefined && state.sequencePan.pointerId !== event.pointerId)) return;
      const moved = state.sequencePan.moved;
      state.sequencePan.active = false;
      state.sequencePan.moved = false;
      state.sequencePan.pointerId = null;
      sequenceScroller.classList.remove('dragging');
      if (sequenceScroller.releasePointerCapture && event.pointerId !== undefined) {
        try { sequenceScroller.releasePointerCapture(event.pointerId); } catch {}
      }
      if (moved) {
        setTimeout(() => { state.sequencePan.suppressClick = false; }, 0);
      } else {
        state.sequencePan.suppressClick = false;
      }
    }

    function openLocation(file, line) {
      const normalizedLine = Number(line) || 1;
      if (vscodeApi) {
        sendWebviewMessage({ type: WEBVIEW_MESSAGE_TYPES.openLocation, file, line: normalizedLine });
        return;
      }
      const root = String(graph.metadata.root || '').replace(/\\\\/g, '/').replace(/\\/$/, '');
      const rel = String(file || '').replace(/\\\\/g, '/').replace(/^\\/+/, '');
      if (!root || !rel) return;
      const target = root + '/' + rel + ':' + normalizedLine + ':1';
      window.open('vscode://file/' + encodeURI(target), '_blank', 'noopener');
    }

    function renderSelected() {
      const box = document.getElementById('selected');
      if (!state.selectedType || !state.selectedId) {
        const flow = activeFlow();
        if (flow) {
          const endpoint = flow.endpoint || endpointFromLabel(flow.label);
          box.innerHTML =
            '<div class="selected-table">' +
            '<div class="selected-row"><span>Endpoint</span><div><strong><span class="selected-method">' + escapeHtml(endpoint.method || 'API') + '</span>' + escapeHtml(endpoint.path || flow.label) + '</strong></div></div>' +
            '<div class="selected-row"><span>Handler</span><div>' + escapeHtml(flow.endpoint?.handler || flow.label) + '</div></div>' +
            '<div class="selected-row"><span>File</span><div>' + escapeHtml(flow.endpoint?.file || '-') + (flow.endpoint?.line ? ':' + flow.endpoint.line : '') + '</div></div>' +
            '<div class="selected-row"><span>Steps</span><div>' + flow.steps.length + ' steps, max depth ' + flow.maxDepth + '</div></div>' +
            '</div>';
          return;
        }
        box.innerHTML = 'Select a flow step, reference, node, or edge.';
        return;
      }
      if (state.selectedType === 'filter') {
        const filter = state.selectedFilter || state.activeMapFilter;
        box.innerHTML = filter ? '<strong>' + escapeHtml(filter.label || 'Reference filter') + '</strong>' +
          '<div>' + escapeHtml(filter.description || 'Filtered references') + '</div>' +
          (filter.file ? '<div class="item-loc">' + escapeHtml(filter.file) + '</div>' : '') +
          '<div class="item-loc">References are filtered by this selection.</div>' : 'Selected filter is no longer active.';
        return;
      }
      if (state.selectedType === 'map') {
        const node = state.selectedMapNode;
        box.innerHTML = node ? '<strong>' + escapeHtml(node.title) + '</strong>' +
          '<div>' + escapeHtml(node.subtitle || '') + '</div>' +
          (node.file ? '<div class="item-loc">' + escapeHtml(node.file) + (node.line ? ':' + node.line : '') + '</div>' : '') +
          (node.count !== undefined ? '<div class="item-loc">' + node.count + ' mapped item' + (node.count === 1 ? '' : 's') + '</div>' : '') +
          (node.filter ? '<div class="item-loc">References are filtered by this map group.</div>' : '') : 'Selected map group is no longer visible.';
        return;
      }
      if (state.selectedType === 'step') {
        const step = (activeFlow()?.steps || []).find(item => item.id === state.selectedId);
        box.innerHTML = step ? '<strong>' + escapeHtml(step.kind) + '</strong><div>' + escapeHtml(step.label) + '</div><div class="item-loc">' + escapeHtml(step.file) + ':' + step.line + '</div>' + (step.text ? '<div class="line">' + escapeHtml(step.text) + '</div>' : '') + '<div class="item-loc">confidence ' + Math.round(step.confidence * 100) + '%</div>' : 'Selected step is no longer visible.';
        return;
      }
      if (state.selectedType === 'evidence') {
        const item = (graph.evidence || []).find(entry => entry.id === state.selectedId);
        box.innerHTML = item ? '<strong>' + escapeHtml(item.kind) + '</strong><div>' + escapeHtml(item.file) + ':' + item.line + '</div><div class="line">' + escapeHtml(item.text) + '</div>' + (item.enclosingSymbol ? '<div class="item-loc">' + escapeHtml(item.enclosingSymbol) + '</div>' : '') + '<div class="item-loc">confidence ' + Math.round(item.confidence * 100) + '%</div>' : 'Selected reference is no longer visible.';
        return;
      }
      if (state.selectedType === 'node') {
        const node = graph.nodes.find(item => item.id === state.selectedId);
        box.innerHTML = node ? '<strong>' + escapeHtml(node.kind) + '</strong><div>' + escapeHtml(node.label) + '</div>' + (node.file ? '<div class="item-loc">' + escapeHtml(node.file) + ':' + (node.line || '') + '</div>' : '') : 'Selected node is no longer visible.';
        return;
      }
      if (state.selectedType === 'edge') {
        const edge = graph.edges.find(item => item.id === state.selectedId);
        box.innerHTML = edge ? '<strong>' + escapeHtml(edge.kind) + '</strong><div>' + escapeHtml(edge.label) + '</div>' + (edge.file ? '<div class="item-loc">' + escapeHtml(edge.file) + ':' + (edge.line || '') + '</div>' : '') + '<div class="item-loc">confidence ' + Math.round(edge.confidence * 100) + '%</div>' : 'Selected edge is no longer visible.';
      }
    }

    function clearSelection() {
      state.selectedType = null;
      state.selectedId = null;
      state.selectedMapNode = null;
      state.selectedFilter = null;
      renderSelected();
    }

    function setSequenceZoom(value, options = {}) {
      state.sequenceZoom = Math.max(MIN_SEQUENCE_ZOOM, Math.min(1.8, value));
      drawSequence(activeFlow());
      if (options.resetScroll) resetSequenceViewport();
    }

    function fitSequence(options = {}) {
      const baseWidth = Number(sequenceSvg.dataset.baseWidth || 980);
      const baseHeight = Number(sequenceSvg.dataset.baseHeight || 540);
      const availableWidth = Math.max(320, sequenceScroller.clientWidth - 28);
      const availableHeight = Math.max(260, sequenceScroller.clientHeight - 28);
      const widthZoom = availableWidth / baseWidth;
      const heightZoom = availableHeight / baseHeight;
      setSequenceZoom(Math.max(MIN_SEQUENCE_ZOOM, Math.min(MAX_SEQUENCE_FIT_ZOOM, widthZoom, heightZoom)), options);
    }

    function scheduleSequenceFit() {
      if (sequenceFitFrame && typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(sequenceFitFrame);
      }
      sequenceFitFrame = window.requestAnimationFrame(() => {
        sequenceFitFrame = 0;
        if (state.activeTab === 'sequence') fitSequence({ resetScroll: true });
      });
    }

    function resetSequenceViewport() {
      sequenceScroller.scrollLeft = 0;
      sequenceScroller.scrollTop = 0;
    }

    function activeFlow() {
      return (graph.flows || [])[state.activeFlow];
    }

    function activeStaticDebugSession() {
      return (staticDebuggerSessions || [])[state.activeFlow];
    }

    function activeStaticDebugStep() {
      return activeStaticDebugSession()?.steps?.[state.activeDebugStep];
    }

    function staticDebugTraceMarkdown(session) {
      if (!session) return 'Static Debugger: no endpoint flow selected.';
      const lines = [
        'Static Debug: ' + session.label,
        session.summary.staticWarning,
        '',
        'Steps: ' + session.summary.totalSteps,
        'Resolved: ' + session.summary.resolvedSteps,
        'Unresolved: ' + session.summary.unresolvedSteps,
        'Control markers: ' + session.summary.controlMarkers,
        ''
      ];
      (session.steps || []).forEach(step => {
        lines.push(step.index + '. ' + step.title);
        lines.push('   ' + step.file + ':' + step.line);
        lines.push('   Why: ' + step.why);
        if (step.code) lines.push('   Code: ' + step.code);
      });
      return lines.join('\\n');
    }

    function svgEl(name, attrs) {
      const el = document.createElementNS('http://www.w3.org/2000/svg', name);
      if (attrs) Object.entries(attrs).forEach(([key, value]) => el.setAttribute(key, String(value)));
      return el;
    }

    function actor(value, role) {
      const label = value || 'Participant';
      return { id: label.replace(/[^A-Za-z0-9_]/g, '_') || 'Participant', label, role };
    }

    function endpointFromLabel(label) {
      const match = /^([A-Z]+)\\s+(.+)$/.exec(String(label || ''));
      return match ? { method: match[1], path: match[2] } : { method: 'API', path: label };
    }

    function isLikelyMethodName(value) {
      const clean = String(value || '').replace(/\\([^)]*\\)/g, '').trim();
      return /^[a-z_$][\\w$]*$/.test(clean) && !clean.includes('.');
    }

    function isLikelyCallFromThisLikeOwner(label) {
      const clean = String(label || '').replace(/\\([^)]*\\)/g, '');
      const parts = clean.split('.').filter(Boolean);
      const owner = parts.length > 1 ? parts[parts.length - 2] : '';
      return owner === '' || owner === 'this' || owner === 'super';
    }

    function isLikelyUnresolvedLocalStep(step) {
      if (!step || (step.kind !== 'call' && step.kind !== 'method_reference' && step.kind !== 'lambda')) return false;
      return isLikelyMethodName(step.target) && isLikelyCallFromThisLikeOwner(step.label);
    }

    function nearestStack(stack, depth) {
      for (let cursor = depth - 1; cursor >= 0; cursor--) {
        if (stack.has(cursor)) return stack.get(cursor);
      }
      return null;
    }

    function classFromStep(step) {
      if (!step) return undefined;
      const targetClass = classFromSymbol(step.target || '');
      if (targetClass) return targetClass;
      if (step.kind === 'method_reference' || step.kind === 'lambda') {
        const callbackMatch = /^([A-Za-z_$][\\w$]*)::/.exec(String(step.label || ''));
        if (callbackMatch) return callbackMatch[1];
      }
      return classFromSymbol(step.label || step.target || '');
    }

    function simpleOwner(value) {
      const clean = String(value || '').replace(/\\([^)]*\\)/g, '');
      const parts = clean.split('.').filter(Boolean);
      return parts.length > 1 ? parts[parts.length - 2] : parts[0];
    }

    function classFromSymbol(value) {
      const clean = String(value || '').replace(/\\([^)]*\\)/g, '');
      const parts = clean.split('.').filter(Boolean);
      return parts.length > 1 ? parts[parts.length - 2] : parts[0];
    }

    function shortFile(file) {
      const parts = String(file || '').replace(/\\\\/g, '/').split('/');
      return parts.slice(-2).join('/');
    }

    function fileRole(file) {
      const normalized = String(file || '').replace(/\\\\/g, '/').toLowerCase();
      if (normalized.includes('/controllers/')) return 'controller';
      if (normalized.includes('/services/')) return 'service';
      if (normalized.includes('/repositories/')) return 'repository';
      if (normalized.includes('/entities/')) return 'entity';
      if (isTestFile(file)) return 'test';
      return 'file';
    }

    function isTestFile(file) {
      const normalized = String(file || '').replace(/\\\\/g, '/');
      return /(^|\\/)(src\\/test|test|tests|it|integrationTest)(\\/|$)/i.test(normalized) || /(?:Test|Tests|IT)\\.java$/i.test(normalized);
    }

    function normalizeTestFilePath(file) {
      return String(file || '').replace(/\\\\/g, '/');
    }

    function testClassNameFromFile(file) {
      const normalized = normalizeTestFilePath(file);
      const javaMarker = 'src/test/java/';
      const javaIndex = normalized.indexOf(javaMarker);
      if (javaIndex >= 0) {
        return normalized.slice(javaIndex + javaMarker.length).replace(/\\.java$/, '').split('/').join('.');
      }
      const testIndex = normalized.indexOf('/test/');
      if (testIndex >= 0) {
        return normalized.slice(testIndex + '/test/'.length).replace(/\\.java$/, '').split('/').join('.');
      }
      const parts = normalized.replace(/\\.java$/, '').split('/').filter(Boolean);
      return parts.length ? parts[parts.length - 1] : normalized;
    }

    function trimLabel(value, max) {
      const text = String(value || '');
      return text.length > max ? text.slice(0, max - 3) + '...' : text;
    }

    function groupBy(items, getKey) {
      return items.reduce((groups, item) => {
        const key = getKey(item);
        (groups[key] ||= []).push(item);
        return groups;
      }, {});
    }

    function escapeHtml(value) {
      return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    }
  </script>
</body>
</html>`;
}

function safeJsonForHtml(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function resolveManifestVersion(override: string | undefined): string {
  if (typeof override === 'string') {
    const explicit = override.trim();
    if (explicit.length > 0) return explicit;
  }

  const manifestPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../package.json');
  try {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    const parsed = JSON.parse(content) as { version?: unknown };
    const version = parsed?.version;
    if (typeof version === 'string' && version.trim().length > 0) {
      return version.trim();
    }
  } catch {
    return 'unknown';
  }

  return 'unknown';
}

function formatVersionLabel(version: string): string {
  const trimmed = version.trim();
  if (trimmed.length === 0) return 'vunknown';
  const prefixed = trimmed.startsWith('v') ? trimmed : `v${trimmed}`;
  return prefixed.replace(/[&<>\"']/g, '');
}
