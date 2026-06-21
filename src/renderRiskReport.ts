import type { PatchRiskReport } from './riskReport.js';
import { TEST_COMMAND_BATCH_LIMIT } from './testCommandRunner.js';
import { webviewMessageTypesJs, webviewNormalizedCommandsJs } from './webviewMessageSnippets.js';

export function renderPatchRiskReportHtml(report: PatchRiskReport): string {
  const data = safeJsonForHtml(report);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Java Impact Flow Patch Risk</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: var(--vscode-editor-background, #0f1117);
      --panel: var(--vscode-sideBar-background, #151923);
      --panel-2: var(--vscode-editorWidget-background, #1b2130);
      --text: var(--vscode-foreground, #e7edf6);
      --muted: var(--vscode-descriptionForeground, #9aa6b8);
      --border: var(--vscode-panel-border, #2a3343);
      --target: #2dd4bf;
      --warn: #f59e0b;
      --fail: #f87171;
      font-family: var(--vscode-font-family, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif);
    }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); }
    main { max-width: 980px; margin: 0 auto; padding: 18px; display: grid; gap: 14px; }
    h1, h2, p { margin: 0; }
    h1 { font-size: 22px; }
    h2 { font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; }
    .hero, .section { border: 1px solid var(--border); border-radius: 8px; background: var(--panel); padding: 14px; }
    .hero { display: grid; gap: 12px; }
    .decision { display: inline-flex; width: max-content; border-radius: 999px; padding: 4px 10px; font-size: 12px; font-weight: 800; text-transform: uppercase; }
    .decision.pass { color: #06231f; background: var(--target); }
    .decision.warn { color: #211400; background: var(--warn); }
    .decision.fail { color: #2b0707; background: var(--fail); }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
    .metric { border: 1px solid var(--border); border-radius: 7px; background: var(--panel-2); padding: 10px; }
    .metric span { display: block; color: var(--muted); font-size: 11px; }
    .metric strong { display: block; margin-top: 4px; font-size: 18px; }
    .list { display: grid; gap: 8px; margin-top: 10px; }
    .item { border: 1px solid var(--border); border-radius: 7px; background: var(--panel-2); padding: 10px; }
    .item strong { display: block; margin-bottom: 4px; }
    .muted { color: var(--muted); font-size: 12px; line-height: 1.45; }
    code, pre { font-family: var(--vscode-editor-font-family, Consolas, monospace); }
    pre { white-space: pre-wrap; border: 1px solid var(--border); border-radius: 7px; background: var(--panel-2); padding: 12px; color: var(--text); }
    .actions { display: flex; gap: 8px; flex-wrap: wrap; }
    button { height: 30px; border: 1px solid var(--border); border-radius: 6px; background: var(--panel-2); color: var(--text); cursor: pointer; padding: 0 10px; font: inherit; font-size: 12px; font-weight: 650; }
    button:hover { border-color: var(--target); }
    @media (max-width: 760px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <section class="hero">
      <span id="decision" class="decision"></span>
      <h1>Patch Risk Gate</h1>
      <p class="muted">Changed symbols, impacted endpoints, suggested tests, trust, and unresolved risk.</p>
      <div class="actions">
        <button id="copySummary" type="button">Copy PR Summary</button>
        <button id="runTopTests" type="button">Run Top ${TEST_COMMAND_BATCH_LIMIT}</button>
      </div>
      <div class="grid" id="metrics"></div>
    </section>
    <section class="section">
      <h2>Changed Targets</h2>
      <div class="list" id="targets"></div>
    </section>
    <section class="section">
      <h2>Suggested Tests</h2>
      <div class="list" id="tests"></div>
    </section>
    <section class="section">
      <h2>Risk Reasons</h2>
      <div class="list" id="reasons"></div>
    </section>
    <section class="section">
      <h2>PR Summary</h2>
      <pre id="markdown"></pre>
    </section>
  </main>
  <script>
    const report = ${data};
    const vscodeApi = typeof acquireVsCodeApi === 'function' ? acquireVsCodeApi() : null;
${webviewMessageTypesJs}
    const decision = document.getElementById('decision');
    decision.textContent = report.decision;
    decision.className = 'decision ' + report.decision;
    document.getElementById('metrics').innerHTML = [
      ['Trust', report.trust.level + ' (' + report.trust.score + ')'],
      ['Endpoints', report.impactedEndpoints.length],
      ['Unresolved', report.unresolvedCalls]
    ].map(([label, value]) => '<div class="metric"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(value) + '</strong></div>').join('');
    document.getElementById('targets').innerHTML = report.changedTargets.length
      ? report.changedTargets.map(target => '<div class="item"><strong>' + escapeHtml(target) + '</strong></div>').join('')
      : '<div class="item muted">No changed Java targets found.</div>';
    document.getElementById('tests').innerHTML = report.topTests.length
      ? report.topTests.map(test => '<div class="item"><strong>' + escapeHtml(test.className) + '</strong><div class="muted">' + escapeHtml(test.why) + '</div><div><code>' + escapeHtml(test.command) + '</code></div></div>').join('')
      : '<div class="item muted">No suggested tests.</div>';
    document.getElementById('reasons').innerHTML = report.reasons.length
      ? report.reasons.map(reason => '<div class="item">' + escapeHtml(reason) + '</div>').join('')
      : '<div class="item muted">No risk reasons.</div>';
    document.getElementById('markdown').textContent = report.markdown;
    const topCommandLimit = ${TEST_COMMAND_BATCH_LIMIT};
    document.getElementById('copySummary').onclick = () => post({ type: WEBVIEW_MESSAGE_TYPES.copyText, text: report.markdown });
    document.getElementById('runTopTests').onclick = () => post({
      type: WEBVIEW_MESSAGE_TYPES.runTestCommands,
      commands: collectNormalizedCommands(report.topTests.map(test => test.command), topCommandLimit),
    });
${webviewNormalizedCommandsJs}
    function post(message) {
      if (sendWebviewMessage(message)) return;
      if (!vscodeApi && message.type === WEBVIEW_MESSAGE_TYPES.copyText && typeof message.text === 'string') {
        navigator.clipboard.writeText(message.text).catch(() => {});
      }
    }

    function sendWebviewMessage(message) {
      if (!vscodeApi || !message || typeof message !== 'object') return false;
      const type = message.type;
      if (type === WEBVIEW_MESSAGE_TYPES.copyText) {
        if (typeof message.text !== 'string') return false;
        vscodeApi.postMessage({ type: WEBVIEW_MESSAGE_TYPES.copyText, text: message.text });
        return true;
      }
      if (type === WEBVIEW_MESSAGE_TYPES.runTestCommands) {
        if (!Array.isArray(message.commands)) return false;
        const commands = Array.from(new Set(
          message.commands.filter(command => typeof command === 'string' && command.trim().length > 0).map(command => command.trim())
        ));
        if (!commands.length) return false;
        vscodeApi.postMessage({ type: WEBVIEW_MESSAGE_TYPES.runTestCommands, commands });
        return true;
      }
      return false;
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
