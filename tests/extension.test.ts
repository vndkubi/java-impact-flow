import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import path from 'node:path';
import { TEST_COMMAND_BATCH_LIMIT } from '../src/testCommandRunner.js';
import {
  activate,
  deactivate,
  handleRunSingleTestCommandMessage,
  handleRunTestCommandsMessage,
  handleWebviewMessage,
  handleUtilityWebviewMessage,
  __resetSharedTestTerminalForTests,
} from '../src/extension.js';

const terminal = {
  exitStatus: undefined,
  sendText: vi.fn(),
  show: vi.fn(),
  dispose: vi.fn(),
};
const diagnosticCollection = {
  clear: vi.fn(),
  set: vi.fn(),
  dispose: vi.fn(),
};

vi.mock('vscode', () => ({
  window: {
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    createTerminal: vi.fn(() => terminal),
    showTextDocument: vi.fn(),
    createTreeView: vi.fn(() => ({ dispose: vi.fn() })),
  },
  languages: {
    createDiagnosticCollection: vi.fn(() => diagnosticCollection),
    registerCodeLensProvider: vi.fn(),
    getConfiguration: vi.fn(() => ({
      get: vi.fn(),
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    })),
  },
  workspace: {
    getConfiguration: vi.fn(() => ({
      get: vi.fn(),
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    })),
    createFileSystemWatcher: vi.fn(() => ({ onDidCreate: vi.fn(), onDidChange: vi.fn(), onDidDelete: vi.fn() })),
    onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
    onDidSaveTextDocument: vi.fn(() => ({ dispose: vi.fn() })),
    openTextDocument: vi.fn(),
  },
  Uri: class Uri {
    static file(filePath: string) {
      return { fsPath: filePath };
    }
  },
  ProgressLocation: { Notification: 'notification' },
  DiagnosticSeverity: { Warning: 1 },
  Diagnostic: class Diagnostic {
    public source: string | undefined;
    constructor(public range: unknown, public message: string, public severity: unknown) {}
  },
  commands: {
    registerCommand: vi.fn(() => ({ dispose: vi.fn() })),
  },
  WindowState: class {},
  DiagnosticCollection: class {},
  TreeItem: class {
    constructor() {}
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1 },
  ThemeIcon: class {
    constructor() {}
  },
  Position: class Position {
    constructor(public line: number, public character: number) {}
  },
  Range: class {},
  Selection: class Selection {
    constructor(public start: unknown, public end: unknown) {}
  },
  TextEditorRevealType: { InCenter: 'inCenter' },
  CodeLens: class {},
  EventEmitter: class {
    event = vi.fn();
    fire = vi.fn();
  },
  env: { clipboard: { writeText: vi.fn() } },
  ViewColumn: { Beside: 1, One: 1 },
  CodeLensProvider: class {},
}));

describe('handleRunTestCommandsMessage', () => {
  const openTextDocument = vi.mocked(vscode.workspace.openTextDocument);
  const showTextDocument = vi.mocked(vscode.window.showTextDocument);
  const showWarningMessage = vi.mocked(vscode.window.showWarningMessage);
  const createDiagnosticCollection = vi.mocked(vscode.languages.createDiagnosticCollection);

  beforeEach(() => {
    vi.clearAllMocks();
    __resetSharedTestTerminalForTests();
    terminal.sendText.mockClear();
    terminal.show.mockClear();
    terminal.dispose.mockClear();
  });

  it('delegates normalized valid commands and omits callback', () => {
    const runTestCommand = vi.fn();
    const onNoCommands = vi.fn();

    const count = handleRunTestCommandsMessage('C:\\workspace', [
      ' .\\mvnw.cmd -pl "core" -Dtest="AuthServiceTest" test ',
      '.\\mvnw.cmd -pl "core" -Dtest="AuthServiceTest" test ',
      'Run test class: example.AuthServiceTest',
      0,
    ], runTestCommand, onNoCommands);

    expect(count).toBe(2);
    expect(runTestCommand).toHaveBeenCalledTimes(2);
    expect(runTestCommand).toHaveBeenCalledWith(
      'C:\\workspace',
      '.\\mvnw.cmd -pl "core" -Dtest="AuthServiceTest" test',
    );
    expect(onNoCommands).not.toHaveBeenCalled();
  });

  it('shows no-runnable-command callback when all commands are invalid', () => {
    const runTestCommand = vi.fn();
    const onNoCommands = vi.fn();

    const count = handleRunTestCommandsMessage('C:\\workspace', [0, null, undefined, '   ', ''], runTestCommand, onNoCommands);

    expect(count).toBe(0);
    expect(runTestCommand).not.toHaveBeenCalled();
    expect(onNoCommands).toHaveBeenCalledTimes(1);
  });

  it('does nothing for non-array command payload', () => {
    const runTestCommand = vi.fn();
    const onNoCommands = vi.fn();

    expect(
      handleRunTestCommandsMessage('C:\\workspace', { commands: ['.\\mvnw.cmd -Dtest=Demo test'] }, runTestCommand, onNoCommands),
    ).toBe(0);
    expect(runTestCommand).not.toHaveBeenCalled();
    expect(onNoCommands).not.toHaveBeenCalled();
  });

  it('calls onNoCommands for an explicit empty array', () => {
    const runTestCommand = vi.fn();
    const onNoCommands = vi.fn();

    const count = handleRunTestCommandsMessage('C:\\workspace', [], runTestCommand, onNoCommands);

    expect(count).toBe(0);
    expect(onNoCommands).toHaveBeenCalledTimes(1);
    expect(runTestCommand).not.toHaveBeenCalled();
  });

  it('handles single runTestCommand message through normalization and no-op on invalid command', () => {
    const runTestCommand = vi.fn();
    const onNoCommands = vi.fn();

    expect(handleRunSingleTestCommandMessage('C:\\workspace', '   ', runTestCommand, onNoCommands)).toBe(0);
    expect(onNoCommands).toHaveBeenCalledTimes(1);
    expect(runTestCommand).not.toHaveBeenCalled();

    const count = handleRunSingleTestCommandMessage(
      'C:\\workspace',
      ' .\\mvnw.cmd -pl "core" -Dtest="AuthServiceTest" test ',
      runTestCommand,
    );
    expect(count).toBe(1);
    expect(runTestCommand).toHaveBeenCalledWith(
      'C:\\workspace',
      '.\\mvnw.cmd -pl "core" -Dtest="AuthServiceTest" test',
    );
  });

  it('calls onNoCommands when runTestCommand payload is not a string', () => {
    const runTestCommand = vi.fn();
    const onNoCommands = vi.fn();

    expect(handleRunSingleTestCommandMessage('C:\\workspace', 123 as never, runTestCommand, onNoCommands)).toBe(0);
    expect(onNoCommands).toHaveBeenCalledTimes(1);
    expect(runTestCommand).not.toHaveBeenCalled();
  });

  it('defaults to TEST_COMMAND_BATCH_LIMIT when no limit is provided', () => {
    const runTestCommand = vi.fn();
    const onNoCommands = vi.fn();
    const commands = Array.from({ length: TEST_COMMAND_BATCH_LIMIT + 4 }, (_, index) => `command${index}`);
    const count = handleRunTestCommandsMessage('C:\\workspace', commands, runTestCommand, onNoCommands);

    expect(count).toBe(TEST_COMMAND_BATCH_LIMIT);
    expect(runTestCommand).toHaveBeenCalledTimes(TEST_COMMAND_BATCH_LIMIT);
    expect(onNoCommands).not.toHaveBeenCalled();
    expect(runTestCommand).toHaveBeenLastCalledWith('C:\\workspace', `command${TEST_COMMAND_BATCH_LIMIT - 1}`);
  });

  it('respects an explicit maxCommands override', () => {
    const runTestCommand = vi.fn();
    const onNoCommands = vi.fn();
    const commands = ['one', 'two', 'three', 'four'];

    const count = handleRunTestCommandsMessage('C:\\workspace', commands, runTestCommand, onNoCommands, 2);

    expect(count).toBe(2);
    expect(runTestCommand).toHaveBeenCalledTimes(2);
    expect(onNoCommands).not.toHaveBeenCalled();
    expect(runTestCommand).toHaveBeenCalledWith('C:\\workspace', 'one');
    expect(runTestCommand).toHaveBeenNthCalledWith(2, 'C:\\workspace', 'two');
  });

  it('calls onNoCommands for maxCommands <= 0 even when input has candidate commands', () => {
    const runTestCommand = vi.fn();
    const onNoCommands = vi.fn();

    const count = handleRunTestCommandsMessage('C:\\workspace', ['one', 'two'], runTestCommand, onNoCommands, 0);

    expect(count).toBe(0);
    expect(runTestCommand).not.toHaveBeenCalled();
    expect(onNoCommands).toHaveBeenCalledTimes(1);
  });

  it('dispatches runTestCommands message through webview handler using terminal and information branches', async () => {
    await handleWebviewMessage('C:\\workspace', {} as any, {
      type: 'runTestCommands',
      commands: [
        ' .\\mvnw.cmd -pl "core" -Dtest="AuthServiceTest" test ',
        'Run test class: example.AuthServiceTest',
        '   ',
      ],
    });

    expect(vscode.window.createTerminal).toHaveBeenCalledWith({
      name: 'Java Impact Flow Tests',
      cwd: 'C:\\workspace',
    });
    expect(terminal.sendText).toHaveBeenCalledTimes(1);
    expect(terminal.sendText).toHaveBeenCalledWith('.\\mvnw.cmd -pl "core" -Dtest="AuthServiceTest" test');
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Run test class: example.AuthServiceTest');
  });

  it('reuses the same test terminal for multiple run commands in the same workspace', async () => {
    const createTerminal = vi.mocked(vscode.window.createTerminal);

    await handleWebviewMessage('C:\\workspace', {} as any, {
      type: 'runTestCommands',
      commands: [
        '.\\mvnw.cmd -pl "core" -Dtest="AuthServiceTest" test',
        '.\\mvnw.cmd -pl "core" -Dtest="OrderServiceTest" test',
      ],
    });
    await handleWebviewMessage('C:\\workspace', {} as any, {
      type: 'runTestCommand',
      command: '.\\mvnw.cmd -pl "core" -Dtest="BillingServiceTest" test',
    });

    expect(createTerminal).toHaveBeenCalledTimes(1);
    expect(createTerminal).toHaveBeenCalledWith({
      name: 'Java Impact Flow Tests',
      cwd: 'C:\\workspace',
    });
    expect(terminal.sendText).toHaveBeenCalledTimes(3);
    expect(terminal.sendText).toHaveBeenNthCalledWith(1, '.\\mvnw.cmd -pl "core" -Dtest="AuthServiceTest" test');
    expect(terminal.sendText).toHaveBeenNthCalledWith(2, '.\\mvnw.cmd -pl "core" -Dtest="OrderServiceTest" test');
    expect(terminal.sendText).toHaveBeenNthCalledWith(3, '.\\mvnw.cmd -pl "core" -Dtest="BillingServiceTest" test');
  });

  it('creates a fresh test terminal when workspace changes between invocations', async () => {
    await handleWebviewMessage('C:\\workspace', {} as any, {
      type: 'runTestCommand',
      command: '.\\mvnw.cmd -pl "core" -Dtest="AuthServiceTest" test',
    });
    const createTerminal = vi.mocked(vscode.window.createTerminal);

    await handleWebviewMessage('D:\\other-workspace', {} as any, {
      type: 'runTestCommand',
      command: '.\\mvnw.cmd -pl "other" -Dtest="OrderServiceTest" test',
    });

    expect(createTerminal).toHaveBeenCalledTimes(2);
    expect(terminal.dispose).toHaveBeenCalledTimes(1);
    expect(createTerminal).toHaveBeenNthCalledWith(2, {
      name: 'Java Impact Flow Tests',
      cwd: 'D:\\other-workspace',
    });
  });

  it('recreates the test terminal when the shared terminal is already closed', async () => {
    const createTerminal = vi.mocked(vscode.window.createTerminal);

    await handleWebviewMessage('C:\\workspace', {} as any, {
      type: 'runTestCommand',
      command: '.\\mvnw.cmd -pl "core" -Dtest="AuthServiceTest" test',
    });
    terminal.exitStatus = { code: 0 };

    await handleWebviewMessage('C:\\workspace', {} as any, {
      type: 'runTestCommand',
      command: '.\\mvnw.cmd -pl "core" -Dtest="OrderServiceTest" test',
    });

    expect(createTerminal).toHaveBeenCalledTimes(2);
    expect(terminal.dispose).toHaveBeenCalledTimes(1);
    expect(terminal.sendText).toHaveBeenNthCalledWith(2, '.\\mvnw.cmd -pl "core" -Dtest="OrderServiceTest" test');
  });

  it('disposes impact diagnostic collection on deactivate', async () => {
    activate({ subscriptions: [] } as any);
    expect(diagnosticCollection.dispose).not.toHaveBeenCalled();

    deactivate();

    expect(diagnosticCollection.dispose).toHaveBeenCalledTimes(1);
  });

  it('sends no runnable command information message for empty single runTestCommand via webview handler', async () => {
    await handleWebviewMessage('C:\\workspace', {} as any, {
      type: 'runTestCommand',
      command: '   ',
    });

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Java Impact Flow has no runnable test command to execute.');
    expect(vscode.window.createTerminal).not.toHaveBeenCalled();
    expect(terminal.sendText).not.toHaveBeenCalled();
  });

  it('warns and refuses to execute runTestCommand when workspace is missing', async () => {
    await handleWebviewMessage('', {} as any, {
      type: 'runTestCommand',
      command: '.\\mvnw.cmd -pl "core" -Dtest="AuthServiceTest" test',
    });

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Java Impact Flow needs an open workspace folder to run test commands.',
    );
    expect(vscode.window.createTerminal).not.toHaveBeenCalled();
    expect(terminal.sendText).not.toHaveBeenCalled();
  });

  it('shows no runnable command information message for malformed runTestCommand payload', async () => {
    await handleWebviewMessage('C:\\workspace', {} as any, {
      type: 'runTestCommand',
      command: 123 as never,
    });

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Java Impact Flow has no runnable test command to execute.');
    expect(vscode.window.createTerminal).not.toHaveBeenCalled();
    expect(terminal.sendText).not.toHaveBeenCalled();
  });

  it('dispatches runTestCommands from risk utility webview with deduplication', async () => {
    await handleUtilityWebviewMessage('C:\\workspace', {
      type: 'runTestCommands',
      commands: [
        ' .\\mvnw.cmd -pl "core" -Dtest="AuthServiceTest" test ',
        '.\\mvnw.cmd -pl "core" -Dtest="AuthServiceTest" test ',
        '   ',
      ],
    } as any);

    expect(vscode.window.createTerminal).toHaveBeenCalledWith({
      name: 'Java Impact Flow Tests',
      cwd: 'C:\\workspace',
    });
    expect(terminal.sendText).toHaveBeenCalledTimes(1);
    expect(terminal.sendText).toHaveBeenCalledWith('.\\mvnw.cmd -pl "core" -Dtest="AuthServiceTest" test');
  });

  it('warns when webview runTestCommands payload is not an array', async () => {
    await handleWebviewMessage('C:\\workspace', {} as any, {
      type: 'runTestCommands',
      commands: 123 as never,
    });

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Java Impact Flow has no runnable test commands to execute.');
    expect(vscode.window.createTerminal).not.toHaveBeenCalled();
    expect(terminal.sendText).not.toHaveBeenCalled();
  });

  it('warns and refuses to execute runTestCommands when workspace is missing', async () => {
    await handleWebviewMessage('', {} as any, {
      type: 'runTestCommands',
      commands: ['.\\mvnw.cmd -pl "core" -Dtest="AuthServiceTest" test'],
    });

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Java Impact Flow needs an open workspace folder to run test commands.',
    );
    expect(vscode.window.createTerminal).not.toHaveBeenCalled();
    expect(terminal.sendText).not.toHaveBeenCalled();
  });

  it('warns when utility runTestCommands payload is not an array', async () => {
    await handleUtilityWebviewMessage('C:\\workspace', {
      type: 'runTestCommands',
      commands: 'not-an-array' as never,
    });

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Java Impact Flow has no runnable test commands to execute.');
    expect(vscode.window.createTerminal).not.toHaveBeenCalled();
    expect(terminal.sendText).not.toHaveBeenCalled();
  });

  it('warns and refuses to execute utility runTestCommands without workspace', async () => {
    await handleUtilityWebviewMessage('', {
      type: 'runTestCommands',
      commands: ['.\\mvnw.cmd -pl "core" -Dtest="AuthServiceTest" test'],
    });

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Java Impact Flow needs an open workspace folder to run test commands.',
    );
    expect(vscode.window.createTerminal).not.toHaveBeenCalled();
    expect(terminal.sendText).not.toHaveBeenCalled();
  });

  it('shows utility no-runnable-command message for empty risk utility runTestCommands payload', async () => {
    await handleUtilityWebviewMessage('C:\\workspace', {
      type: 'runTestCommands',
      commands: ['   ', 0, null],
    } as any);

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Java Impact Flow has no runnable test commands to execute.');
    expect(vscode.window.createTerminal).not.toHaveBeenCalled();
    expect(terminal.sendText).not.toHaveBeenCalled();
  });

  it('opens a valid in-workspace file from openLocation message', async () => {
    const document = { lineCount: 30 };
    const editor = { selection: null, revealRange: vi.fn() };
    openTextDocument.mockResolvedValue(document);
    showTextDocument.mockResolvedValue(editor);

    await handleWebviewMessage('C:\\workspace', {} as any, {
      type: 'openLocation',
      file: 'src\\main\\java\\example\\AuthService.java',
      line: 5,
    });

    expect(openTextDocument).toHaveBeenCalledWith({
      fsPath: path.join('C:\\workspace', 'src\\main\\java\\example\\AuthService.java'),
    });
    expect(showTextDocument).toHaveBeenCalledWith(document, vscode.ViewColumn.One, false);
    expect(showWarningMessage).not.toHaveBeenCalled();
    expect(editor.selection).not.toBeNull();
    expect(editor.revealRange).toHaveBeenCalled();
  });

  it('opens a valid absolute in-workspace path from openLocation message', async () => {
    const document = { lineCount: 9 };
    const editor = { selection: null, revealRange: vi.fn() };
    openTextDocument.mockResolvedValue(document);
    showTextDocument.mockResolvedValue(editor);

    await handleWebviewMessage('C:\\workspace', {} as any, {
      type: 'openLocation',
      file: 'C:\\workspace\\module\\src\\test\\java\\example\\AuthServiceTest.java',
      line: '12',
    });

    expect(openTextDocument).toHaveBeenCalledWith({
      fsPath: 'C:\\workspace\\module\\src\\test\\java\\example\\AuthServiceTest.java',
    });
    expect(showTextDocument).toHaveBeenCalledWith(document, vscode.ViewColumn.One, false);
    expect(showWarningMessage).not.toHaveBeenCalled();
  });

  it('rejects openLocation requests outside workspace', async () => {
    await handleWebviewMessage('C:\\workspace', {} as any, {
      type: 'openLocation',
      file: '..\\..\\outside\\bad\\path.java',
      line: 1,
    });

    expect(showWarningMessage).toHaveBeenCalledWith(
      'Ext Graph refused to open a path outside the workspace: ..\\..\\outside\\bad\\path.java',
    );
    expect(openTextDocument).not.toHaveBeenCalled();
    expect(showTextDocument).not.toHaveBeenCalled();
  });

  it('warns when trying to openLocation without a workspace', async () => {
    await handleWebviewMessage('', {} as any, {
      type: 'openLocation',
      file: 'src/main/java/example/AuthService.java',
      line: 1,
    });

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Ext Graph needs an open workspace folder to open files.',
    );
    expect(openTextDocument).not.toHaveBeenCalled();
    expect(showTextDocument).not.toHaveBeenCalled();
  });

  it('warns when openLocation cannot open the requested document', async () => {
    const error = new Error('file missing');
    openTextDocument.mockRejectedValue(error);

    await handleWebviewMessage('C:\\workspace', {} as any, {
      type: 'openLocation',
      file: 'src/main/java/example/NotFound.java',
      line: 1,
    });

    expect(showWarningMessage).toHaveBeenCalledWith(
      'Ext Graph could not open file src/main/java/example/NotFound.java: file missing',
    );
    expect(showTextDocument).not.toHaveBeenCalled();
  });

  it('clips openLocation to document bounds and tolerates non-number line input', async () => {
    const document = { lineCount: 4 };
    const selections: { line: number; character: number }[] = [];
    const editor = {
      set selection(range: { line: number; character: number }) {
        selections.push(range.start);
      },
      revealRange: vi.fn(),
    };
    openTextDocument.mockResolvedValue(document);
    showTextDocument.mockResolvedValue(editor);

    await handleWebviewMessage('C:\\workspace', {} as any, {
      type: 'openLocation',
      file: 'src/main/java/example/AuthService.java',
      line: 999,
    });
    await handleWebviewMessage('C:\\workspace', {} as any, {
      type: 'openLocation',
      file: 'src/main/java/example/AuthService.java',
      line: 'abc' as never,
    });

    expect(selections).toEqual([{ line: 3, character: 0 }, { line: 0, character: 0 }]);
    expect(editor.revealRange).toHaveBeenCalledTimes(2);
  });

  it('forwards copyText messages from webview handlers to clipboard', async () => {
    const writeText = vi.mocked(vscode.env.clipboard.writeText);
    await handleWebviewMessage('C:\\workspace', {} as any, { type: 'copyText', text: 'Copied' });
    await handleUtilityWebviewMessage('C:\\workspace', { type: 'copyText', text: 'From risk webview' });

    expect(writeText).toHaveBeenCalledWith('Copied');
    expect(writeText).toHaveBeenCalledWith('From risk webview');
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('publishes diagnostics from publishDiagnostics message in webview payload', async () => {
    activate({ subscriptions: [] } as any);
    const graph = {
      flows: [
        {
          steps: [
            {
              id: 'step-1',
              depth: 1,
              kind: 'call',
              label: 'service.load()',
              file: 'src/main/java/example/AuthService.java',
              line: 12,
              confidence: 0.55,
            },
          ],
        },
      ],
    };

    await handleWebviewMessage('C:\\workspace', graph as any, { type: 'publishDiagnostics' });

    expect(createDiagnosticCollection).toHaveBeenCalledWith('java-impact-flow');
    expect(diagnosticCollection.clear).toHaveBeenCalledTimes(1);
    expect(diagnosticCollection.set).toHaveBeenCalledWith(
      { fsPath: path.resolve('C:\\workspace', 'src/main/java/example/AuthService.java') },
      [
        expect.objectContaining({
          message: 'Java Impact Flow unresolved call: service.load() (55% confidence)',
          source: 'Java Impact Flow',
        }),
      ],
    );
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith('Java Impact Flow published 1 diagnostic(s).');
  });

  it('publishes no diagnostics message when impact graph has no unresolved low-confidence steps', async () => {
    activate({ subscriptions: [] } as any);
    const graph = {
      flows: [
        {
          steps: [
            {
              id: 'step-1',
              depth: 1,
              kind: 'call',
              label: 'service.load()',
              file: 'src/main/java/example/AuthService.java',
              line: 12,
              confidence: 0.99,
            },
          ],
        },
      ],
    };

    await handleWebviewMessage('C:\\workspace', graph as any, { type: 'publishDiagnostics' });

    expect(createDiagnosticCollection).toHaveBeenCalledWith('java-impact-flow');
    expect(diagnosticCollection.clear).toHaveBeenCalledTimes(1);
    expect(diagnosticCollection.set).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      'Java Impact Flow found no low-confidence unresolved flow steps to publish.',
    );
  });

  it('warns when publishing diagnostics without workspace context', async () => {
    activate({ subscriptions: [] } as any);
    const graph = {
      flows: [
        {
          steps: [
            {
              id: 'step-1',
              depth: 1,
              kind: 'call',
              label: 'service.load()',
              file: 'src/main/java/example/AuthService.java',
              line: 12,
              confidence: 0.55,
            },
          ],
        },
      ],
    };

    await handleWebviewMessage('', graph as any, { type: 'publishDiagnostics' });

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Java Impact Flow needs an open workspace folder to publish diagnostics.',
    );
    expect(diagnosticCollection.clear).not.toHaveBeenCalled();
    expect(diagnosticCollection.set).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('disposes shared test terminal when extension deactivates', async () => {
    await handleWebviewMessage('C:\\workspace', {} as any, {
      type: 'runTestCommand',
      command: '.\\mvnw.cmd -pl "core" -Dtest="AuthServiceTest" test',
    });

    deactivate();

    expect(terminal.dispose).toHaveBeenCalledTimes(1);
  });

  it('warns when publishing diagnostics with malformed graph payload', async () => {
    activate({ subscriptions: [] } as any);

    await handleWebviewMessage('C:\\workspace', null as any, { type: 'publishDiagnostics' });

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Java Impact Flow has no impact graph data to publish diagnostics.',
    );
    expect(diagnosticCollection.clear).toHaveBeenCalledTimes(1);
    expect(diagnosticCollection.set).not.toHaveBeenCalled();
    expect(vscode.window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('warns when receiving an unsupported impact webview message type', async () => {
    await handleWebviewMessage('C:\\workspace', {} as any, {
      type: 'unsupported',
    });

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Java Impact Flow ignored unsupported webview message. unsupported',
    );
    expect(terminal.sendText).not.toHaveBeenCalled();
  });

  it('warns when receiving an unsupported risk utility message type', async () => {
    await handleUtilityWebviewMessage('C:\\workspace', {
      type: 'unsupported',
    });

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Java Impact Flow ignored unsupported risk utility message. unsupported',
    );
  });

  it('warns on malformed impact webview messages with missing type', async () => {
    await handleWebviewMessage('C:\\workspace', {} as any, {
      data: 'some-payload',
    });

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Java Impact Flow ignored malformed webview message.',
    );
  });

  it('warns on non-object impact webview payloads', async () => {
    await handleWebviewMessage('C:\\workspace', {} as any, 123 as never);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Java Impact Flow ignored malformed webview message.',
    );
  });

  it('warns on malformed risk utility messages with missing type', async () => {
    await handleUtilityWebviewMessage('C:\\workspace', {
      data: 'some-payload',
    });

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Java Impact Flow ignored malformed risk utility message.',
    );
  });

  it('warns on non-object risk utility payloads', async () => {
    await handleUtilityWebviewMessage('C:\\workspace', [] as never);

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Java Impact Flow ignored malformed risk utility message.',
    );
  });

  it('warns when openLocation receives a non-string file path', async () => {
    await handleWebviewMessage('C:\\workspace', {} as any, {
      type: 'openLocation',
      file: 123 as never,
      line: 1,
    });

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Java Impact Flow received an invalid file path for openLocation.',
    );
  });

  it('warns when openLocation receives a blank file path', async () => {
    await handleWebviewMessage('C:\\workspace', {} as any, {
      type: 'openLocation',
      file: '   ',
      line: 1,
    });

    expect(vscode.window.showWarningMessage).toHaveBeenCalledWith(
      'Java Impact Flow received an invalid file path for openLocation.',
    );
  });
});
