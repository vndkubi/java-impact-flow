import { normalizeTestCommands as normalizeRawTestCommands } from './testCommand.js';

export const TEST_COMMAND_BATCH_LIMIT = 3;

export type TestCommandRunner = (workspace: string, command: string) => void;

export function runNormalizedTestCommands(
  workspace: string,
  commands: readonly unknown[] | undefined,
  runTestCommand: TestCommandRunner,
  maxCommands?: number,
  onNoCommands?: () => void,
): number {
  const normalized = collectNormalizedTestCommands(commands, maxCommands);
  if (normalized.length === 0 && onNoCommands) {
    onNoCommands();
  }
  for (const command of normalized) {
    runTestCommand(workspace, command);
  }
  return normalized.length;
}

export function collectNormalizedTestCommands(
  commands: readonly unknown[] | undefined,
  maxCommands?: number,
): string[] {
  const normalized = normalizeRawTestCommands(commands ?? []);
  if (typeof maxCommands === 'number' && Number.isFinite(maxCommands)) {
    const limit = Math.trunc(maxCommands);
    if (limit <= 0) {
      return [];
    }
    return normalized.slice(0, limit);
  }
  return normalized;
}
