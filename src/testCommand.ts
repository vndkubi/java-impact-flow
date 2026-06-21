import type { ProjectBuildSystem } from './impactGraph.js';
import type { ImpactGraph } from './impactGraph.js';

export function buildTestCommandForFile(file: string, buildSystem: ProjectBuildSystem, root = ''): string {
  const className = testClassNameFromFile(file);
  const modulePath = modulePathForTestFile(file);
  const classArg = quoteCommandArg(className);
  if (buildSystem.tool === 'gradle') {
    const runner = commandRunner(buildSystem.wrapper || 'gradle', root);
    const task = modulePath ? `:${modulePath.split('/').join(':')}:test` : 'test';
    return `${runner} ${task} --tests ${classArg}`;
  }
  if (buildSystem.tool === 'maven') {
    const runner = commandRunner(buildSystem.wrapper || 'mvn', root);
    const moduleFlag = modulePath ? ` -pl ${quoteCommandArg(modulePath)}` : '';
    return `${runner}${moduleFlag} -Dtest=${quoteCommandArg(simpleClassName(className))} test`;
  }
  return `Run test class: ${className}`;
}

export function commandRunner(wrapper: string, root = ''): string {
  const windows = isWindowsRoot(root);
  const normalized = wrapper.trim();
  const normalizedWrapper = stripWrapperQuotes(normalized);
  if (isExplicitWrapperPath(normalizedWrapper)) {
    return needsQuoting(normalizedWrapper) ? quoteCommandArg(normalizedWrapper) : normalizedWrapper;
  }
  const lower = normalized.toLowerCase();
  if (lower === 'gradlew.bat' || lower === 'gradlew') {
    return windows ? '.\\gradlew.bat' : './gradlew';
  }
  if (lower === 'gradlew.cmd') {
    return windows ? '.\\gradlew.cmd' : './gradlew';
  }
  if (lower === 'mvnw.cmd' || lower === 'mvnw') {
    return windows ? '.\\mvnw.cmd' : './mvnw';
  }
  if (lower === 'mvnw.bat') {
    return windows ? '.\\mvnw.bat' : './mvnw';
  }
  return wrapper;
}

export function testClassNameFromFile(file: string): string {
  const normalized = file.replace(/\\/g, '/');
  const javaMarker = 'src/test/java/';
  const javaIndex = normalized.indexOf(javaMarker);
  if (javaIndex >= 0) return normalized.slice(javaIndex + javaMarker.length).replace(/\.java$/, '').split('/').join('.');
  const testIndex = normalized.indexOf('/test/');
  if (testIndex >= 0) return normalized.slice(testIndex + '/test/'.length).replace(/\.java$/, '').split('/').join('.');
  return simpleClassName(normalized.replace(/\.java$/, ''));
}

export function modulePathForTestFile(file: string): string {
  const normalized = file.replace(/\\/g, '/');
  const marker = '/src/test/';
  const index = normalized.indexOf(marker);
  return index > 0 ? normalized.slice(0, index) : '';
}

export function isTestFile(file: string): boolean {
  const normalized = file.replace(/\\/g, '/').toLowerCase();
  return normalized.includes('/src/test/') || normalized.includes('/test/') || /test\.java$/.test(normalized);
}

export function buildTestCommandsByFile(graph: ImpactGraph): Record<string, string> {
  const commands: Record<string, string> = {};
  const buildSystem = graph.metadata.buildSystem || { tool: 'unknown' };
  const root = graph.metadata.root || '';
  for (const item of graph.evidence || []) {
    if (!item.file || (!isTestFile(item.file) && item.kind !== 'test')) continue;
    const normalizedFile = normalizeTestFilePath(item.file);
    if (commands[normalizedFile]) continue;
    commands[normalizedFile] = buildTestCommandForFile(item.file, buildSystem, root);
  }
  return commands;
}

export function normalizeTestCommands(commands: readonly unknown[]): string[] {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const item of commands) {
    if (typeof item !== 'string') continue;
    const value = item.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

export function normalizeTestFilePath(file: string): string {
  return String(file || '').replace(/\\/g, '/');
}

function isWindowsRoot(root: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(root) || root.startsWith('\\\\') || root.startsWith('//');
}

function isExplicitWrapperPath(value: string): boolean {
  return value.includes('/') || value.includes('\\') || value.startsWith('.');
}

function needsQuoting(value: string): boolean {
  return /\s/.test(value);
}

function stripWrapperQuotes(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function simpleClassName(value: string): string {
  return value.replace(/\\/g, '/').split('/').pop()?.split('.').filter(Boolean).pop() || value;
}

function quoteCommandArg(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}
