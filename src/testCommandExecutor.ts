export type TestCommandExecutionMode = 'terminal' | 'information' | 'ignore';

export interface TestCommandExecution {
  mode: TestCommandExecutionMode;
  command: string;
}

export function prepareTestCommandForExecution(command: string): TestCommandExecution {
  const normalized = command.trim().replace(/\r?\n/g, ' ');
  if (!normalized) {
    return { mode: 'ignore', command: '' };
  }
  if (normalized.startsWith('Run test class:')) {
    return { mode: 'information', command: normalized };
  }
  return { mode: 'terminal', command: normalized };
}
