#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { buildImpactGraph, type ImpactMode } from './impactGraph.js';
import { renderImpactGraphHtml } from './render.js';

interface CliArgs {
  root?: string;
  target?: string;
  mode?: ImpactMode;
  out?: string;
  htmlOut?: string;
  maxFiles?: number;
  maxFileBytes?: number;
  maxNodes?: number;
  maxEdges?: number;
  maxDepth?: number;
  includeTests?: boolean;
  help?: boolean;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (!args.root || !args.target) {
    printHelp();
    throw new Error('Both --root and --target are required.');
  }

  const graph = await buildImpactGraph({
    root: args.root,
    target: args.target,
    mode: args.mode,
    maxFiles: args.maxFiles,
    maxFileBytes: args.maxFileBytes,
    maxNodes: args.maxNodes,
    maxEdges: args.maxEdges,
    maxDepth: args.maxDepth,
    includeTests: args.includeTests,
  });

  const outputs: Record<string, string> = {};
  if (args.out) {
    const out = path.resolve(args.out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(graph, null, 2), 'utf-8');
    outputs.json = out;
  }
  if (args.htmlOut) {
    const htmlOut = path.resolve(args.htmlOut);
    fs.mkdirSync(path.dirname(htmlOut), { recursive: true });
    fs.writeFileSync(htmlOut, renderImpactGraphHtml(graph), 'utf-8');
    outputs.html = htmlOut;
  }

  console.log(JSON.stringify({
    target: graph.metadata.target,
    root: graph.metadata.root,
    mode: graph.metadata.mode,
    analyzer: graph.metadata.analyzer,
    summary: graph.summary,
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    evidence: graph.evidence.length,
    warnings: graph.warnings,
    outputs,
  }, null, 2));
}

function parseArgs(argv: string[]): CliArgs {
  const result: CliArgs = { mode: 'references', includeTests: true };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    const next = () => {
      const value = argv[++i];
      if (!value) throw new Error(`Missing value after ${arg}`);
      return value;
    };
    switch (arg) {
      case '--root':
        result.root = next();
        break;
      case '--target':
      case '--symbol':
        result.target = next();
        break;
      case '--mode':
        result.mode = parseMode(next());
        break;
      case '--out':
        result.out = next();
        break;
      case '--html-out':
        result.htmlOut = next();
        break;
      case '--max-files':
        result.maxFiles = parseNonNegativeInt(next(), arg);
        break;
      case '--max-file-bytes':
        result.maxFileBytes = parsePositiveInt(next(), arg);
        break;
      case '--max-nodes':
        result.maxNodes = parsePositiveInt(next(), arg);
        break;
      case '--max-edges':
        result.maxEdges = parsePositiveInt(next(), arg);
        break;
      case '--max-depth':
        result.maxDepth = parseNonNegativeInt(next(), arg);
        break;
      case '--no-tests':
        result.includeTests = false;
        break;
      case '--help':
      case '-h':
        result.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return result;
}

function parseMode(value: string): ImpactMode {
  if (value === 'references' || value === 'call' || value === 'api-flow' || value === 'patch-impact') return value;
  throw new Error(`Invalid --mode ${value}. Use references, call, api-flow, or patch-impact.`);
}

function parsePositiveInt(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${flag} must be a positive integer.`);
  return parsed;
}

function parseNonNegativeInt(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`${flag} must be 0 or a positive integer.`);
  return parsed;
}

function printHelp(): void {
  console.log(`Ext Graph Java impact graph prototype

Usage:
  ext-graph --root <workspace> --target <Class|Class.method|field> [options]

Options:
  --mode references|call|api-flow|patch-impact
  --out <graph.json>
  --html-out <graph.html>
  --max-files <n>       0 scans the full project up to the safety cap
  --max-file-bytes <n>
  --max-nodes <n>
  --max-edges <n>
  --max-depth <n>       0 traces full depth up to the safety cap
  --no-tests
`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
