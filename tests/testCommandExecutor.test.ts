import { describe, expect, it } from 'vitest';
import { prepareTestCommandForExecution } from '../src/testCommandExecutor.js';

describe('test command execution preparation', () => {
  it('trims whitespace and preserves quoted Gradle commands for terminal execution', () => {
    const result = prepareTestCommandForExecution('  .\\gradlew.bat test --tests "example.OrderServiceTest"   ');
    expect(result).toEqual({
      mode: 'terminal',
      command: '.\\gradlew.bat test --tests "example.OrderServiceTest"',
    });
  });

  it('flattens multiline commands and preserves informational fallback for class-only hints', () => {
    const result = prepareTestCommandForExecution('Run test class: example.OrderServiceTest\n');
    expect(result).toEqual({
      mode: 'information',
      command: 'Run test class: example.OrderServiceTest',
    });
  });

  it('ignores empty or whitespace-only commands', () => {
    expect(prepareTestCommandForExecution('   ')).toEqual({ mode: 'ignore', command: '' });
    expect(prepareTestCommandForExecution('\n\r\t')).toEqual({ mode: 'ignore', command: '' });
  });

  it('collapses newlines inside runnable commands while preserving quotes', () => {
    const result = prepareTestCommandForExecution('.\\mvnw.cmd -Dtest="OrderServiceTest"\n   -Dprofile=ci test');
    expect(result).toEqual({
      mode: 'terminal',
      command: '.\\mvnw.cmd -Dtest="OrderServiceTest"    -Dprofile=ci test',
    });
  });
});
