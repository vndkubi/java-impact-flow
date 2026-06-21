import { describe, expect, it, vi } from 'vitest';
import { collectNormalizedTestCommands, runNormalizedTestCommands } from '../src/testCommandRunner.js';

describe('test command runner', () => {
  it('normalizes command batches by trimming, deduping, and dropping non-strings', () => {
    const normalized = collectNormalizedTestCommands([
      ' .\\mvnw.cmd -pl "core module" -Dtest="AuthServiceTest" test ',
      '.\\mvnw.cmd -pl "core module" -Dtest="AuthServiceTest" test',
      '',
      0,
      null,
      undefined,
      '.\\gradlew test --tests "AuthServiceTest"',
    ]);

    expect(normalized).toEqual([
      '.\\mvnw.cmd -pl "core module" -Dtest="AuthServiceTest" test',
      '.\\gradlew test --tests "AuthServiceTest"',
    ]);
  });

  it('limits command dispatch count while preserving normalization', () => {
    const runTestCommand = vi.fn();
    const count = runNormalizedTestCommands(
      '\\\\server\\share\\workspace',
      [
        ' .\\mvnw.cmd -pl "core" -Dtest="AuthServiceTest" test ',
        '.\\mvnw.cmd -pl "core" -Dtest="AuthServiceTest" test ',
        '.\\gradlew test --tests "AuthServiceTest"',
      ],
      runTestCommand,
      1,
    );

    expect(count).toBe(1);
    expect(runTestCommand).toHaveBeenCalledTimes(1);
    expect(runTestCommand).toHaveBeenCalledWith(
      '\\\\server\\share\\workspace',
      '.\\mvnw.cmd -pl "core" -Dtest="AuthServiceTest" test',
    );
  });

  it('skips dispatch when maxCommands is zero or negative', () => {
    const runTestCommand = vi.fn();

    expect(
      collectNormalizedTestCommands([
        'first',
        'second',
      ], 0),
    ).toEqual([]);
    expect(
      runNormalizedTestCommands('C:\\workspace', ['first', 'second'], runTestCommand, -3),
    ).toBe(0);
    expect(runTestCommand).not.toHaveBeenCalled();
  });

  it('invokes no-command callback when normalization removes all commands', () => {
    const runTestCommand = vi.fn();
    const onNoCommands = vi.fn();

    const count = runNormalizedTestCommands(
      'C:\\workspace',
      [0, null, '', '   ', undefined],
      runTestCommand,
      undefined,
      onNoCommands,
    );

    expect(count).toBe(0);
    expect(runTestCommand).not.toHaveBeenCalled();
    expect(onNoCommands).toHaveBeenCalledTimes(1);
  });

  it('does not invoke no-command callback when command dispatch occurs', () => {
    const runTestCommand = vi.fn();
    const onNoCommands = vi.fn();

    const count = runNormalizedTestCommands('C:\\workspace', ['first'], runTestCommand, undefined, onNoCommands);

    expect(count).toBe(1);
    expect(runTestCommand).toHaveBeenCalledTimes(1);
    expect(onNoCommands).not.toHaveBeenCalled();
  });

  it('treats non-finite maxCommands as unbounded', () => {
    expect(collectNormalizedTestCommands(['one', 'two'], NaN)).toEqual(['one', 'two']);
    expect(collectNormalizedTestCommands(['one', 'two'], Infinity)).toEqual(['one', 'two']);
  });

  it('uses integer truncation for fractional limits', () => {
    expect(collectNormalizedTestCommands(['one', 'two', 'three'], 2.8)).toEqual(['one', 'two']);
  });
});
