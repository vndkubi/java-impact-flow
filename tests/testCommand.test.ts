import { describe, expect, it } from 'vitest';
import {
  buildTestCommandForFile,
  buildTestCommandsByFile,
  commandRunner,
  modulePathForTestFile,
  normalizeTestCommands,
  normalizeTestFilePath,
  testClassNameFromFile,
  isTestFile,
} from '../src/testCommand.js';
import type { ProjectBuildSystem } from '../src/impactGraph.js';
import type { ImpactGraph } from '../src/impactGraph.js';

describe('test command builder', () => {
  it('builds gradle commands for unix-like roots', () => {
    const buildSystem: ProjectBuildSystem = { tool: 'gradle', wrapper: 'gradlew' };

    expect(buildTestCommandForFile('src/test/java/example/AuthServiceTest.java', buildSystem, '/tmp/repo')).toBe(
      './gradlew test --tests "example.AuthServiceTest"',
    );

    expect(buildTestCommandForFile('moduleA/src/test/java/example/AuthServiceTest.java', buildSystem, '/tmp/repo')).toBe(
      './gradlew :moduleA:test --tests "example.AuthServiceTest"',
    );
  });

  it('builds gradle commands with wrapper scripts and windows roots', () => {
    const buildSystem: ProjectBuildSystem = { tool: 'gradle', wrapper: 'gradlew.bat' };

    expect(buildTestCommandForFile('src/test/java/example/AuthServiceTest.java', buildSystem, 'C:\\repo\\project')).toBe(
      '.\\gradlew.bat test --tests "example.AuthServiceTest"',
    );

    expect(buildTestCommandForFile('moduleA/src/test/java/example/AuthServiceTest.java', buildSystem, '/tmp/repo')).toBe(
      './gradlew :moduleA:test --tests "example.AuthServiceTest"',
    );
  });

  it('builds maven commands with module selectors and safe quoting', () => {
    const buildSystem: ProjectBuildSystem = { tool: 'maven', wrapper: 'mvnw' };

    expect(buildTestCommandForFile('moduleA/src/test/java/example/AuthServiceTest.java', buildSystem, '/tmp/repo')).toBe(
      './mvnw -pl "moduleA" -Dtest="AuthServiceTest" test',
    );

    expect(buildTestCommandForFile('core module/src/test/java/example/AuthServiceTest.java', buildSystem, '/tmp/repo')).toBe(
      './mvnw -pl "core module" -Dtest="AuthServiceTest" test',
    );

    expect(buildTestCommandForFile('core "edge" service/src/test/java/example/AuthServiceTest.java', buildSystem, '/tmp/repo')).toBe(
      './mvnw -pl "core \\"edge\\" service" -Dtest="AuthServiceTest" test',
    );
  });

  it('builds maven .cmd and .bat wrappers correctly', () => {
    const windowsBuildSystem: ProjectBuildSystem = { tool: 'maven', wrapper: 'mvnw' };
    const file = 'moduleA/src/test/java/example/AuthServiceTest.java';

    expect(buildTestCommandForFile(file, windowsBuildSystem, 'C:\\repo\\workspace')).toBe(
      '.\\mvnw.cmd -pl "moduleA" -Dtest="AuthServiceTest" test',
    );

    const cmdWrapper: ProjectBuildSystem = { tool: 'maven', wrapper: 'mvnw.cmd' };
    expect(buildTestCommandForFile(file, cmdWrapper, '/tmp/repo')).toBe(
      './mvnw -pl "moduleA" -Dtest="AuthServiceTest" test',
    );
    expect(buildTestCommandForFile(file, cmdWrapper, 'C:\\repo\\workspace')).toBe(
      '.\\mvnw.cmd -pl "moduleA" -Dtest="AuthServiceTest" test',
    );
  });

  it('supports explicit wrapper paths and preserves them as-is', () => {
    const file = 'moduleA/src/test/java/example/AuthServiceTest.java';
    const gradleBuildSystem: ProjectBuildSystem = { tool: 'gradle', wrapper: '/opt/tools/gradlew' };
    const mavenBuildSystem: ProjectBuildSystem = { tool: 'maven', wrapper: '/opt/tools/mvnw' };

    expect(buildTestCommandForFile(file, gradleBuildSystem, '/tmp/repo')).toBe(
      '/opt/tools/gradlew :moduleA:test --tests "example.AuthServiceTest"',
    );
    expect(buildTestCommandForFile(file, mavenBuildSystem, '/tmp/repo')).toBe(
      '/opt/tools/mvnw -pl "moduleA" -Dtest="AuthServiceTest" test',
    );
    expect(buildTestCommandForFile(file, { tool: 'maven', wrapper: 'C:\\Tools\\My Maven\\mvnw.cmd' }, 'C:\\repo')).toBe(
      '\"C:\\Tools\\My Maven\\mvnw.cmd\" -pl "moduleA" -Dtest="AuthServiceTest" test',
    );
  });

  it('escapes quoted test class names in both Gradle and Maven command forms', () => {
    const gradleBuildSystem: ProjectBuildSystem = { tool: 'gradle', wrapper: 'gradlew' };
    const mavenBuildSystem: ProjectBuildSystem = { tool: 'maven', wrapper: 'mvnw' };

    expect(buildTestCommandForFile('src/test/java/example/Auth"ServiceTest.java', gradleBuildSystem, '/tmp/repo')).toBe(
      './gradlew test --tests "example.Auth\\"ServiceTest"',
    );
    expect(buildTestCommandForFile('moduleA/src/test/java/example/Auth"ServiceTest.java', mavenBuildSystem, '/tmp/repo')).toBe(
      './mvnw -pl "moduleA" -Dtest="Auth\\"ServiceTest" test',
    );
  });

  it('builds commands for UNC-style roots', () => {
    const buildSystem: ProjectBuildSystem = { tool: 'maven', wrapper: 'mvnw' };

    expect(buildTestCommandForFile('moduleA/src/test/java/example/AuthServiceTest.java', buildSystem, '\\\\server\\\\share\\\\workspace')).toBe(
      '.\\mvnw.cmd -pl "moduleA" -Dtest="AuthServiceTest" test',
    );
  });

  it('resolves windows-root detection for UNC and mixed separators', () => {
    expect(commandRunner('mvnw', '\\\\server\\\\share\\\\workspace')).toBe('.\\mvnw.cmd');
    expect(commandRunner('mvnw', '//server/share/workspace')).toBe('.\\mvnw.cmd');
    expect(commandRunner('gradlew.bat', '//server/share/workspace')).toBe('.\\gradlew.bat');
    expect(commandRunner('MVNW.CMD', '//server/share/workspace')).toBe('.\\mvnw.cmd');
  });

  it('falls back to unknown command form when tool is unknown', () => {
    const buildSystem: ProjectBuildSystem = { tool: 'unknown', wrapper: 'custom-runner' };

    expect(buildTestCommandForFile('src/test/java/example/AuthServiceTest.java', buildSystem, '/tmp/repo')).toBe(
      'Run test class: example.AuthServiceTest',
    );
  });

  it('normalizes path variants for class and module extraction', () => {
    expect(testClassNameFromFile('src/test/java/example/ExampleTest.java')).toBe('example.ExampleTest');
    expect(testClassNameFromFile('module-a/src/test/example/ExampleTest.java')).toBe('example.ExampleTest');
    expect(testClassNameFromFile('core\\module\\src\\test\\java\\example\\AuthServiceTest.java')).toBe('example.AuthServiceTest');

    expect(modulePathForTestFile('module-a/src/test/java/example/AuthServiceTest.java')).toBe('module-a');
    expect(modulePathForTestFile('core\\module\\src\\test\\java\\example\\AuthServiceTest.java')).toBe('core/module');

    expect(isTestFile('src/test/java/example/AuthServiceTest.java')).toBe(true);
    expect(isTestFile('src/main/java/example/AuthService.java')).toBe(false);
  });

  it('builds deduplicated commands by file for webview payloads', () => {
    const graph = {
      metadata: {
        root: '/tmp/repo',
        buildSystem: { tool: 'maven', wrapper: 'mvnw' },
      },
      evidence: [
        { id: 'ignored-main', kind: 'definition', file: 'src/main/java/example/AuthService.java', line: 1, text: 'class AuthService {}', confidence: 0.9 },
        { id: 'first', kind: 'test', file: 'moduleA/src/test/java/example/AuthServiceTest.java', line: 2, text: 'void testAuth() {}', confidence: 0.9 },
        { id: 'duplicate', kind: 'test', file: 'moduleA/src/test/java/example/AuthServiceTest.java', line: 10, text: 'void testAuthAgain() {}', confidence: 0.8 },
        { id: 'second', kind: 'test', file: 'moduleB/src/test/java/example/AuthServiceIntegrationTest.java', line: 3, text: 'void testIntegration() {}', confidence: 0.7 },
      ],
    } as ImpactGraph;

    const commands = buildTestCommandsByFile(graph);
    expect(Object.keys(commands)).toHaveLength(2);
    expect(commands['moduleA/src/test/java/example/AuthServiceTest.java']).toBe(
      './mvnw -pl "moduleA" -Dtest="AuthServiceTest" test',
    );
    expect(commands['moduleB/src/test/java/example/AuthServiceIntegrationTest.java']).toBe(
      './mvnw -pl "moduleB" -Dtest="AuthServiceIntegrationTest" test',
    );
  });

  it('resolves wrapper command for unix and windows roots', () => {
    expect(commandRunner('gradlew')).toBe('./gradlew');
    expect(commandRunner('mvnw', 'C:\\workspace')).toBe('.\\mvnw.cmd');
    expect(commandRunner('gradlew.bat', 'C:\\workspace')).toBe('.\\gradlew.bat');
    expect(commandRunner('gradlew.bat', '/tmp/workspace')).toBe('./gradlew');
    expect(commandRunner('custom-runner')).toBe('custom-runner');
    expect(commandRunner('/var/tools/mvnw', 'C:\\workspace')).toBe('/var/tools/mvnw');
    expect(commandRunner('  "/home/dev/Tools/My Gradle Wrapper/gradlew.bat"  ', '/tmp/repo')).toBe('"/home/dev/Tools/My Gradle Wrapper/gradlew.bat"');
  });

  it('normalizes command lists by trimming, deduping, and filtering non-strings', () => {
    expect(normalizeTestCommands([
      ' ./mvnw test ',
      './mvnw test',
      '',
      '   ',
      123,
      null,
      undefined,
      './gradlew test',
    ])).toEqual([
      './mvnw test',
      './gradlew test',
    ]);
  });

  it('normalizes test file paths for stable map keys', () => {
    expect(normalizeTestFilePath('core\\module\\src\\test\\java\\example\\AuthServiceTest.java')).toBe(
      'core/module/src/test/java/example/AuthServiceTest.java',
    );
    const graph = {
      metadata: {
        root: '/tmp/repo',
        buildSystem: { tool: 'maven', wrapper: 'mvnw' },
      },
      evidence: [
        { id: 'first', kind: 'test', file: 'core\\module\\src\\test\\java\\example\\AuthServiceTest.java', line: 2, text: 'void testAuth() {}', confidence: 0.9 },
        { id: 'second', kind: 'test', file: 'core/module/src/test/java/example/AuthServiceTest.java', line: 4, text: 'void testAuthAgain() {}', confidence: 0.8 },
      ],
    } as ImpactGraph;

    const commands = buildTestCommandsByFile(graph);
    expect(Object.keys(commands)).toHaveLength(1);
    expect(commands['core/module/src/test/java/example/AuthServiceTest.java']).toBe(
      './mvnw -pl "core/module" -Dtest="AuthServiceTest" test',
    );
  });
});
