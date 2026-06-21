import { describe, expect, it, vi } from 'vitest';
import { TEST_COMMAND_BATCH_LIMIT } from '../src/testCommandRunner.js';

vi.mock('vscode', () => {
  const showInformationMessage = vi.fn();
  class EventEmitter<T> {
    event = vi.fn();
    fire = vi.fn<(event: T | undefined) => void>();
  }

  class TreeItem {
    label: string;
    collapsibleState?: number;
    description?: string;
    tooltip?: string;
    contextValue?: string;
    command?: unknown;
    iconPath?: unknown;

    constructor(label: string, collapsibleState?: number) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  }

  return {
    window: {
      showInformationMessage,
    },
    EventEmitter,
    TreeItem,
    TreeItemCollapsibleState: {
      Collapsed: 1,
      None: 0,
    },
    ThemeIcon: class ThemeIcon {
      constructor(_name: string) {}
    },
    _showInformationMessage: showInformationMessage,
  };
});

import { RiskWorkbenchProvider } from '../src/riskWorkbench.js';

describe('risk workbench', () => {
  it('deduplicates and trims top test commands before running them', () => {
    const runTestCommand = vi.fn();
    const provider = new RiskWorkbenchProvider({
      cache: {} as never,
      getWorkspaceRoot: () => '\\\\server\\share\\workspace',
      getAnalyzerOptions: () => ({
        maxFiles: 0,
        maxFileBytes: 300_000,
        maxDepth: 0,
        includeTests: true,
      }),
      openRiskReport: vi.fn(),
      runTestCommand,
      copyText: () => Promise.resolve(),
    });

    (provider as unknown as { snapshot: unknown }).snapshot = {
      status: 'ready',
      generatedAt: '2026-06-21T00:00:00.000Z',
      report: {
        decision: 'warn',
        changedTargets: ['AuthService.findUser'],
        impactedEndpoints: ['GET /users/{id}'],
        topTests: [
          {
            file: 'core\\module\\src\\test\\java\\example\\AuthServiceTest.java',
            className: 'example.AuthServiceTest',
            command: ' .\\mvnw.cmd -pl "core" -Dtest="AuthServiceTest" test ',
            count: 1,
            line: 7,
            score: 12,
            kinds: ['test'],
            why: 'Covers target with one evidence hit.',
            evidenceChain: ['Changed target: AuthService.findUser'],
          },
          {
            file: 'core/module/src/test/java/example/AuthServiceTest.java',
            className: 'example.AuthServiceTest',
            command: '.\\mvnw.cmd -pl "core" -Dtest="AuthServiceTest" test',
            count: 1,
            line: 7,
            score: 12,
            kinds: ['test'],
            why: 'Covers target with one evidence hit.',
            evidenceChain: ['Changed target: AuthService.findUser'],
          },
        ],
        trust: { level: 'medium', score: 73 },
        unresolvedCalls: 0,
        reasons: ['Medium trust report; validate risky paths before merging.'],
        markdown: 'Decision: WARN',
      },
    } as never;

    provider.runTopTests();

    expect(runTestCommand).toHaveBeenCalledTimes(1);
    expect(runTestCommand).toHaveBeenCalledWith('\\\\server\\share\\workspace', '.\\mvnw.cmd -pl "core" -Dtest="AuthServiceTest" test');
  });

  it('shows an information message when no runnable normalized test commands exist', async () => {
    const runTestCommand = vi.fn();
    const provider = new RiskWorkbenchProvider({
      cache: {} as never,
      getWorkspaceRoot: () => 'C:\\workspace',
      getAnalyzerOptions: () => ({
        maxFiles: 0,
        maxFileBytes: 300_000,
        maxDepth: 0,
        includeTests: true,
      }),
      openRiskReport: vi.fn(),
      runTestCommand,
      copyText: () => Promise.resolve(),
    });

    (provider as unknown as { snapshot: unknown }).snapshot = {
      status: 'ready',
      generatedAt: '2026-06-21T00:00:00.000Z',
      report: {
        decision: 'warn',
        changedTargets: ['AuthService.findUser'],
        impactedEndpoints: ['GET /users/{id}'],
        topTests: [
          {
            file: 'src/test/java/example/AuthServiceTest.java',
            className: 'example.AuthServiceTest',
            command: '   ',
            count: 1,
            line: 7,
            score: 12,
            kinds: ['test'],
            why: 'Covers target with one evidence hit.',
            evidenceChain: ['Changed target: AuthService.findUser'],
          },
          {
            file: 'src/test/java/example/AuthServiceTest.java',
            className: 'example.AuthServiceTest',
            command: 0 as never,
            count: 1,
            line: 7,
            score: 12,
            kinds: ['test'],
            why: 'Covers target with one evidence hit.',
            evidenceChain: ['Changed target: AuthService.findUser'],
          },
        ],
        trust: { level: 'medium', score: 73 },
        unresolvedCalls: 0,
        reasons: ['Medium trust report; validate risky paths before merging.'],
        markdown: 'Decision: WARN',
      },
    } as never;
    provider.runTopTests();
    const vscode = await import('vscode');

    expect(runTestCommand).not.toHaveBeenCalled();
    expect(vscode._showInformationMessage).toHaveBeenCalledWith('Java Impact Flow has no suggested tests to run yet.');
  });

  it('enforces the configured top-test limit when running suggested tests', () => {
    const runTestCommand = vi.fn();
    const commands = Array.from({ length: TEST_COMMAND_BATCH_LIMIT + 3 }, (_, index) => ({
      file: `src/test/java/example/AuthServiceTest${index}.java`,
      className: `example.AuthServiceTest${index}`,
      command: ` .\\mvnw.cmd -pl "core" -Dtest="AuthServiceTest${index}" test `,
      count: 1,
      line: 7,
      score: 12,
      kinds: ['test'],
      why: 'Covers target with evidence hit.',
      evidenceChain: ['Changed target: AuthService.findUser'],
    }));
    const provider = new RiskWorkbenchProvider({
      cache: {} as never,
      getWorkspaceRoot: () => 'C:\\workspace',
      getAnalyzerOptions: () => ({
        maxFiles: 0,
        maxFileBytes: 300_000,
        maxDepth: 0,
        includeTests: true,
      }),
      openRiskReport: vi.fn(),
      runTestCommand,
      copyText: () => Promise.resolve(),
    });

    (provider as unknown as { snapshot: unknown }).snapshot = {
      status: 'ready',
      generatedAt: '2026-06-21T00:00:00.000Z',
      report: {
        decision: 'warn',
        changedTargets: ['AuthService.findUser'],
        impactedEndpoints: ['GET /users/{id}'],
        topTests: commands,
        trust: { level: 'medium', score: 73 },
        unresolvedCalls: 0,
        reasons: ['Medium trust report; validate risky paths before merging.'],
        markdown: 'Decision: WARN',
      },
    } as never;

    provider.runTopTests();

    expect(runTestCommand).toHaveBeenCalledTimes(TEST_COMMAND_BATCH_LIMIT);
    for (let i = 0; i < TEST_COMMAND_BATCH_LIMIT; i += 1) {
      expect(runTestCommand).toHaveBeenNthCalledWith(
        i + 1,
        'C:\\workspace',
        `.\\mvnw.cmd -pl "core" -Dtest="AuthServiceTest${i}" test`,
      );
    }
  });
});
