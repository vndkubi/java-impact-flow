import fs from 'node:fs';
import path from 'node:path';

export type ImpactMode = 'references' | 'call' | 'api-flow' | 'patch-impact';

export interface BuildImpactGraphOptions {
  root: string;
  target: string;
  mode?: ImpactMode;
  maxFiles?: number;
  maxFileBytes?: number;
  maxNodes?: number;
  maxEdges?: number;
  maxDepth?: number;
  includeTests?: boolean;
}

export interface ImpactGraph {
  schemaVersion: 1;
  metadata: {
    root: string;
    target: string;
    mode: ImpactMode;
    generatedAt: string;
    analyzer: 'ext-graph-static-java';
    fileLimit: number;
    truncated: boolean;
    skippedLargeFiles: number;
    buildSystem: ProjectBuildSystem;
    trust: ImpactTrustScore;
  };
  summary: {
    javaFilesScanned: number;
    definitions: number;
    references: number;
    callSites: number;
    fieldReads: number;
    fieldWrites: number;
    endpoints: number;
    callbacks: number;
    frameworkAnnotations: number;
    flows: number;
    maxFlowDepth: number;
    tests: number;
    topFiles: Array<{ file: string; references: number; calls: number; tests: boolean }>;
  };
  nodes: GraphNode[];
  edges: GraphEdge[];
  flows: FlowTrace[];
  evidence: EvidenceItem[];
  warnings: string[];
}

export interface ProjectBuildSystem {
  tool: 'gradle' | 'maven' | 'unknown';
  wrapper?: string;
}

export interface ImpactTrustScore {
  level: 'high' | 'medium' | 'low';
  score: number;
  reasons: string[];
  resolvedCallRate: number;
  averageConfidence: number;
  unresolvedCalls: number;
  staticOnly: boolean;
}

export interface FlowTrace {
  id: string;
  label: string;
  endpoint?: {
    method: string;
    path: string;
    handler: string;
    file: string;
    line: number;
  };
  maxDepth: number;
  truncated: boolean;
  mermaid: string;
  diagnostics: FlowDiagnostics;
  steps: FlowStep[];
}

export interface FlowDiagnostics {
  resolvedCalls: number;
  unresolvedCalls: number;
  branchMarkers: number;
  loopMarkers: number;
  exceptionMarkers: number;
  returnMarkers: number;
  averageConfidence: number;
  staticOnly: boolean;
  notes: string[];
}

export interface FlowStep {
  id: string;
  depth: number;
  kind: 'endpoint' | 'handler' | 'call' | 'lambda' | 'method_reference' | 'annotation' | 'branch' | 'loop' | 'exception' | 'return' | 'throw';
  label: string;
  file: string;
  line: number;
  text?: string;
  target?: string;
  confidence: number;
}

export interface GraphNode {
  id: string;
  kind: 'target' | 'symbol' | 'file' | 'method' | 'endpoint' | 'callback' | 'annotation' | 'test';
  label: string;
  file?: string;
  line?: number;
  role?: string;
  meta?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  kind: 'definition' | 'reference' | 'call' | 'read' | 'write' | 'test_reference' | 'endpoint_handler' | 'callback' | 'annotation' | 'contains';
  from: string;
  to: string;
  label: string;
  file?: string;
  line?: number;
  confidence: number;
  meta?: Record<string, unknown>;
}

export interface EvidenceItem {
  id: string;
  kind: 'definition' | 'reference' | 'call' | 'field_read' | 'field_write' | 'endpoint' | 'lambda' | 'method_reference' | 'framework_annotation' | 'test';
  file: string;
  line: number;
  text: string;
  symbol?: string;
  enclosingSymbol?: string;
  confidence: number;
}

interface JavaFileFacts {
  file: string;
  absPath: string;
  isTest: boolean;
  packageName: string;
  imports: JavaImport[];
  lines: string[];
  classes: JavaSymbol[];
  methods: JavaSymbol[];
  fields: JavaSymbol[];
  endpoints: JavaEndpoint[];
  callbacks: JavaCallback[];
  annotations: JavaAnnotation[];
}

interface JavaImport {
  name: string;
  simpleName: string;
  wildcard: boolean;
}

interface JavaSymbol {
  kind: 'class' | 'interface' | 'enum' | 'record' | 'method' | 'field';
  name: string;
  fqName: string;
  owner?: string;
  file: string;
  line: number;
  signature?: string;
  role?: string;
  typeName?: string;
  parameters?: JavaParameter[];
}

interface JavaParameter {
  name: string;
  typeName: string;
}

interface JavaEndpoint {
  method: string;
  path: string;
  owner?: string;
  handler: string;
  file: string;
  line: number;
  basePath?: string;
  annotation: string;
}

interface JavaCallback {
  kind: 'lambda' | 'method_reference';
  file: string;
  line: number;
  text: string;
  target?: string;
  receiver?: string;
  enclosingSymbol?: string;
}

interface JavaAnnotation {
  name: string;
  file: string;
  line: number;
  text: string;
  framework: 'spring' | 'jakarta' | 'javaee' | 'junit' | 'unknown';
}

interface TargetParts {
  raw: string;
  simple: string;
  owner?: string;
  loweredRaw: string;
  loweredSimple: string;
  loweredOwner?: string;
}

interface ReferenceHit {
  kind: EvidenceItem['kind'];
  file: string;
  line: number;
  text: string;
  enclosing?: JavaSymbol;
  symbol?: JavaSymbol;
  confidence: number;
}

const FULL_PROJECT_FILE_LIMIT = 100_000;
const FULL_FLOW_DEPTH_LIMIT = 20;
const DEFAULT_MAX_FILES = FULL_PROJECT_FILE_LIMIT;
const DEFAULT_MAX_FILE_BYTES = 300_000;
const DEFAULT_MAX_NODES = 160;
const DEFAULT_MAX_EDGES = 320;
const DEFAULT_MAX_DEPTH = FULL_FLOW_DEPTH_LIMIT;

const IGNORED_DIRS = new Set([
  '.git',
  '.gradle',
  '.idea',
  '.idx',
  '.mvn',
  '.settings',
  '.vscode',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
]);

const CONTROL_KEYWORDS = new Set([
  'if',
  'for',
  'while',
  'switch',
  'catch',
  'return',
  'throw',
  'new',
  'super',
  'this',
  'try',
  'synchronized',
]);

const SPRING_ANNOTATIONS = new Set([
  'Autowired',
  'Bean',
  'Component',
  'Configuration',
  'Controller',
  'DeleteMapping',
  'EventListener',
  'GetMapping',
  'KafkaListener',
  'PostMapping',
  'PutMapping',
  'PatchMapping',
  'RabbitListener',
  'Repository',
  'RequestMapping',
  'RequestParam',
  'RestController',
  'Scheduled',
  'Service',
  'Transactional',
]);

const JAKARTA_ANNOTATIONS = new Set([
  'ApplicationScoped',
  'Consumes',
  'DELETE',
  'GET',
  'HEAD',
  'Inject',
  'Named',
  'OPTIONS',
  'POST',
  'PUT',
  'PATCH',
  'Path',
  'PathParam',
  'Produces',
  'RequestScoped',
  'SessionScoped',
  'Singleton',
]);

const JAVA_EE_ANNOTATIONS = new Set([
  'EJB',
  'Entity',
  'GeneratedValue',
  'Id',
  'Inject',
  'MessageDriven',
  'Named',
  'PersistenceContext',
  'PostConstruct',
  'PreDestroy',
  'Schedule',
  'Singleton',
  'Stateless',
  'TransactionAttribute',
]);

const JUNIT_ANNOTATIONS = new Set([
  'AfterEach',
  'BeforeEach',
  'Nested',
  'ParameterizedTest',
  'Test',
]);

interface ProjectScanCacheEntry {
  root: string;
  facts: JavaFileFacts[];
  skippedLargeFiles: number;
  truncated: boolean;
  buildSystem: ProjectBuildSystem;
}

const PROJECT_SCAN_CACHE = new Map<string, ProjectScanCacheEntry>();

export function clearImpactGraphAnalyzerCache(root?: string): void {
  if (!root) {
    PROJECT_SCAN_CACHE.clear();
    return;
  }
  const normalizedRoot = path.resolve(root);
  for (const [key, entry] of PROJECT_SCAN_CACHE) {
    if (entry.root === normalizedRoot) PROJECT_SCAN_CACHE.delete(key);
  }
}

export async function buildImpactGraph(options: BuildImpactGraphOptions): Promise<ImpactGraph> {
  const root = path.resolve(options.root);
  const target = normalizeTarget(options.target);
  const mode = options.mode ?? 'references';
  const maxFiles = clampLimit(options.maxFiles, DEFAULT_MAX_FILES, 1, FULL_PROJECT_FILE_LIMIT, FULL_PROJECT_FILE_LIMIT);
  const maxFileBytes = clampInt(options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES, 1000, 5_000_000);
  const maxNodes = clampInt(options.maxNodes ?? DEFAULT_MAX_NODES, 20, 2000);
  const maxEdges = clampInt(options.maxEdges ?? DEFAULT_MAX_EDGES, 20, 5000);
  const maxDepth = clampLimit(options.maxDepth, DEFAULT_MAX_DEPTH, 1, FULL_FLOW_DEPTH_LIMIT, FULL_FLOW_DEPTH_LIMIT);
  const includeTests = options.includeTests ?? true;
  const projectScan = getProjectScan(root, { maxFiles, maxFileBytes, includeTests });
  const facts = projectScan.facts;

  const allSymbols = facts.flatMap(file => [...file.classes, ...file.methods, ...file.fields]);
  const definitions = allSymbols.filter(symbol => symbolMatchesTarget(symbol, target));
  const references = findReferences(facts, definitions, target);
  const relatedEndpoints = findRelatedEndpoints(facts, target, definitions, references);
  const graph = assembleGraph({
    root,
    target,
    mode,
    facts,
    definitions,
    references,
    relatedEndpoints,
    maxNodes,
    maxEdges,
    maxDepth,
    maxFiles,
    skippedLargeFiles: projectScan.skippedLargeFiles,
    buildSystem: projectScan.buildSystem,
    truncated: projectScan.truncated,
  });
  return graph;
}

function getProjectScan(root: string, options: {
  maxFiles: number;
  maxFileBytes: number;
  includeTests: boolean;
}): ProjectScanCacheEntry {
  const cacheKey = projectScanCacheKey(root, options);
  const cached = PROJECT_SCAN_CACHE.get(cacheKey);
  if (cached) return cached;

  const discovered = listJavaFiles(root, { maxFiles: options.maxFiles, includeTests: options.includeTests });
  const facts: JavaFileFacts[] = [];
  let skippedLargeFiles = 0;

  for (const file of discovered.files) {
    const stat = fs.statSync(file.absPath);
    if (stat.size > options.maxFileBytes) {
      skippedLargeFiles++;
      continue;
    }
    facts.push(parseJavaFile(root, file.absPath));
  }

  const entry = {
    root,
    facts,
    skippedLargeFiles,
    truncated: discovered.truncated,
    buildSystem: detectBuildSystem(root),
  };
  PROJECT_SCAN_CACHE.set(cacheKey, entry);
  return entry;
}

function projectScanCacheKey(root: string, options: {
  maxFiles: number;
  maxFileBytes: number;
  includeTests: boolean;
}): string {
  return JSON.stringify({
    root,
    maxFiles: options.maxFiles,
    maxFileBytes: options.maxFileBytes,
    includeTests: options.includeTests,
  });
}

function listJavaFiles(root: string, options: { maxFiles: number; includeTests: boolean }): {
  files: Array<{ absPath: string; score: number }>;
  truncated: boolean;
} {
  const results: Array<{ absPath: string; score: number }> = [];
  const stack = [root];
  let truncated = false;

  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (shouldScanDirectory(entry.name)) stack.push(absPath);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.java')) continue;
      const rel = slash(path.relative(root, absPath));
      const isTest = isTestPath(rel);
      if (isTest && !options.includeTests) continue;
      results.push({ absPath, score: filePriorityScore(rel, isTest) });
    }
  }

  results.sort((a, b) => b.score - a.score || a.absPath.localeCompare(b.absPath));
  if (results.length > options.maxFiles) truncated = true;
  return {
    files: results.slice(0, options.maxFiles),
    truncated,
  };
}

function detectBuildSystem(root: string): ProjectBuildSystem {
  const has = (name: string) => fs.existsSync(path.join(root, name));
  if (has('gradlew.bat')) return { tool: 'gradle', wrapper: 'gradlew.bat' };
  if (has('gradlew')) return { tool: 'gradle', wrapper: 'gradlew' };
  if (has('settings.gradle') || has('settings.gradle.kts') || has('build.gradle') || has('build.gradle.kts')) {
    return { tool: 'gradle' };
  }
  if (has('mvnw.cmd')) return { tool: 'maven', wrapper: 'mvnw.cmd' };
  if (has('mvnw')) return { tool: 'maven', wrapper: 'mvnw' };
  if (has('pom.xml')) return { tool: 'maven' };
  return { tool: 'unknown' };
}

function parseJavaFile(root: string, absPath: string): JavaFileFacts {
  const file = slash(path.relative(root, absPath));
  const content = fs.readFileSync(absPath, 'utf-8');
  const lines = content.split(/\r?\n/);
  const packageName = parsePackageName(content);
  const imports = parseImports(content);
  const isTest = isTestPath(file);
  const classes: JavaSymbol[] = [];
  const methods: JavaSymbol[] = [];
  const fields: JavaSymbol[] = [];
  const endpoints: JavaEndpoint[] = [];
  const callbacks: JavaCallback[] = [];
  const annotations: JavaAnnotation[] = scanFrameworkAnnotations(file, lines);
  const pendingAnnotations: string[] = [];
  let currentOwner: string | undefined;
  let currentClassBasePath = '';

  for (let index = 0; index < lines.length; index++) {
    const lineNo = index + 1;
    const raw = lines[index] ?? '';
    const trimmed = raw.trim();
    if (trimmed.startsWith('@')) {
      pendingAnnotations.push(trimmed);
      continue;
    }

    const classMatch = raw.match(/\b(class|interface|enum|record)\s+([A-Za-z_$][\w$]*)\b/);
    if (classMatch) {
      const kind = classMatch[1] as JavaSymbol['kind'];
      const name = classMatch[2] ?? '';
      currentOwner = name;
      currentClassBasePath = requestMappingPathFromAnnotations(pendingAnnotations) ?? '';
      classes.push({
        kind,
        name,
        fqName: qualify(packageName, name),
        file,
        line: lineNo,
        signature: compactLine(raw),
        role: inferClassRole(file, name, pendingAnnotations),
      });
      pendingAnnotations.length = 0;
      continue;
    }

    if (trimmed.length > 0 && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
      const declaration = collectDeclaration(lines, index);
      const method = parseMethodLine(declaration, currentOwner, currentClassBasePath, packageName, file, lineNo, pendingAnnotations);
      if (method) {
        methods.push(method.symbol);
        if (method.endpoint) endpoints.push(method.endpoint);
        pendingAnnotations.length = 0;
        continue;
      }
    }

    const field = parseFieldLine(raw, currentOwner, packageName, file, lineNo);
    if (field) fields.push(field);

    if (trimmed.length > 0 && !trimmed.startsWith('//') && !trimmed.startsWith('*')) {
      pendingAnnotations.length = 0;
    }
  }

  const endpointPass = scanSpringEndpoints(packageName, file, lines);
  const methodKeys = new Set(methods.map(symbolKey));
  const endpointKeys = new Set(endpoints.map(endpointKey));
  for (const item of endpointPass) {
    if (!methodKeys.has(symbolKey(item.symbol))) {
      methods.push(item.symbol);
      methodKeys.add(symbolKey(item.symbol));
    }
    const key = endpointKey(item.endpoint);
    if (!endpointKeys.has(key)) {
      endpoints.push(item.endpoint);
      endpointKeys.add(key);
    }
  }
  const elasticsearchRoutePass = scanElasticsearchRoutes(packageName, file, lines, methods);
  for (const item of elasticsearchRoutePass) {
    const key = endpointKey(item.endpoint);
    if (!endpointKeys.has(key)) {
      endpoints.push(item.endpoint);
      endpointKeys.add(key);
    }
  }
  callbacks.push(...scanCallbacks(file, lines, methods));

  return { file, absPath, isTest, packageName, imports, lines, classes, methods, fields, endpoints, callbacks, annotations };
}

function scanSpringEndpoints(
  packageName: string,
  file: string,
  lines: string[],
): Array<{ symbol: JavaSymbol; endpoint: JavaEndpoint }> {
  const result: Array<{ symbol: JavaSymbol; endpoint: JavaEndpoint }> = [];
  let currentOwner: string | undefined;
  let currentBasePath = '';

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index] ?? '';
    const trimmed = raw.trim();
    const classMatch = raw.match(/\b(class|interface|enum|record)\s+([A-Za-z_$][\w$]*)\b/);
    if (classMatch) {
      currentOwner = classMatch[2] ?? undefined;
      currentBasePath = requestMappingPathFromAnnotations(annotationsBefore(lines, index)) ?? '';
      continue;
    }
    if (!currentOwner || !isEndpointMappingAnnotation(trimmed)) continue;
    const methodIndex = nextMethodDeclarationIndex(lines, index + 1);
    if (methodIndex === undefined) continue;
    const declaration = collectDeclaration(lines, methodIndex);
    const name = methodNameFromDeclaration(declaration, currentOwner);
    if (!name || CONTROL_KEYWORDS.has(name)) continue;
    const fqName = qualify(packageName, `${currentOwner}.${name}`);
    const methodAnnotations = annotationsBefore(lines, methodIndex);
    const endpoint = endpointFromAnnotations(methodAnnotations, currentBasePath, currentOwner, fqName, file, methodIndex + 1);
    if (!endpoint) continue;
    result.push({
      symbol: {
        kind: 'method',
        name,
        fqName,
        owner: currentOwner,
        file,
        line: methodIndex + 1,
        signature: compactLine(declaration),
        role: 'api-handler',
        parameters: parseParameters(declaration),
      },
      endpoint,
    });
  }

  return result;
}

function scanFrameworkAnnotations(file: string, lines: string[]): JavaAnnotation[] {
  const annotations: JavaAnnotation[] = [];
  for (let index = 0; index < lines.length; index++) {
    const text = compactLine(lines[index] ?? '');
    const matches = text.matchAll(/@([A-Za-z_$][\w$.]*)/g);
    for (const match of matches) {
      const name = annotationSimpleName(match[0] ?? '');
      const framework = annotationFramework(name);
      if (framework === 'unknown' && !isFrameworkRelevantAnnotation(name)) continue;
      annotations.push({
        name,
        file,
        line: index + 1,
        text,
        framework,
      });
    }
  }
  return annotations;
}

function scanElasticsearchRoutes(
  packageName: string,
  file: string,
  lines: string[],
  methods: JavaSymbol[],
): Array<{ endpoint: JavaEndpoint }> {
  const result: Array<{ endpoint: JavaEndpoint }> = [];
  const routeMethods = methods.filter(method => method.name === 'routes' && method.owner);
  for (const routeMethod of routeMethods) {
    const range = methodBodyRange(methods, routeMethod);
    const handler = methods.find(method => method.owner === routeMethod.owner && method.name === 'prepareRequest')
      ?? methods.find(method => method.owner === routeMethod.owner && method.name === 'handleRequest')
      ?? routeMethod;
    for (let lineNo = range.start; lineNo <= range.end; lineNo++) {
      const raw = lines[lineNo - 1] ?? '';
      const routes = elasticsearchRoutesFromLine(raw);
      for (const route of routes) {
        result.push({
          endpoint: {
            method: route.method,
            path: route.path,
            owner: routeMethod.owner,
            handler: handler.fqName,
            file,
            line: lineNo,
            annotation: `Route(${route.method}, "${route.path}")`,
          },
        });
      }
    }
  }
  return result;
}

function elasticsearchRoutesFromLine(raw: string): Array<{ method: string; path: string }> {
  const routes: Array<{ method: string; path: string }> = [];
  const pattern = /\bnew\s+Route\s*\(\s*(?:RestRequest\.Method\.)?([A-Z]+)\s*,\s*"([^"]+)"/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(raw))) {
    const method = match[1] ?? 'ANY';
    const path = normalizeEndpointPath(match[2] ?? '');
    routes.push({ method, path });
  }
  return routes;
}

function scanCallbacks(file: string, lines: string[], methods: JavaSymbol[]): JavaCallback[] {
  const callbacks: JavaCallback[] = [];
  const sortedMethods = methods.slice().sort((a, b) => a.line - b.line);
  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index] ?? '';
    if (!raw.includes('->') && !raw.includes('::')) continue;
    const line = index + 1;
    const text = compactLine(raw);
    const enclosing = enclosingMethod(sortedMethods, line);
    const methodRef = raw.match(/\b([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*|this|super)\s*::\s*([A-Za-z_$][\w$]*)\b/);
    if (methodRef) {
      callbacks.push({
        kind: 'method_reference',
        file,
        line,
        text,
        receiver: methodRef[1],
        target: methodRef[2],
        enclosingSymbol: enclosing?.fqName,
      });
      continue;
    }
    const lambdaCall = raw.match(/->\s*(?:\{[^}]*\b)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\(/);
    callbacks.push({
      kind: 'lambda',
      file,
      line,
      text,
      target: lambdaCall?.[1],
      enclosingSymbol: enclosing?.fqName,
    });
  }
  return callbacks;
}

function parseMethodLine(
  declaration: string,
  owner: string | undefined,
  classBasePath: string,
  packageName: string,
  file: string,
  line: number,
  annotations: string[],
): { symbol: JavaSymbol; endpoint?: JavaEndpoint } | undefined {
  const withoutComment = declaration.replace(/\/\/.*$/, '');
  if (!withoutComment.includes('(') || withoutComment.trim().endsWith(';')) return undefined;
  if (/^\s*[}\])]/.test(withoutComment)) return undefined;
  const name = methodNameFromDeclaration(withoutComment, owner);
  if (!name || CONTROL_KEYWORDS.has(name)) return undefined;
  if (/^\s*(if|for|while|switch|catch|return|throw|new)\b/.test(withoutComment)) return undefined;
  const fqName = qualify(packageName, owner ? `${owner}.${name}` : name);
  const endpoint = endpointFromAnnotations(annotations, classBasePath, owner, fqName, file, line);
  return {
    symbol: {
      kind: 'method',
      name,
      fqName,
      owner,
      file,
      line,
      signature: compactLine(declaration),
      role: endpoint ? 'api-handler' : undefined,
      parameters: parseParameters(declaration),
    },
    endpoint,
  };
}

function collectDeclaration(lines: string[], startIndex: number): string {
  const parts: string[] = [];
  for (let offset = 0; offset < 12 && startIndex + offset < lines.length; offset++) {
    const line = lines[startIndex + offset] ?? '';
    const trimmed = line.trim();
    if (offset > 0 && trimmed.startsWith('@')) {
      parts.push(line);
      continue;
    }
    parts.push(line);
    if (line.includes('{') || line.includes(';')) break;
  }
  return parts.join(' ');
}

function nextMethodDeclarationIndex(lines: string[], startIndex: number): number | undefined {
  for (let index = startIndex; index < Math.min(lines.length, startIndex + 40); index++) {
    const trimmed = (lines[index] ?? '').trim();
    if (!trimmed || trimmed.startsWith('@')) continue;
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    if (trimmed.includes('(')) return index;
  }
  return undefined;
}

function annotationsBefore(lines: string[], index: number): string[] {
  const annotations: string[] = [];
  for (let cursor = index - 1; cursor >= 0 && index - cursor <= 30; cursor--) {
    const trimmed = (lines[cursor] ?? '').trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;
    if (trimmed.startsWith('@')) {
      annotations.unshift(trimmed);
      continue;
    }
    if (annotations.length === 0) break;
    if (trimmed === '}' || trimmed.endsWith(';') || /\b(class|interface|enum|record)\b/.test(trimmed)) break;
  }
  return annotations;
}

function methodNameFromDeclaration(declaration: string, owner: string | undefined): string | undefined {
  const beforeFirstParen = declaration.slice(0, declaration.indexOf('('));
  const withoutAnnotations = beforeFirstParen
    .replace(/@[\w.]+(?:\([^)]*\))?/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!withoutAnnotations) return undefined;
  if (owner) {
    const constructorPattern = new RegExp(`^(?:public|protected|private)?\\s*${escapeRegExp(owner)}$`);
    if (constructorPattern.test(withoutAnnotations)) return owner;
  }
  const tokens = withoutAnnotations.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return undefined;
  const candidate = tokens.at(-1);
  return candidate && /^[A-Za-z_$][\w$]*$/.test(candidate) ? candidate : undefined;
}

function parseFieldLine(
  raw: string,
  owner: string | undefined,
  packageName: string,
  file: string,
  line: number,
): JavaSymbol | undefined {
  if (!owner || !raw.includes(';')) return undefined;
  const withoutComment = raw.replace(/\/\/.*$/, '').trim();
  if (withoutComment.startsWith('import ') || withoutComment.startsWith('package ')) return undefined;
  if (withoutComment.split('=')[0]?.includes('(')) return undefined;
  const match = withoutComment.match(/\b([A-Za-z_$][\w$]*)\s*(?:=.*)?;\s*$/);
  const name = match?.[1];
  if (!name || CONTROL_KEYWORDS.has(name)) return undefined;
  const typeName = parseFieldType(withoutComment, name);
  if (!typeName) return undefined;
  return {
    kind: 'field',
    name,
    owner,
    fqName: qualify(packageName, `${owner}.${name}`),
    file,
    line,
    signature: compactLine(raw),
    typeName,
  };
}

function parseFieldType(declaration: string, fieldName: string): string | undefined {
  const beforeName = declaration
    .replace(/=.*$/, '')
    .replace(/;\s*$/, '')
    .replace(/@[\w.]+(?:\([^)]*\))?/g, ' ')
    .trim();
  const match = beforeName.match(new RegExp(`(.+)\\s+${escapeRegExp(fieldName)}$`));
  if (!match) return undefined;
  return cleanTypeName(match[1] ?? '');
}

function parseParameters(declaration: string): JavaParameter[] {
  const open = declaration.indexOf('(');
  const close = declaration.lastIndexOf(')');
  if (open < 0 || close <= open) return [];
  const params = declaration.slice(open + 1, close).trim();
  if (!params) return [];
  return splitTopLevel(params, ',')
    .map(param => parseParameter(param))
    .filter((param): param is JavaParameter => param !== undefined);
}

function parseParameter(raw: string): JavaParameter | undefined {
  const cleaned = raw
    .replace(/@[\w.]+(?:\([^)]*\))?/g, ' ')
    .replace(/\bfinal\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const match = cleaned.match(/^(.+?)\s+([A-Za-z_$][\w$]*)$/);
  if (!match) return undefined;
  const typeName = cleanTypeName(match[1] ?? '');
  const name = match[2] ?? '';
  return typeName && name ? { name, typeName } : undefined;
}

function parseImports(content: string): JavaImport[] {
  const imports: JavaImport[] = [];
  const pattern = /^\s*import\s+(?:static\s+)?([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*(?:\.\*)?)\s*;/gm;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content))) {
    const name = match[1] ?? '';
    const wildcard = name.endsWith('.*');
    const simpleName = wildcard ? '*' : (name.split('.').at(-1) ?? name);
    imports.push({ name, simpleName, wildcard });
  }
  return imports;
}

function splitTopLevel(value: string, delimiter: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let angleDepth = 0;
  let parenDepth = 0;
  for (let index = 0; index < value.length; index++) {
    const char = value[index];
    if (char === '<') angleDepth++;
    else if (char === '>') angleDepth = Math.max(0, angleDepth - 1);
    else if (char === '(') parenDepth++;
    else if (char === ')') parenDepth = Math.max(0, parenDepth - 1);
    else if (char === delimiter && angleDepth === 0 && parenDepth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function cleanTypeName(value: string): string | undefined {
  const withoutModifiers = value
    .replace(/\b(public|protected|private|static|final|volatile|transient|synchronized|abstract)\b/g, ' ')
    .replace(/@[\w.]+(?:\([^)]*\))?/g, ' ')
    .replace(/\.\.\./g, '[]')
    .replace(/\s+/g, ' ')
    .trim();
  return withoutModifiers || undefined;
}

function endpointFromAnnotations(
  annotations: string[],
  classBasePath: string,
  owner: string | undefined,
  handler: string,
  file: string,
  line: number,
): JavaEndpoint | undefined {
  const endpointAnnotations = annotations.filter(isEndpointMappingAnnotation);
  for (const annotation of endpointAnnotations) {
    const parsed = parseEndpointAnnotation(annotation);
    if (!parsed) continue;
    const methodPath = parsed.path || pathAnnotationValue(annotations) || '';
    return {
      method: parsed.method,
      path: combinePaths(classBasePath, methodPath),
      owner,
      handler,
      file,
      line,
      basePath: classBasePath || undefined,
      annotation,
    };
  }
  return undefined;
}

function isEndpointMappingAnnotation(value: string): boolean {
  return /^@(?:[\w.]+\.)?(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping|GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/.test(value);
}

function endpointKey(endpoint: JavaEndpoint): string {
  return `${endpoint.method}\0${endpoint.path}\0${endpoint.handler}\0${endpoint.file}`;
}

function requestMappingPathFromAnnotations(annotations: string[]): string | undefined {
  const requestMapping = annotations.find(annotation => /@RequestMapping\b/.test(annotation));
  if (requestMapping) {
    const args = requestMapping.match(/@RequestMapping\b(?:\((.*)\))?/)?.[1] ?? '';
    return extractPath(args);
  }
  return pathAnnotationValue(annotations);
}

function combinePaths(basePath: string, methodPath: string): string {
  const base = normalizeEndpointPath(basePath);
  const method = normalizeEndpointPath(methodPath);
  if (!base && !method) return '/';
  if (!base) return method || '/';
  if (!method || method === '/') return base;
  return `${base.replace(/\/+$/, '')}/${method.replace(/^\/+/, '')}`;
}

function findReferences(facts: JavaFileFacts[], definitions: JavaSymbol[], target: TargetParts): ReferenceHit[] {
  const hits: ReferenceHit[] = [];
  const targetWord = wordRegex(target.simple);
  const definitionKeys = new Set(definitions.map(symbolKey));

  for (const fact of facts) {
    const methods = fact.methods.slice().sort((a, b) => a.line - b.line);
    for (let index = 0; index < fact.lines.length; index++) {
      const lineNo = index + 1;
      const raw = fact.lines[index] ?? '';
      const text = compactLine(raw);
      if (!targetWord.test(raw) && !raw.toLowerCase().includes(target.loweredRaw)) continue;
      const symbol = [...fact.classes, ...fact.methods, ...fact.fields].find(candidate => candidate.line === lineNo && symbolMatchesTarget(candidate, target));
      if (symbol && definitionKeys.has(symbolKey(symbol))) {
        hits.push({ kind: 'definition', file: fact.file, line: lineNo, text, symbol, confidence: 0.92 });
        continue;
      }

      const enclosing = enclosingMethod(methods, lineNo);
      const callback = fact.callbacks.find(item => item.line === lineNo);
      const callLike = new RegExp(`\\b${escapeRegExp(target.simple)}\\s*\\(`).test(raw);
      const assignmentLike = new RegExp(`\\b${escapeRegExp(target.simple)}\\b\\s*(?:=|\\+=|-=|\\*=|/=|\\+\\+|--)`).test(raw);
      const kind = callback && callback.kind === 'method_reference'
        ? 'method_reference'
        : callback
          ? 'lambda'
          : callLike
        ? 'call'
        : assignmentLike
          ? 'field_write'
          : looksLikeFieldRead(raw, target.simple)
            ? 'field_read'
            : fact.isTest
              ? 'test'
              : 'reference';
      hits.push({
        kind,
        file: fact.file,
        line: lineNo,
        text,
        enclosing,
        confidence: confidenceForReference(raw, target, kind),
      });
    }
  }

  return hits.sort((a, b) => b.confidence - a.confidence || a.file.localeCompare(b.file) || a.line - b.line);
}

function findRelatedEndpoints(
  facts: JavaFileFacts[],
  target: TargetParts,
  definitions: JavaSymbol[],
  references: ReferenceHit[],
): JavaEndpoint[] {
  const relatedFiles = new Set([
    ...definitions.map(item => item.file),
    ...references.slice(0, 200).map(item => item.file),
  ]);
  return facts
    .flatMap(fact => fact.endpoints)
    .filter(endpoint =>
      relatedFiles.has(endpoint.file)
      || endpoint.owner?.toLowerCase() === target.loweredSimple
      || (target.owner !== undefined && endpoint.owner?.toLowerCase() === target.loweredOwner)
      || endpoint.handler.toLowerCase().includes(target.loweredSimple)
      || endpoint.path.toLowerCase().includes(target.loweredSimple))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)
    .slice(0, 40);
}

function assembleGraph(input: {
  root: string;
  target: TargetParts;
  mode: ImpactMode;
  facts: JavaFileFacts[];
  definitions: JavaSymbol[];
  references: ReferenceHit[];
  relatedEndpoints: JavaEndpoint[];
  maxNodes: number;
  maxEdges: number;
  maxDepth: number;
  maxFiles: number;
  skippedLargeFiles: number;
  buildSystem: ProjectBuildSystem;
  truncated: boolean;
}): ImpactGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, GraphEdge>();
  const evidence: EvidenceItem[] = [];
  const targetId = 'target:requested';
  const symbolsByFqName = new Map(input.facts
    .flatMap(fact => [...fact.classes, ...fact.methods, ...fact.fields])
    .map(symbol => [symbol.fqName, symbol]));
  const relatedCallbacks = findRelatedCallbacks(input.facts, input.target, input.definitions, input.references, input.relatedEndpoints);
  const relatedAnnotations = findRelatedAnnotations(input.facts, input.definitions, input.references, input.relatedEndpoints);
  const flows = buildFlowTraces(input.facts, input.relatedEndpoints, input.maxDepth);

  const addNode = (node: GraphNode): void => {
    if (nodes.size >= input.maxNodes && !nodes.has(node.id)) return;
    nodes.set(node.id, node);
  };
  const addEdge = (edge: GraphEdge): void => {
    if (edges.size >= input.maxEdges && !edges.has(edge.id)) return;
    if (nodes.has(edge.from) && nodes.has(edge.to)) edges.set(edge.id, edge);
  };
  const addEvidence = (item: Omit<EvidenceItem, 'id'>): EvidenceItem => {
    const record = { ...item, id: `ev:${evidence.length + 1}` };
    evidence.push(record);
    return record;
  };

  addNode({
    id: targetId,
    kind: 'target',
    label: input.target.raw,
    role: input.mode,
    meta: { simple: input.target.simple, owner: input.target.owner },
  });

  for (const symbol of input.definitions.slice(0, 80)) {
    const symbolId = symbolNodeId(symbol);
    const fileId = fileNodeId(symbol.file);
    addNode(symbolNode(symbol));
    addNode(fileNode(symbol.file, isTestPath(symbol.file)));
    addEdge({
      id: `definition:${symbolId}`,
      kind: 'definition',
      from: targetId,
      to: symbolId,
      label: 'definition',
      file: symbol.file,
      line: symbol.line,
      confidence: 0.92,
    });
    addEdge({
      id: `contains:${fileId}:${symbolId}`,
      kind: 'contains',
      from: fileId,
      to: symbolId,
      label: 'contains',
      file: symbol.file,
      line: symbol.line,
      confidence: 0.85,
    });
    addEvidence({
      kind: 'definition',
      file: symbol.file,
      line: symbol.line,
      text: symbol.signature ?? symbol.name,
      symbol: symbol.fqName,
      confidence: 0.92,
    });
  }

  for (const hit of input.references.slice(0, 180)) {
    const fileId = fileNodeId(hit.file);
    const targetLikeId = hit.symbol ? symbolNodeId(hit.symbol) : targetId;
    addNode(fileNode(hit.file, isTestPath(hit.file)));
    if (hit.enclosing) addNode(methodNode(hit.enclosing));
    if (hit.symbol) addNode(symbolNode(hit.symbol));

    const item = addEvidence({
      kind: hit.kind,
      file: hit.file,
      line: hit.line,
      text: hit.text,
      symbol: hit.symbol?.fqName ?? input.target.raw,
      enclosingSymbol: hit.enclosing?.fqName,
      confidence: hit.confidence,
    });
    const from = hit.enclosing ? methodNodeId(hit.enclosing) : fileId;
    const edgeKind = hit.kind === 'call'
      ? 'call'
      : hit.kind === 'field_read'
        ? 'read'
        : hit.kind === 'field_write'
          ? 'write'
          : hit.kind === 'test'
            ? 'test_reference'
            : 'reference';
    addEdge({
      id: `${edgeKind}:${item.id}`,
      kind: edgeKind,
      from,
      to: targetLikeId,
      label: edgeKind.replace('_', ' '),
      file: hit.file,
      line: hit.line,
      confidence: hit.confidence,
      meta: { evidenceId: item.id },
    });
    if (hit.enclosing) {
      addEdge({
        id: `method-file:${methodNodeId(hit.enclosing)}:${fileId}`,
        kind: 'contains',
        from: fileId,
        to: methodNodeId(hit.enclosing),
        label: 'contains',
        file: hit.file,
        line: hit.enclosing.line,
        confidence: 0.8,
      });
    }
  }

  for (const endpoint of input.relatedEndpoints) {
    const endpointId = endpointNodeId(endpoint);
    const fileId = fileNodeId(endpoint.file);
    const handlerSymbol = symbolsByFqName.get(endpoint.handler);
    const handlerId = handlerSymbol ? methodNodeId(handlerSymbol) : fileId;
    addNode({
      id: endpointId,
      kind: 'endpoint',
      label: `${endpoint.method} ${endpoint.path}`,
      file: endpoint.file,
      line: endpoint.line,
      role: endpoint.annotation,
      meta: { handler: endpoint.handler, owner: endpoint.owner, basePath: endpoint.basePath },
    });
    addNode(fileNode(endpoint.file, isTestPath(endpoint.file)));
    if (handlerSymbol) {
      addNode(methodNode(handlerSymbol));
      addEdge({
        id: `endpoint-method-file:${methodNodeId(handlerSymbol)}:${fileId}`,
        kind: 'contains',
        from: fileId,
        to: methodNodeId(handlerSymbol),
        label: 'contains',
        file: endpoint.file,
        line: handlerSymbol.line,
        confidence: 0.84,
      });
    }
    addEdge({
      id: `endpoint-handler:${endpointId}`,
      kind: 'endpoint_handler',
      from: endpointId,
      to: handlerId,
      label: handlerSymbol ? 'handler' : 'handler file',
      file: endpoint.file,
      line: endpoint.line,
      confidence: 0.72,
    });
    addEvidence({
      kind: 'endpoint',
      file: endpoint.file,
      line: endpoint.line,
      text: `${endpoint.annotation} -> ${endpoint.handler}`,
      symbol: endpoint.handler,
      confidence: 0.72,
    });
  }

  for (const callback of relatedCallbacks.slice(0, 80)) {
    const callbackId = callbackNodeId(callback);
    const fileId = fileNodeId(callback.file);
    const enclosing = callback.enclosingSymbol ? symbolsByFqName.get(callback.enclosingSymbol) : undefined;
    const targetSymbol = resolveCallbackTargetSymbol(symbolsByFqName, callback);
    addNode({
      id: callbackId,
      kind: 'callback',
      label: callback.kind === 'method_reference'
        ? `${callback.receiver ?? 'ref'}::${callback.target ?? 'unknown'}`
        : callback.target ? `lambda -> ${callback.target}` : 'lambda',
      file: callback.file,
      line: callback.line,
      role: callback.kind,
      meta: { target: callback.target, receiver: callback.receiver, enclosingSymbol: callback.enclosingSymbol },
    });
    addNode(fileNode(callback.file, isTestPath(callback.file)));
    if (enclosing) addNode(methodNode(enclosing));
    if (targetSymbol) addNode(methodNode(targetSymbol));
    addEdge({
      id: `callback-source:${callbackId}`,
      kind: 'callback',
      from: enclosing ? methodNodeId(enclosing) : fileId,
      to: callbackId,
      label: callback.kind === 'method_reference' ? 'method ref' : 'lambda',
      file: callback.file,
      line: callback.line,
      confidence: callback.kind === 'method_reference' ? 0.78 : 0.7,
    });
    addEdge({
      id: `callback-target:${callbackId}`,
      kind: 'callback',
      from: callbackId,
      to: targetSymbol ? methodNodeId(targetSymbol) : targetId,
      label: callback.target ? `callback ${callback.target}` : 'callback',
      file: callback.file,
      line: callback.line,
      confidence: targetSymbol ? 0.78 : 0.56,
    });
    addEvidence({
      kind: callback.kind,
      file: callback.file,
      line: callback.line,
      text: callback.text,
      symbol: callback.target,
      enclosingSymbol: callback.enclosingSymbol,
      confidence: callback.kind === 'method_reference' ? 0.78 : 0.7,
    });
  }

  for (const annotation of relatedAnnotations.slice(0, 120)) {
    const annotationId = annotationNodeId(annotation);
    const fileId = fileNodeId(annotation.file);
    addNode({
      id: annotationId,
      kind: 'annotation',
      label: `@${annotation.name}`,
      file: annotation.file,
      line: annotation.line,
      role: annotation.framework,
      meta: { text: annotation.text },
    });
    addNode(fileNode(annotation.file, isTestPath(annotation.file)));
    addEdge({
      id: `annotation:${annotationId}`,
      kind: 'annotation',
      from: annotationId,
      to: fileId,
      label: annotation.framework,
      file: annotation.file,
      line: annotation.line,
      confidence: annotation.framework === 'unknown' ? 0.45 : 0.75,
    });
    addEvidence({
      kind: 'framework_annotation',
      file: annotation.file,
      line: annotation.line,
      text: annotation.text,
      symbol: annotation.name,
      confidence: annotation.framework === 'unknown' ? 0.45 : 0.75,
    });
  }

  const topFiles = summarizeTopFiles(input.references);
  const tests = input.references.filter(hit => hit.kind === 'test' || isTestPath(hit.file));
  const fieldReads = input.references.filter(hit => hit.kind === 'field_read');
  const fieldWrites = input.references.filter(hit => hit.kind === 'field_write');
  const calls = input.references.filter(hit => hit.kind === 'call');
  const truncated = input.truncated || input.references.length > 180 || nodes.size >= input.maxNodes || edges.size >= input.maxEdges;
  const warnings = buildWarnings({ ...input, truncated }, nodes.size, edges.size);
  const trust = buildTrustScore({
    definitions: input.definitions.length,
    references: input.references.length,
    evidence,
    flows,
    skippedLargeFiles: input.skippedLargeFiles,
    truncated,
    nodeCount: nodes.size,
    edgeCount: edges.size,
  });

  return {
    schemaVersion: 1,
    metadata: {
      root: input.root,
      target: input.target.raw,
      mode: input.mode,
      generatedAt: new Date().toISOString(),
      analyzer: 'ext-graph-static-java',
      fileLimit: input.maxFiles,
      truncated,
      skippedLargeFiles: input.skippedLargeFiles,
      buildSystem: input.buildSystem,
      trust,
    },
    summary: {
      javaFilesScanned: input.facts.length,
      definitions: input.definitions.length,
      references: input.references.filter(hit => hit.kind !== 'definition').length,
      callSites: calls.length,
      fieldReads: fieldReads.length,
      fieldWrites: fieldWrites.length,
      endpoints: input.relatedEndpoints.length,
      callbacks: relatedCallbacks.length,
      frameworkAnnotations: relatedAnnotations.length,
      flows: flows.length,
      maxFlowDepth: flows.reduce((max, flow) => Math.max(max, ...flow.steps.map(step => step.depth)), 0),
      tests: tests.length,
      topFiles,
    },
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    flows,
    evidence,
    warnings,
  };
}

function buildTrustScore(input: {
  definitions: number;
  references: number;
  evidence: EvidenceItem[];
  flows: FlowTrace[];
  skippedLargeFiles: number;
  truncated: boolean;
  nodeCount: number;
  edgeCount: number;
}): ImpactTrustScore {
  const diagnostics = input.flows.map(flow => flow.diagnostics);
  const resolvedCalls = diagnostics.reduce((sum, item) => sum + item.resolvedCalls, 0);
  const unresolvedCalls = diagnostics.reduce((sum, item) => sum + item.unresolvedCalls, 0);
  const executableCalls = resolvedCalls + unresolvedCalls;
  const resolvedCallRate = executableCalls > 0 ? resolvedCalls / executableCalls : 1;
  const flowConfidences = input.flows.flatMap(flow => flow.steps.map(step => step.confidence));
  const confidences = [...input.evidence.map(item => item.confidence), ...flowConfidences];
  const averageConfidence = confidences.length
    ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
    : 0;
  const reasons: string[] = ['Static regex analyzer; validate important paths against source or tests.'];
  let score = 88;

  if (input.definitions === 0) {
    score -= 18;
    reasons.push('No exact definition matched the requested target.');
  }
  if (input.references === 0) {
    score -= 18;
    reasons.push('No references matched the target in scanned Java files.');
  }
  if (input.truncated) {
    score -= 18;
    reasons.push('Result was truncated by file, node, edge, or evidence caps.');
  }
  if (input.skippedLargeFiles > 0) {
    score -= Math.min(15, 5 + input.skippedLargeFiles * 2);
    reasons.push(`${input.skippedLargeFiles} large Java file(s) were skipped.`);
  }
  if (executableCalls > 0 && unresolvedCalls > 0) {
    score -= Math.min(30, Math.round((unresolvedCalls / executableCalls) * 30));
    reasons.push(`${unresolvedCalls} of ${executableCalls} flow call/callback step(s) were unresolved.`);
  }
  if (averageConfidence > 0 && averageConfidence < 0.65) {
    score -= 12;
    reasons.push('Average evidence confidence is below 65%.');
  }
  if (input.nodeCount === 0 || input.edgeCount === 0) {
    score -= 12;
    reasons.push('Graph is sparse; use a more specific Java class, method, or field.');
  }

  const bounded = clampInt(score, 0, 100);
  return {
    level: bounded >= 75 ? 'high' : bounded >= 50 ? 'medium' : 'low',
    score: bounded,
    reasons,
    resolvedCallRate: Number(resolvedCallRate.toFixed(2)),
    averageConfidence: Number(averageConfidence.toFixed(2)),
    unresolvedCalls,
    staticOnly: true,
  };
}

function summarizeTopFiles(references: ReferenceHit[]): Array<{ file: string; references: number; calls: number; tests: boolean }> {
  const byFile = new Map<string, { file: string; references: number; calls: number; tests: boolean }>();
  for (const hit of references) {
    const row = byFile.get(hit.file) ?? { file: hit.file, references: 0, calls: 0, tests: isTestPath(hit.file) };
    row.references++;
    if (hit.kind === 'call') row.calls++;
    byFile.set(hit.file, row);
  }
  return [...byFile.values()]
    .sort((a, b) => b.references - a.references || b.calls - a.calls || a.file.localeCompare(b.file))
    .slice(0, 12);
}

function findRelatedCallbacks(
  facts: JavaFileFacts[],
  target: TargetParts,
  definitions: JavaSymbol[],
  references: ReferenceHit[],
  endpoints: JavaEndpoint[],
): JavaCallback[] {
  const relatedFiles = new Set([
    ...definitions.map(item => item.file),
    ...references.slice(0, 200).map(item => item.file),
    ...endpoints.map(item => item.file),
  ]);
  const relatedHandlers = new Set(endpoints.map(endpoint => endpoint.handler));
  return facts
    .flatMap(fact => fact.callbacks)
    .filter(callback =>
      relatedFiles.has(callback.file)
      || (callback.target?.toLowerCase().includes(target.loweredSimple) ?? false)
      || (callback.enclosingSymbol ? relatedHandlers.has(callback.enclosingSymbol) : false)
      || callback.text.toLowerCase().includes(target.loweredRaw))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

function findRelatedAnnotations(
  facts: JavaFileFacts[],
  definitions: JavaSymbol[],
  references: ReferenceHit[],
  endpoints: JavaEndpoint[],
): JavaAnnotation[] {
  const relatedFiles = new Set([
    ...definitions.map(item => item.file),
    ...references.slice(0, 200).map(item => item.file),
    ...endpoints.map(item => item.file),
  ]);
  return facts
    .flatMap(fact => fact.annotations)
    .filter(annotation => relatedFiles.has(annotation.file))
    .sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

function buildFlowTraces(facts: JavaFileFacts[], endpoints: JavaEndpoint[], maxDepth: number): FlowTrace[] {
  const methodIndex = buildMethodIndexes(facts);
  return endpoints.slice(0, 40).map((endpoint, index) => {
    const steps: FlowStep[] = [{
      id: `flow:${index + 1}:endpoint`,
      depth: 0,
      kind: 'endpoint',
      label: `${endpoint.method} ${endpoint.path}`,
      file: endpoint.file,
      line: endpoint.line,
      text: endpoint.annotation,
      target: endpoint.handler,
      confidence: 0.78,
    }];
    const handler = methodIndex.byFqName.get(endpoint.handler);
    if (handler) {
      traceMethodFlow({
        facts,
        methodIndex,
        method: handler,
        depth: 1,
        maxDepth,
        steps,
        visited: new Set([handler.fqName]),
      });
    } else {
      steps.push({
        id: `flow:${index + 1}:handler-unresolved`,
        depth: 1,
        kind: 'handler',
        label: endpoint.handler,
        file: endpoint.file,
        line: endpoint.line,
        target: endpoint.handler,
        confidence: 0.45,
      });
    }
    const returnedSteps = steps.slice(0, 200);
    return {
      id: `flow:${index + 1}`,
      label: `${endpoint.method} ${endpoint.path}`,
      endpoint: {
        method: endpoint.method,
        path: endpoint.path,
        handler: endpoint.handler,
        file: endpoint.file,
        line: endpoint.line,
      },
      maxDepth,
      truncated: steps.some(step => step.depth >= maxDepth) || steps.length >= 200,
      mermaid: buildMermaidSequence(returnedSteps),
      diagnostics: buildFlowDiagnostics(returnedSteps, steps.length),
      steps: returnedSteps,
    };
  });
}

function buildMermaidSequence(steps: FlowStep[]): string {
  const participants = new Map<string, string>();
  const lines = ['sequenceDiagram'];
  const stack = new Map<number, string>();

  const participantFor = (step: FlowStep, parentLabel: string): string => {
    if (step.kind === 'endpoint') return 'Client';
    if (step.kind === 'handler') return classFromStep(step) || 'Handler';
    if (step.kind === 'branch' || step.kind === 'loop' || step.kind === 'exception') return 'Logic';
    if (step.kind === 'return' || step.kind === 'throw') return 'Result';
    if (step.kind === 'method_reference' || step.kind === 'lambda') return classFromStep(step) || 'Callback';
    if (step.kind === 'annotation') return 'Framework';
    if (step.kind === 'call') {
      const isLikelyUnresolvedLocalCall = isUnqualifiedMethod(step.target ?? step.label) && isLikelyCallFromThisLikeOwner(step.label);
      return isLikelyUnresolvedLocalCall ? (parentLabel || 'Call') : (classFromStep(step) || simpleOwner(step.target ?? step.label) || parentLabel || 'Call');
    }
    return classFromStep(step) || simpleOwner(step.target || step.label) || 'Call';
  };

  for (const step of steps) {
    const parentId = nearestParentActor(stack, step.depth);
    const parentLabel = parentId === 'Client'
      ? 'Client'
      : (parentId ? participants.get(parentId) : undefined) || 'Client';
    const actorLabel = participantFor(step, parentLabel);
    const actor = sanitizeMermaidId(actorLabel);
    participants.set(actor, actorLabel);
    stack.set(step.depth, actor);
    if (step.kind === 'endpoint') continue;
    const parent = nearestParentActor(stack, step.depth) ?? 'Client';
    participants.set(parent, parent);
    const label = sanitizeMermaidText(step.label);
    if (step.kind === 'branch' || step.kind === 'loop' || step.kind === 'exception') {
      lines.push(`Note over ${parent},${actor}: ${label}`);
    } else if (step.kind === 'return') {
      lines.push(`${parent}-->>${actor}: ${label}`);
    } else if (step.kind === 'throw') {
      lines.push(`${parent}--x${actor}: ${label}`);
    } else {
      const arrow = step.kind === 'lambda' || step.kind === 'method_reference' ? '->>' : '->>';
      lines.push(`${parent}${arrow}${actor}: ${label}`);
    }
  }

  const declarations = [...participants.entries()].map(([id, label]) => `participant ${id} as ${sanitizeMermaidText(label)}`);
  return ['sequenceDiagram', ...declarations, ...lines.slice(1)].join('\n');
}

function nearestParentActor(stack: Map<number, string>, depth: number): string | undefined {
  for (let cursor = depth - 1; cursor >= 0; cursor--) {
    const actor = stack.get(cursor);
    if (actor) return actor;
  }
  return undefined;
}

function classFromStep(step: FlowStep): string | undefined {
  const targetClass = classFromSymbol(step.target ?? '');
  if (targetClass) return targetClass;
  if (step.kind === 'method_reference' || step.kind === 'lambda') {
    const callbackMatch = /^([A-Za-z_$][\w$]*)::/.exec(String(step.label || ''));
    if (callbackMatch) return callbackMatch?.[1];
  }
  return classFromSymbol(step.label);
}

function simpleOwner(value: string): string | undefined {
  const clean = value.replace(/\([^)]*\)/g, '');
  const parts = clean.split('.').filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : parts[0];
}

function classFromSymbol(value: string): string | undefined {
  const clean = String(value).replace(/\([^)]*\)/g, '');
  const parts = clean.split('.').filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : parts[0];
}

function isUnqualifiedMethod(value: string): boolean {
  const clean = String(value).replace(/\([^)]*\)/g, '').trim();
  return /^[a-z_$][\w$]*$/.test(clean) && !clean.includes('.');
}

function isLikelyCallFromThisLikeOwner(label: string): boolean {
  const clean = String(label).replace(/\([^)]*\)/g, '');
  const parts = clean.split('.').filter(Boolean);
  const owner = parts.length > 1 ? parts[parts.length - 2] : '';
  return owner === '' || owner === 'this' || owner === 'super';
}

function sanitizeMermaidId(value: string): string {
  const sanitized = value.replace(/[^A-Za-z0-9_]/g, '_').replace(/^([^A-Za-z_])/, '_$1');
  return sanitized || 'Participant';
}

function sanitizeMermaidText(value: string): string {
  return value.replace(/[:;\n\r]/g, ' ').trim();
}

function traceMethodFlow(input: {
  facts: JavaFileFacts[];
  methodIndex: MethodIndexes;
  method: JavaSymbol;
  depth: number;
  maxDepth: number;
  steps: FlowStep[];
  visited: Set<string>;
}): void {
  if (input.depth > input.maxDepth || input.steps.length >= 200) return;
  input.steps.push({
    id: `flow-step:${input.steps.length + 1}`,
    depth: input.depth,
    kind: 'handler',
    label: input.method.owner ? `${input.method.owner}.${input.method.name}` : input.method.name,
    file: input.method.file,
    line: input.method.line,
    text: input.method.signature,
    target: input.method.fqName,
    confidence: 0.82,
  });
  if (input.depth >= input.maxDepth) return;
  const fact = input.facts.find(item => item.file === input.method.file);
  if (!fact) return;
  const range = methodBodyRange(fact.methods, input.method);
  const callbacksByLine = new Map(fact.callbacks.map(callback => [callback.line, callback]));
  const receiverTypes = receiverTypesForMethod(input.methodIndex, input.method);
  for (let lineNo = range.start; lineNo <= range.end && input.steps.length < 200; lineNo++) {
    const raw = fact.lines[lineNo - 1] ?? '';
    const text = compactLine(raw);
    if (!text) continue;
    if (lineNo === input.method.line) continue;
    for (const local of localVariablesFromLine(raw)) {
      receiverTypes.set(local.name, local.typeName);
    }
    const callback = callbacksByLine.get(lineNo);
    const logicStep = logicStepFromLine(raw, text, input.method.file, lineNo, input.depth + 1, input.steps.length + 1);
    if (logicStep) input.steps.push(logicStep);
    if (callback) {
      const resolved = resolveCallbackTargetFromIndex(input.methodIndex, callback, input.method, receiverTypes);
      input.steps.push({
        id: `flow-step:${input.steps.length + 1}`,
        depth: input.depth + 1,
        kind: callback.kind,
        label: callback.kind === 'method_reference'
          ? `${callback.receiver ?? 'ref'}::${callback.target ?? 'unknown'}`
          : callback.target ? `lambda -> ${callback.target}` : 'lambda',
        file: callback.file,
        line: callback.line,
        text: callback.text,
        target: resolved?.fqName ?? callback.target,
        confidence: resolved ? 0.78 : 0.58,
      });
      if (resolved && !input.visited.has(resolved.fqName)) {
        input.visited.add(resolved.fqName);
        traceMethodFlow({ ...input, method: resolved, depth: input.depth + 2 });
      }
      continue;
    }
    for (const call of callsFromLine(raw).slice(0, 8)) {
      const resolved = resolveCallTarget(input.methodIndex, call, input.method, receiverTypes);
      input.steps.push({
        id: `flow-step:${input.steps.length + 1}`,
        depth: input.depth + 1,
        kind: 'call',
        label: call.receiver ? `${call.receiver}.${call.name}()` : `${call.name}()`,
        file: input.method.file,
        line: lineNo,
        text,
        target: resolved?.fqName ?? call.name,
        confidence: resolved ? 0.72 : 0.48,
      });
      if (resolved && !input.visited.has(resolved.fqName)) {
        input.visited.add(resolved.fqName);
        traceMethodFlow({ ...input, method: resolved, depth: input.depth + 2 });
      }
    }
  }
}

function logicStepFromLine(
  raw: string,
  text: string,
  file: string,
  line: number,
  depth: number,
  nextIndex: number,
): FlowStep | undefined {
  const stripped = raw.replace(/\/\/.*$/, '').trim();
  const compact = compactLine(stripped);
  if (!compact) return undefined;
  const lower = compact.toLowerCase();
  const base = {
    id: `flow-step:${nextIndex}`,
    depth,
    file,
    line,
    text,
    confidence: 0.64,
  };
  if (/^(if|else\s+if|else|switch|case|default)\b/.test(lower) || /\?\s*[^:]+:/.test(compact)) {
    return { ...base, kind: 'branch', label: trimLogicLabel(compact, 'branch') };
  }
  if (/^(for|while|do)\b/.test(lower) || /\.(forEach|stream|parallelStream)\s*\(/.test(compact)) {
    return { ...base, kind: 'loop', label: trimLogicLabel(compact, 'loop') };
  }
  if (/^(try|catch|finally)\b/.test(lower)) {
    return { ...base, kind: 'exception', label: trimLogicLabel(compact, 'exception') };
  }
  if (/^throw\b/.test(lower)) {
    return { ...base, kind: 'throw', label: trimLogicLabel(compact, 'throw') };
  }
  if (/^return\b/.test(lower)) {
    return { ...base, kind: 'return', label: trimLogicLabel(compact, 'return') };
  }
  return undefined;
}

function trimLogicLabel(value: string, fallback: string): string {
  const label = value.replace(/\s*\{\s*$/, '').trim();
  return label.length > 120 ? `${label.slice(0, 117)}...` : label || fallback;
}

function buildFlowDiagnostics(steps: FlowStep[], originalStepCount: number): FlowDiagnostics {
  const executable = steps.filter(step => step.kind === 'call' || step.kind === 'lambda' || step.kind === 'method_reference');
  const resolvedCalls = executable.filter(step => step.confidence >= 0.7).length;
  const unresolvedCalls = executable.length - resolvedCalls;
  const branchMarkers = steps.filter(step => step.kind === 'branch').length;
  const loopMarkers = steps.filter(step => step.kind === 'loop').length;
  const exceptionMarkers = steps.filter(step => step.kind === 'exception' || step.kind === 'throw').length;
  const returnMarkers = steps.filter(step => step.kind === 'return').length;
  const averageConfidence = steps.length
    ? Number((steps.reduce((sum, step) => sum + step.confidence, 0) / steps.length).toFixed(2))
    : 0;
  const notes = [
    'Static path only: this shows possible source-level flow, not one runtime scenario.',
  ];
  if (unresolvedCalls > 0) notes.push(`${unresolvedCalls} call/callback step(s) were not uniquely resolved.`);
  if (branchMarkers + loopMarkers + exceptionMarkers > 0) notes.push('Control-flow markers indicate logic branches, loops, or exception paths that need scenario/runtime validation.');
  if (originalStepCount > steps.length) notes.push(`Flow was capped at ${steps.length} of ${originalStepCount} discovered steps.`);
  return {
    resolvedCalls,
    unresolvedCalls,
    branchMarkers,
    loopMarkers,
    exceptionMarkers,
    returnMarkers,
    averageConfidence,
    staticOnly: true,
    notes,
  };
}

interface MethodIndexes {
  byFqName: Map<string, JavaSymbol>;
  bySimple: Map<string, JavaSymbol[]>;
  byOwnerAndSimple: Map<string, JavaSymbol[]>;
  classesBySimple: Map<string, JavaSymbol[]>;
  fieldsByOwner: Map<string, JavaSymbol[]>;
}

function buildMethodIndexes(facts: JavaFileFacts[]): MethodIndexes {
  const byFqName = new Map<string, JavaSymbol>();
  const bySimple = new Map<string, JavaSymbol[]>();
  const byOwnerAndSimple = new Map<string, JavaSymbol[]>();
  const classesBySimple = new Map<string, JavaSymbol[]>();
  const fieldsByOwner = new Map<string, JavaSymbol[]>();
  for (const classSymbol of facts.flatMap(fact => fact.classes)) {
    classesBySimple.set(classSymbol.name, [...(classesBySimple.get(classSymbol.name) ?? []), classSymbol]);
  }
  for (const field of facts.flatMap(fact => fact.fields)) {
    if (field.owner) fieldsByOwner.set(field.owner, [...(fieldsByOwner.get(field.owner) ?? []), field]);
  }
  for (const method of facts.flatMap(fact => fact.methods)) {
    byFqName.set(method.fqName, method);
    bySimple.set(method.name, [...(bySimple.get(method.name) ?? []), method]);
    if (method.owner) {
      const key = `${method.owner}.${method.name}`;
      byOwnerAndSimple.set(key, [...(byOwnerAndSimple.get(key) ?? []), method]);
    }
  }
  return { byFqName, bySimple, byOwnerAndSimple, classesBySimple, fieldsByOwner };
}

function methodBodyRange(methods: JavaSymbol[], method: JavaSymbol): { start: number; end: number } {
  const sorted = methods.slice().sort((a, b) => a.line - b.line);
  const index = sorted.findIndex(candidate => symbolKey(candidate) === symbolKey(method));
  const next = index >= 0 ? sorted[index + 1] : undefined;
  return {
    start: method.line,
    end: next ? Math.max(method.line, next.line - 1) : method.line + 80,
  };
}

function callsFromLine(raw: string): Array<{ receiver?: string; name: string; argCount?: number }> {
  const stripped = raw
    .replace(/"[^"]*"/g, '""')
    .replace(/'[^']*'/g, "''")
    .replace(/\/\/.*$/, '');
  const calls: Array<{ receiver?: string; name: string; argCount?: number }> = [];
  const callPattern = /\b(?:(this|super|[A-Za-z_$][\w$]*)\s*\.\s*)?([A-Za-z_$][\w$]*)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = callPattern.exec(stripped))) {
    const name = match[2] ?? '';
    if (!name || CONTROL_KEYWORDS.has(name) || /^[A-Z]/.test(name)) continue;
    const openIndex = callPattern.lastIndex - 1;
    calls.push({ receiver: match[1], name, argCount: countCallArguments(stripped, openIndex) });
  }
  return calls;
}

function countCallArguments(value: string, openIndex: number): number | undefined {
  const closeIndex = matchingParenIndex(value, openIndex);
  if (closeIndex === undefined) return undefined;
  const inner = value.slice(openIndex + 1, closeIndex).trim();
  if (!inner) return 0;
  return splitTopLevel(inner, ',').length;
}

function matchingParenIndex(value: string, openIndex: number): number | undefined {
  let depth = 0;
  for (let index = openIndex; index < value.length; index++) {
    const char = value[index];
    if (char === '(') depth++;
    else if (char === ')') {
      depth--;
      if (depth === 0) return index;
    }
  }
  return undefined;
}

function resolveCallTarget(
  index: MethodIndexes,
  call: { receiver?: string; name: string; argCount?: number },
  enclosing: JavaSymbol,
  receiverTypes: Map<string, string>,
): JavaSymbol | undefined {
  if (call.receiver === 'this' || !call.receiver) {
    const ownerMatch = enclosing.owner ? uniqueMethod(index.byOwnerAndSimple.get(`${enclosing.owner}.${call.name}`) ?? [], call.argCount) : undefined;
    if (ownerMatch) return ownerMatch;
  }
  if (call.receiver) {
    const owner = resolveReceiverOwner(index, call.receiver, receiverTypes);
    if (owner) {
      const ownerMatch = uniqueMethod(index.byOwnerAndSimple.get(`${owner}.${call.name}`) ?? [], call.argCount);
      if (ownerMatch) return ownerMatch;
    }
    return undefined;
  }
  const candidates = index.bySimple.get(call.name) ?? [];
  return uniqueMethod(candidates, call.argCount);
}

function resolveCallbackTargetFromIndex(
  index: MethodIndexes,
  callback: JavaCallback,
  enclosing: JavaSymbol,
  receiverTypes?: Map<string, string>,
): JavaSymbol | undefined {
  if (!callback.target) return undefined;
  const splitTarget = splitReceiverTarget(callback.target);
  if (splitTarget) {
    const owner = receiverTypes ? resolveReceiverOwner(index, splitTarget.receiver, receiverTypes) : undefined;
    if (owner) return uniqueSymbol(index.byOwnerAndSimple.get(`${owner}.${splitTarget.target}`) ?? []);
    return undefined;
  }
  if (callback.receiver === 'this' || !callback.receiver) {
    const ownerMatch = enclosing.owner ? uniqueSymbol(index.byOwnerAndSimple.get(`${enclosing.owner}.${callback.target}`) ?? []) : undefined;
    if (ownerMatch) return ownerMatch;
  }
  if (callback.receiver && receiverTypes) {
    const owner = resolveReceiverOwner(index, callback.receiver, receiverTypes);
    if (owner) {
      const ownerMatch = uniqueSymbol(index.byOwnerAndSimple.get(`${owner}.${callback.target}`) ?? []);
      if (ownerMatch) return ownerMatch;
    }
    return undefined;
  }
  const candidates = index.bySimple.get(callback.target) ?? [];
  return uniqueSymbol(candidates);
}

function receiverTypesForMethod(index: MethodIndexes, method: JavaSymbol): Map<string, string> {
  const types = new Map<string, string>();
  if (method.owner) types.set('this', method.owner);
  for (const field of method.owner ? index.fieldsByOwner.get(method.owner) ?? [] : []) {
    if (field.typeName) types.set(field.name, field.typeName);
  }
  for (const param of method.parameters ?? []) {
    types.set(param.name, param.typeName);
  }
  return types;
}

function localVariablesFromLine(raw: string): JavaParameter[] {
  const stripped = raw
    .replace(/"[^"]*"/g, '""')
    .replace(/'[^']*'/g, "''")
    .replace(/\/\/.*$/, '')
    .trim();
  if (!stripped.includes('=') || stripped.startsWith('return ') || stripped.startsWith('throw ')) return [];
  const beforeEquals = stripped.slice(0, stripped.indexOf('=')).trim();
  const match = beforeEquals.match(/^(?:final\s+)?(.+?)\s+([A-Za-z_$][\w$]*)$/);
  if (!match) return [];
  const rawType = (match[1] ?? '').trim();
  const name = match[2] ?? '';
  const typeName = rawType === 'var'
    ? inferVarTypeFromInitializer(stripped.slice(stripped.indexOf('=') + 1))
    : cleanTypeName(rawType);
  return typeName && name ? [{ name, typeName }] : [];
}

function inferVarTypeFromInitializer(initializer: string): string | undefined {
  const newMatch = initializer.match(/\bnew\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)(?:<[^>]*>)?\s*\(/);
  return newMatch ? cleanTypeName(newMatch[1] ?? '') : undefined;
}

function resolveReceiverOwner(index: MethodIndexes, receiver: string, receiverTypes: Map<string, string>): string | undefined {
  if (receiver === 'this') return receiverTypes.get('this');
  const typeName = receiverTypes.get(receiver);
  if (typeName) return simpleTypeName(typeName);
  if (/^[A-Z]/.test(receiver) && index.classesBySimple.has(receiver)) return receiver;
  return undefined;
}

function simpleTypeName(typeName: string): string {
  const withoutGenerics = typeName
    .replace(/<.*>/g, '')
    .replace(/\[\]/g, '')
    .replace(/\.\.\./g, '')
    .trim();
  return withoutGenerics.split('.').filter(Boolean).at(-1) ?? withoutGenerics;
}

function splitReceiverTarget(target: string): { receiver: string; target: string } | undefined {
  const match = target.match(/^([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)$/);
  return match ? { receiver: match[1] ?? '', target: match[2] ?? '' } : undefined;
}

function uniqueSymbol(candidates: JavaSymbol[]): JavaSymbol | undefined {
  const unique = new Map(candidates.map(candidate => [symbolKey(candidate), candidate]));
  return unique.size === 1 ? [...unique.values()][0] : undefined;
}

function uniqueMethod(candidates: JavaSymbol[], argCount: number | undefined): JavaSymbol | undefined {
  const arityMatches = argCount === undefined
    ? candidates
    : candidates.filter(candidate => (candidate.parameters?.length ?? 0) === argCount);
  return uniqueSymbol(arityMatches);
}

function buildWarnings(input: {
  definitions: JavaSymbol[];
  references: ReferenceHit[];
  skippedLargeFiles: number;
  truncated: boolean;
}, nodeCount: number, edgeCount: number): string[] {
  const warnings: string[] = [
    'Static prototype output is regex-based; use JDT LS or another semantic Java index for production precision.',
  ];
  if (input.definitions.length === 0) warnings.push('No exact definition matched the target; graph is reference-only.');
  if (input.references.length === 0) warnings.push('No references matched the target in the scanned Java file set.');
  if (input.skippedLargeFiles > 0) warnings.push(`${input.skippedLargeFiles} large Java files were skipped by maxFileBytes.`);
  if (input.truncated) warnings.push('Java file discovery was truncated by maxFiles.');
  if (nodeCount === 0 || edgeCount === 0) warnings.push('Graph is sparse; choose a more specific Java class, method, or field target.');
  return warnings;
}

function normalizeTarget(raw: string): TargetParts {
  const trimmed = raw.trim();
  if (!trimmed) throw new Error('Target symbol is required. Pass --target <Class.method|field|ClassName>.');
  const noParams = trimmed.replace(/\([^)]*\)/g, '');
  const parts = noParams.split('.').filter(Boolean);
  const simple = parts.at(-1) ?? noParams;
  const owner = parts.length >= 2 ? parts.at(-2) : undefined;
  return {
    raw: trimmed,
    simple,
    owner,
    loweredRaw: trimmed.toLowerCase(),
    loweredSimple: simple.toLowerCase(),
    loweredOwner: owner?.toLowerCase(),
  };
}

function symbolMatchesTarget(symbol: JavaSymbol, target: TargetParts): boolean {
  const fq = symbol.fqName.toLowerCase();
  const simple = symbol.name.toLowerCase();
  if (fq === target.loweredRaw || fq.endsWith(`.${target.loweredRaw}`)) return true;
  if (target.owner) {
    return simple === target.loweredSimple && (symbol.owner?.toLowerCase() === target.loweredOwner || fq.endsWith(`.${target.loweredOwner}.${target.loweredSimple}`));
  }
  return simple === target.loweredSimple || fq.endsWith(`.${target.loweredSimple}`);
}

function confidenceForReference(raw: string, target: TargetParts, kind: EvidenceItem['kind']): number {
  const lowered = raw.toLowerCase();
  if (target.owner && lowered.includes(target.loweredOwner ?? '') && lowered.includes(target.loweredSimple)) return 0.78;
  if (kind === 'method_reference') return 0.74;
  if (kind === 'lambda') return 0.7;
  if (kind === 'call') return 0.68;
  if (kind === 'field_write' || kind === 'field_read') return 0.64;
  if (kind === 'test') return 0.62;
  return 0.56;
}

function enclosingMethod(methods: JavaSymbol[], line: number): JavaSymbol | undefined {
  let current: JavaSymbol | undefined;
  for (const method of methods) {
    if (method.line > line) break;
    current = method;
  }
  return current;
}

function looksLikeFieldRead(raw: string, simple: string): boolean {
  if (new RegExp(`\\b${escapeRegExp(simple)}\\s*\\(`).test(raw)) return false;
  return new RegExp(`\\b${escapeRegExp(simple)}\\b`).test(raw);
}

function parsePackageName(content: string): string {
  return content.match(/^\s*package\s+([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*;/m)?.[1] ?? '';
}

function qualify(packageName: string, name: string): string {
  return packageName ? `${packageName}.${name}` : name;
}

function inferClassRole(file: string, name: string, annotations: string[]): string | undefined {
  const joined = annotations.join('\n');
  if (/@(?:RestController|Controller)\b/.test(joined) || /Controller\.java$/.test(file) || name.endsWith('Controller')) return 'controller';
  if (/@Service\b/.test(joined) || name.endsWith('Service')) return 'service';
  if (/@Repository\b/.test(joined) || name.endsWith('Repository')) return 'repository';
  if (/@(?:ApplicationScoped|RequestScoped|SessionScoped|Singleton|Named)\b/.test(joined)) return 'jakarta-bean';
  if (/@Entity\b/.test(joined)) return 'entity';
  if (isTestPath(file) || name.endsWith('Test') || name.endsWith('Tests')) return 'test';
  return undefined;
}

function annotationSimpleName(text: string): string {
  const raw = text.match(/^@([A-Za-z_$][\w$.]*)/)?.[1] ?? '';
  const parts = raw.split('.');
  return parts.at(-1) ?? raw;
}

function annotationFramework(name: string): JavaAnnotation['framework'] {
  if (SPRING_ANNOTATIONS.has(name)) return 'spring';
  if (JAKARTA_ANNOTATIONS.has(name)) return 'jakarta';
  if (JAVA_EE_ANNOTATIONS.has(name)) return 'javaee';
  if (JUNIT_ANNOTATIONS.has(name)) return 'junit';
  return 'unknown';
}

function isFrameworkRelevantAnnotation(name: string): boolean {
  return SPRING_ANNOTATIONS.has(name)
    || JAKARTA_ANNOTATIONS.has(name)
    || JAVA_EE_ANNOTATIONS.has(name)
    || JUNIT_ANNOTATIONS.has(name);
}

function httpMethodForAnnotation(annotationName: string, args: string): string {
  switch (annotationName) {
    case 'GetMapping': return 'GET';
    case 'PostMapping': return 'POST';
    case 'PutMapping': return 'PUT';
    case 'DeleteMapping': return 'DELETE';
    case 'PatchMapping': return 'PATCH';
    default: {
      const method = args.match(/RequestMethod\.([A-Z]+)/)?.[1];
      return method ?? 'ANY';
    }
  }
}

function parseEndpointAnnotation(annotation: string): { method: string; path: string } | undefined {
  const match = annotation.match(/^@(?:[\w.]+\.)?(GetMapping|PostMapping|PutMapping|DeleteMapping|PatchMapping|RequestMapping|GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b(?:\((.*)\))?/);
  if (!match) return undefined;
  const annotationName = match[1] ?? 'RequestMapping';
  const args = match[2] ?? '';
  const method = /^[A-Z]+$/.test(annotationName)
    ? annotationName
    : httpMethodForAnnotation(annotationName, args);
  return { method, path: extractPath(args) };
}

function pathAnnotationValue(annotations: string[]): string | undefined {
  const annotation = annotations.find(item => /^@(?:[\w.]+\.)?Path\b/.test(item.trim()));
  if (!annotation) return undefined;
  const args = annotation.match(/^@(?:[\w.]+\.)?Path\b(?:\((.*)\))?/)?.[1] ?? '';
  return extractPath(args);
}

function extractPath(args: string): string {
  const stringMatch = args.match(/["']([^"']+)["']/);
  if (stringMatch) return stringMatch[1] ?? '';
  const value = args
    .replace(/^\s*value\s*=\s*/, '')
    .split(',')
    .at(0)
    ?.replace(/[{}]/g, '')
    .trim();
  return value && /^[A-Za-z_$][\w$.]*$/.test(value) ? value : '';
}

function normalizeEndpointPath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

function filePriorityScore(file: string, isTest: boolean): number {
  let score = isTest ? 100 : 300;
  if (file.includes('/src/main/java/')) score += 500;
  if (file.includes('/src/test/java/')) score += 120;
  if (/(Controller|Resource|Endpoint|Service|Repository|Configuration|FileSystem|Application)\.java$/.test(file)) score += 120;
  if (file.includes('/generated/') || file.includes('/build/')) score -= 300;
  return score;
}

function isTestPath(file: string): boolean {
  return /(^|\/)(src\/test|test|tests|it|integrationTest)(\/|$)/i.test(file) || /(?:Test|Tests|IT)\.java$/.test(file);
}

function shouldScanDirectory(name: string): boolean {
  if (IGNORED_DIRS.has(name)) return false;
  return !name.startsWith('.');
}

function symbolNode(symbol: JavaSymbol): GraphNode {
  return {
    id: symbolNodeId(symbol),
    kind: symbol.kind === 'method' ? 'method' : 'symbol',
    label: symbol.owner && symbol.kind !== 'class' ? `${symbol.owner}.${symbol.name}` : symbol.name,
    file: symbol.file,
    line: symbol.line,
    role: symbol.role ?? symbol.kind,
    meta: {
      fqName: symbol.fqName,
      kind: symbol.kind,
      signature: symbol.signature,
    },
  };
}

function methodNode(symbol: JavaSymbol): GraphNode {
  return symbolNode(symbol);
}

function fileNode(file: string, isTest: boolean): GraphNode {
  return {
    id: fileNodeId(file),
    kind: isTest ? 'test' : 'file',
    label: path.posix.basename(file),
    file,
    role: isTest ? 'test' : 'source',
  };
}

function symbolNodeId(symbol: JavaSymbol): string {
  return `symbol:${symbol.fqName}:${symbol.file}:${symbol.line}`;
}

function methodNodeId(symbol: JavaSymbol): string {
  return symbolNodeId(symbol);
}

function fileNodeId(file: string): string {
  return `file:${file}`;
}

function endpointNodeId(endpoint: JavaEndpoint): string {
  return `endpoint:${endpoint.method}:${endpoint.path}:${endpoint.file}:${endpoint.line}`;
}

function callbackNodeId(callback: JavaCallback): string {
  return `callback:${callback.kind}:${callback.file}:${callback.line}:${callback.target ?? ''}`;
}

function annotationNodeId(annotation: JavaAnnotation): string {
  return `annotation:${annotation.name}:${annotation.file}:${annotation.line}`;
}

function resolveCallbackTargetSymbol(symbolsByFqName: Map<string, JavaSymbol>, callback: JavaCallback): JavaSymbol | undefined {
  if (!callback.target) return undefined;
  const candidates = [...symbolsByFqName.values()].filter(symbol => symbol.kind === 'method' && symbol.name === callback.target);
  if (callback.receiver === 'this' && callback.enclosingSymbol) {
    const enclosing = symbolsByFqName.get(callback.enclosingSymbol);
    const ownerMatch = candidates.find(symbol => symbol.owner && symbol.owner === enclosing?.owner);
    if (ownerMatch) return ownerMatch;
  }
  return candidates.length === 1 ? candidates[0] : undefined;
}

function symbolKey(symbol: JavaSymbol): string {
  return `${symbol.fqName}\0${symbol.file}\0${symbol.line}`;
}

function compactLine(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 260);
}

function wordRegex(value: string): RegExp {
  return new RegExp(`\\b${escapeRegExp(value)}\\b`, 'i');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function slash(value: string): string {
  return value.replace(/\\/g, '/');
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.floor(value), min), max);
}

function clampLimit(value: number | undefined, fallback: number, min: number, max: number, fullValue: number): number {
  if (value === undefined) return fallback;
  if (value === 0) return fullValue;
  return clampInt(value, min, max);
}
