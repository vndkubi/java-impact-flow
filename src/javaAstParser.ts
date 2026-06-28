import { parse } from 'java-parser';

export interface AstCall {
  receiver?: string;
  name: string;
  argCount: number;
  line?: number;
}

export interface AstField {
  name: string;
  fieldType?: string;
  owner?: string;
}

export interface AstMethod {
  name: string;
  owner?: string;
  annotations: string[];
  paramCount: number;
  line?: number;
}

export interface AstClass {
  name: string;
  kind: 'class' | 'interface' | 'enum';
  annotations: string[];
}

export interface AstImport {
  name: string;
  isStatic: boolean;
}

export interface AstParseResult {
  packageName?: string;
  imports: AstImport[];
  classes: AstClass[];
  methods: AstMethod[];
  fields: AstField[];
  calls: AstCall[];
  engine: 'ast';
}

// Control keywords that cannot be method names
const CTRL = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'throw', 'new', 'assert', 'synchronized']);

// --- CST traversal helpers ---

type CstNode = { name: string; children: Record<string, CstNode[] | IToken[]> };
type IToken = { image: string; startLine?: number; tokenType?: { name: string } };

function isToken(n: unknown): n is IToken {
  return typeof n === 'object' && n !== null && 'image' in n && !('name' in n);
}

function allIdentifierImages(node: CstNode | IToken | null | undefined): string[] {
  if (!node) return [];
  if (isToken(node)) return node.tokenType?.name === 'Identifier' ? [node.image] : [];
  const result: string[] = [];
  for (const kids of Object.values(node.children ?? {})) {
    for (const kid of kids as Array<CstNode | IToken>) {
      result.push(...allIdentifierImages(kid as any));
    }
  }
  return result;
}

function tokenLine(node: CstNode | IToken | null | undefined): number | undefined {
  if (!node) return undefined;
  if (isToken(node)) return node.startLine;
  for (const kids of Object.values(node.children ?? {})) {
    for (const kid of kids as Array<CstNode | IToken>) {
      const l = tokenLine(kid as any);
      if (l) return l;
    }
  }
  return undefined;
}

// --- Prefix identifier extraction ---

function getFqnIds(fqn: CstNode): string[] {
  const ids: string[] = [];
  const firstPart = (fqn.children.fqnOrRefTypePartFirst as CstNode[] | undefined)?.[0];
  const firstCommon = (firstPart?.children?.fqnOrRefTypePartCommon as CstNode[] | undefined)?.[0];
  if (firstCommon) {
    const idTok = (firstCommon.children.Identifier as IToken[] | undefined)?.[0];
    const superTok = (firstCommon.children.Super as IToken[] | undefined)?.[0];
    const thisTok = (firstCommon.children.This as IToken[] | undefined)?.[0];
    if (idTok) ids.push(idTok.image);
    else if (superTok) ids.push('super');
    else if (thisTok) ids.push('this');
  }
  for (const rest of (fqn.children.fqnOrRefTypePartRest as CstNode[] | undefined) ?? []) {
    const common = (rest.children?.fqnOrRefTypePartCommon as CstNode[] | undefined)?.[0];
    const idTok = (common?.children?.Identifier as IToken[] | undefined)?.[0];
    if (idTok) ids.push(idTok.image);
  }
  return ids;
}

function getPrefixIds(prefix: CstNode): string[] {
  if (!prefix) return [];
  const thisTok = (prefix.children.This as IToken[] | undefined)?.[0];
  if (thisTok) return ['this'];
  const fqn = (prefix.children.fqnOrRefType as CstNode[] | undefined)?.[0];
  return fqn ? getFqnIds(fqn) : [];
}

// --- Arg counting ---

function countArgs(invSuffix: CstNode): number {
  const argList = (invSuffix?.children?.argumentList as CstNode[] | undefined)?.[0];
  if (!argList) return 0;
  return ((argList.children?.expression as unknown[] | undefined) ?? []).length;
}

// --- Call extraction from a primary node ---

export function extractCallsFromPrimary(primary: CstNode): AstCall[] {
  const calls: AstCall[] = [];
  const prefix = (primary.children.primaryPrefix as CstNode[] | undefined)?.[0];
  const suffixes = (primary.children.primarySuffix as CstNode[] | undefined) ?? [];

  if (!prefix) return calls;
  const prefixIds = getPrefixIds(prefix);
  if (!prefixIds.length) return calls;

  let i = 0;
  let chain: string | undefined = prefixIds[prefixIds.length - 1];

  // Case: first suffix is direct methodInvocationSuffix
  // → prefix last ID is the method name, second-to-last is receiver
  if ((suffixes[0]?.children?.methodInvocationSuffix as CstNode[] | undefined)?.length) {
    const name = prefixIds[prefixIds.length - 1] ?? '';
    if (name && !CTRL.has(name) && !/^[A-Z]/.test(name)) {
      const receiver = prefixIds.length >= 2 ? prefixIds[prefixIds.length - 2] : undefined;
      const inv = (suffixes[0].children.methodInvocationSuffix as CstNode[])[0];
      calls.push({ receiver, name, argCount: countArgs(inv), line: tokenLine(prefix) });
    }
    chain = name;
    i = 1;
  }

  // Process remaining suffix pairs: Dot+Identifier followed by methodInvocationSuffix
  while (i < suffixes.length) {
    const suf = suffixes[i];
    const sChildren = suf.children ?? {};
    const hasDot = !!(sChildren.Dot as unknown[] | undefined)?.length;
    const idToks = (sChildren.Identifier as IToken[] | undefined) ?? [];

    if (hasDot && idToks.length) {
      const fieldName = idToks[0].image;
      const nextSuf = suffixes[i + 1];
      const nextInvs = (nextSuf?.children?.methodInvocationSuffix as CstNode[] | undefined);
      if (nextInvs?.length && fieldName && !CTRL.has(fieldName)) {
        calls.push({
          receiver: chain,
          name: fieldName,
          argCount: countArgs(nextInvs[0]),
          line: idToks[0].startLine,
        });
        chain = fieldName;
        i += 2;
        continue;
      }
      chain = fieldName;
    }
    i++;
  }

  return calls;
}

// --- Annotation name extraction ---

function annotationName(annNode: CstNode): string {
  const ids = allIdentifierImages(annNode);
  return ids[0] ?? '';
}

function extractAnnotations(modifiers: CstNode[]): string[] {
  const names: string[] = [];
  for (const mod of modifiers) {
    const anns = (mod.children?.annotation as CstNode[] | undefined) ?? [];
    for (const a of anns) names.push(annotationName(a));
  }
  return names.filter(Boolean);
}

// --- Main DFS walk state ---

interface WalkState {
  result: AstParseResult;
  classStack: string[];
}

function walkNode(node: unknown, state: WalkState): void {
  if (!node || typeof node !== 'object' || isToken(node)) return;
  const n = node as CstNode;
  if (!n.name) return;

  switch (n.name) {
    case 'packageDeclaration': {
      const ids = (n.children.Identifier as IToken[] | undefined) ?? [];
      if (ids.length) state.result.packageName = ids.map(t => t.image).join('.');
      return;
    }

    case 'importDeclaration': {
      const pkgName = (n.children.packageOrTypeName as CstNode[] | undefined)?.[0];
      if (pkgName) {
        const ids = ((pkgName.children.Identifier as IToken[] | undefined) ?? []).map(t => t.image);
        const isStar = !!(n.children.Star as unknown[] | undefined)?.length;
        const isStatic = !!(n.children.Static as unknown[] | undefined)?.length;
        const name = isStar ? ids.join('.') + '.*' : ids.join('.');
        if (name) state.result.imports.push({ name, isStatic });
      }
      return;
    }

    case 'normalClassDeclaration': {
      const typeId = (n.children.typeIdentifier as CstNode[] | undefined)?.[0];
      const name = (typeId?.children?.Identifier as IToken[] | undefined)?.[0]?.image ?? '';
      const mods = (n.children.classModifier as CstNode[] | undefined) ?? [];
      if (name) {
        state.result.classes.push({ name, kind: 'class', annotations: extractAnnotations(mods) });
        state.classStack.push(name);
        walkChildren(n, state);
        state.classStack.pop();
        return;
      }
      break;
    }

    case 'normalInterfaceDeclaration': {
      const typeId = (n.children.typeIdentifier as CstNode[] | undefined)?.[0];
      const name = (typeId?.children?.Identifier as IToken[] | undefined)?.[0]?.image ?? '';
      if (name) {
        state.result.classes.push({ name, kind: 'interface', annotations: [] });
        state.classStack.push(name);
        walkChildren(n, state);
        state.classStack.pop();
        return;
      }
      break;
    }

    case 'enumDeclaration': {
      const name = ((n.children.typeIdentifier as CstNode[] | undefined)?.[0]?.children?.Identifier as IToken[] | undefined)?.[0]?.image ?? '';
      if (name) {
        state.result.classes.push({ name, kind: 'enum', annotations: [] });
        state.classStack.push(name);
        walkChildren(n, state);
        state.classStack.pop();
        return;
      }
      break;
    }

    case 'methodDeclaration': {
      const owner = state.classStack[state.classStack.length - 1];
      const header = (n.children.methodHeader as CstNode[] | undefined)?.[0];
      const declarator = (header?.children?.methodDeclarator as CstNode[] | undefined)?.[0];
      const name = (declarator?.children?.Identifier as IToken[] | undefined)?.[0]?.image ?? '';
      const mods = (n.children.methodModifier as CstNode[] | undefined) ?? [];
      const paramList = (declarator?.children?.formalParameterList as CstNode[] | undefined)?.[0];
      const paramCount = ((paramList?.children?.formalParameter as unknown[] | undefined) ?? []).length;
      if (name) {
        state.result.methods.push({
          name,
          owner,
          annotations: extractAnnotations(mods),
          paramCount,
          line: tokenLine(declarator),
        });
      }
      break;
    }

    case 'fieldDeclaration': {
      const owner = state.classStack[state.classStack.length - 1];
      const unann = (n.children.unannType as CstNode[] | undefined)?.[0];
      const refType = (unann?.children?.unannReferenceType as CstNode[] | undefined)?.[0];
      const classType = (refType?.children?.unannClassOrInterfaceType as CstNode[] | undefined)?.[0];
      const concreteClass = (classType?.children?.unannClassType as CstNode[] | undefined)?.[0];
      const fieldType = (concreteClass?.children?.Identifier as IToken[] | undefined)?.[0]?.image;

      const varList = (n.children.variableDeclaratorList as CstNode[] | undefined)?.[0];
      for (const decl of (varList?.children?.variableDeclarator as CstNode[] | undefined) ?? []) {
        const varId = (decl.children?.variableDeclaratorId as CstNode[] | undefined)?.[0];
        const name = (varId?.children?.Identifier as IToken[] | undefined)?.[0]?.image ?? '';
        if (name) state.result.fields.push({ name, fieldType, owner });
      }
      break;
    }

    case 'primary': {
      const calls = extractCallsFromPrimary(n);
      state.result.calls.push(...calls);
      break;
    }

    default:
      break;
  }

  walkChildren(n, state);
}

function walkChildren(node: CstNode, state: WalkState): void {
  for (const kids of Object.values(node.children ?? {})) {
    for (const kid of kids as Array<CstNode | IToken>) {
      walkNode(kid, state);
    }
  }
}

// --- Public API ---

export function parseJavaAst(content: string): AstParseResult | null {
  try {
    const cst = parse(content) as unknown as CstNode;
    const state: WalkState = {
      result: { imports: [], classes: [], methods: [], fields: [], calls: [], engine: 'ast' },
      classStack: [],
    };
    walkNode(cst, state);
    return state.result;
  } catch {
    return null;
  }
}
