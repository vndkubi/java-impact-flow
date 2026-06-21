import { describe, expect, it, vi } from 'vitest';
import {
  runReleaseCommand,
  getVersion,
  resolveCliRoute,
  parseCommonArg,
  parseFailOn,
  parseImpactArgs,
  parseMode,
  parseNonNegativeInt,
  parseNonNegativeNumber,
  parsePositiveInt,
  parsePerformanceArgs,
  parseRiskArgs,
  parseValidateArgs,
} from '../src/cli.js';

describe('CLI argument parsing', () => {
  it('parses impact arguments with aliases and explicit flags', () => {
    const args = parseImpactArgs([
      '--root',
      '/repo',
      '--symbol',
      'OrderService.findOrders',
      '--mode',
      'api-flow',
      '--out',
      'graph.json',
      '--html-out',
      'graph.html',
      '--max-files',
      '20',
      '--max-nodes',
      '1200',
      '--max-edges',
      '3000',
      '--max-depth',
      '4',
      '--max-file-bytes',
      '1234',
      '--no-tests',
    ]);

    expect(args.root).toBe('/repo');
    expect(args.target).toBe('OrderService.findOrders');
    expect(args.mode).toBe('api-flow');
    expect(args.out).toBe('graph.json');
    expect(args.htmlOut).toBe('graph.html');
    expect(args.maxFiles).toBe(20);
    expect(args.maxNodes).toBe(1200);
    expect(args.maxEdges).toBe(3000);
    expect(args.maxDepth).toBe(4);
    expect(args.maxFileBytes).toBe(1234);
    expect(args.includeTests).toBe(false);
  });

  it('requires values for impact flags that expect values', () => {
    expect(() => parseImpactArgs(['--root'])).toThrow('Missing value after --root');
    expect(() => parseImpactArgs(['--mode', 'unknown'])).toThrow('Invalid --mode unknown. Use references, call, api-flow, or patch-impact.');
  });

  it('parses risk arguments including changed flag and max target override', () => {
    const args = parseRiskArgs([
      '--root',
      '/repo',
      '--changed',
      '--max-targets',
      '7',
      '--fail-on',
      'warn',
      '--json-out',
      'risk.json',
      '--no-tests',
    ]);

    expect(args.root).toBe('/repo');
    expect(args.maxTargets).toBe(7);
    expect(args.failOn).toBe('warn');
    expect(args.jsonOut).toBe('risk.json');
    expect(args.includeTests).toBe(false);
  });

  it('parses validation aliases and output fields', () => {
    const args = parseValidateArgs([
      '--suite',
      'validation.json',
      '--out',
      'validation-result.json',
      '--md-out',
      'validation.md',
      '--no-tests',
    ]);

    expect(args.suite).toBe('validation.json');
    expect(args.out).toBe('validation-result.json');
    expect(args.markdownOut).toBe('validation.md');
    expect(args.includeTests).toBe(false);
  });

  it('parses performance command arguments and numeric constraints', () => {
    const args = parsePerformanceArgs([
      '--root',
      '/repo',
      '--target',
      'TargetMethod',
      '--mode',
      'references',
      '--cold-ms',
      '1.5',
      '--min-suggested-tests',
      '3',
      '--min-endpoints',
      '2',
      '--max-unresolved-calls',
      '0',
      '--warm-ms',
      '2.2',
    ]);

    expect(args.root).toBe('/repo');
    expect(args.target).toBe('TargetMethod');
    expect(args.mode).toBe('references');
    expect(args.coldMs).toBe(1.5);
    expect(args.warmMs).toBe(2.2);
    expect(args.minSuggestedTests).toBe(3);
    expect(args.minEndpoints).toBe(2);
    expect(args.maxUnresolvedCalls).toBe(0);
  });

  it('accepts --flag=value syntax and enforces no-value flags', () => {
    const impactArgs = parseImpactArgs([
      '--root=.',
      '--symbol=OrderService.findOrders',
      '--mode=api-flow',
      '--out=/tmp/graph.json',
      '--max-depth=5',
      '--max-files=9',
    ]);
    expect(impactArgs.root).toBe('.');
    expect(impactArgs.target).toBe('OrderService.findOrders');
    expect(impactArgs.mode).toBe('api-flow');
    expect(impactArgs.out).toBe('/tmp/graph.json');
    expect(impactArgs.maxDepth).toBe(5);
    expect(impactArgs.maxFiles).toBe(9);

    const validationArgs = parseValidateArgs([
      '--suite=validation.json',
      '--out=validation-result.json',
      '--md-out=validation.md',
    ]);
    expect(validationArgs.suite).toBe('validation.json');
    expect(validationArgs.out).toBe('validation-result.json');
    expect(validationArgs.markdownOut).toBe('validation.md');

    const performanceArgs = parsePerformanceArgs([
      '--root=.',
      '--target=OrderService.findOrders',
      '--cold-ms=1.5',
      '--min-endpoints=3',
      '--min-suggested-tests=2',
    ]);
    expect(performanceArgs.root).toBe('.');
    expect(performanceArgs.target).toBe('OrderService.findOrders');
    expect(performanceArgs.coldMs).toBe(1.5);
    expect(performanceArgs.minEndpoints).toBe(3);
    expect(performanceArgs.minSuggestedTests).toBe(2);

    expect(() => parseImpactArgs(['--help=true'])).toThrow('--help does not take a value.');
    expect(() => parseRiskArgs(['--no-tests=true'])).toThrow('--no-tests does not take a value.');
  });

  it('supports parser helper functions and catches malformed values', () => {
    const parsedMode = parseMode('call');
    expect(parsedMode).toBe('call');
    const parsedFailOn = parseFailOn('warn');
    expect(parsedFailOn).toBe('warn');
    expect(parsePositiveInt('3', '--max-nodes')).toBe(3);
    expect(parseNonNegativeInt('0', '--max-depth')).toBe(0);
    expect(parseNonNegativeNumber('12.5', '--cold-ms')).toBe(12.5);
    expect(parseCommonArg({}, '--max-files', () => '9')).toBe(true);
    const result: Record<string, unknown> = {};
    const next = vi.fn(() => 'should not be used');
    parseCommonArg(result, '--max-files', next, '9');
    expect(result.maxFiles).toBe(9);
    expect(next).not.toHaveBeenCalled();
    expect(() => parseCommonArg({}, '--max-files', () => 'value', '')).toThrow('Missing value after --max-files');

    expect(() => parseMode('bogus')).toThrow('Invalid --mode bogus. Use references, call, api-flow, or patch-impact.');
    expect(() => parseFailOn('bad')).toThrow('Invalid --fail-on bad. Use never, fail, or warn.');
    expect(() => parsePositiveInt('0', '--max-nodes')).toThrow('--max-nodes must be a positive integer.');
    expect(() => parseNonNegativeInt('-1', '--max-depth')).toThrow('--max-depth must be 0 or a positive integer.');
    expect(() => parseNonNegativeNumber('-1', '--cold-ms')).toThrow('--cold-ms must be 0 or a positive number.');
    expect(parseCommonArg({}, '--unknown', () => 'value')).toBe(false);
    expect(() => parseImpactArgs(['--max-depth='])).toThrow('Missing value after --max-depth');
    expect(() => parsePerformanceArgs(['--cold-ms='])).toThrow('Missing value after --cold-ms');
  });

  it('routes top-level CLI commands deterministically', () => {
    expect(resolveCliRoute([])).toEqual({ command: 'impact', args: [], commandArgument: '' });
    expect(resolveCliRoute(['--help'])).toEqual({ command: 'help', args: [], commandArgument: '--help' });
    expect(resolveCliRoute(['-h'])).toEqual({ command: 'help', args: [], commandArgument: '-h' });
    expect(resolveCliRoute(['-v'])).toEqual({ command: 'version', args: [], commandArgument: '-v' });
    expect(resolveCliRoute(['--version'])).toEqual({ command: 'version', args: [], commandArgument: '--version' });
    expect(resolveCliRoute(['help', 'risk'])).toEqual({
      command: 'help',
      args: ['risk'],
      commandArgument: 'help',
      helpTopic: 'risk',
    });
    expect(resolveCliRoute(['help', 'RISK']).helpTopic).toBe('risk');
    expect(resolveCliRoute(['--help', 'validate'])).toEqual({
      command: 'help',
      args: ['validate'],
      commandArgument: '--help',
      helpTopic: 'validate',
    });
    expect(resolveCliRoute(['benchmark', 'performance'])).toEqual({
      command: 'benchmark',
      args: ['performance'],
      commandArgument: 'benchmark',
    });
    expect(resolveCliRoute(['risk', '--root', 'workspace'])).toEqual({
      command: 'risk',
      args: ['--root', 'workspace'],
      commandArgument: 'risk',
    });
    expect(resolveCliRoute(['validate', '--suite', 'suite.json'])).toEqual({
      command: 'validate',
      args: ['--suite', 'suite.json'],
      commandArgument: 'validate',
    });
    expect(resolveCliRoute(['bad-command', '--foo'])).toEqual({
      command: 'unknown',
      args: ['--foo'],
      commandArgument: 'bad-command',
    });
    expect(resolveCliRoute(['--no-tests=true', '--target', 'A']).command).toBe('impact');
    expect(() => resolveCliRoute(['--version=true'])).toThrow('--version does not take a value.');
  });

  it('reads package version from manifest', () => {
    expect(getVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('routes release command to the dedicated release parser', () => {
    expect(resolveCliRoute(['release', 'check', '--json'])).toEqual({
      command: 'release',
      args: ['check', '--json'],
      commandArgument: 'release',
    });
    expect(resolveCliRoute(['release', '--skip-marketplace-check', '--json'])).toEqual({
      command: 'release',
      args: ['--skip-marketplace-check', '--json'],
      commandArgument: 'release',
    });
    expect(resolveCliRoute(['release', 'publish', '--skip-duplicate'])).toEqual({
      command: 'release',
      args: ['publish', '--skip-duplicate'],
      commandArgument: 'release',
    });
  });

  it('routes release check to guard executor', () => {
    const runGuard = vi.fn();
    runReleaseCommand(['check', '--json'], runGuard);
    expect(runGuard).toHaveBeenCalledWith(['--json']);
  });

  it('adds publish mode automatically for release publish', () => {
    const runGuard = vi.fn();
    runReleaseCommand(['publish', '--skip-duplicate'], runGuard);
    expect(runGuard).toHaveBeenCalledWith(['--publish', '--skip-duplicate']);
  });

  it('supports legacy positional flags for release check', () => {
    const runGuard = vi.fn();
    runReleaseCommand(['--skip-marketplace-check', '--json'], runGuard);
    expect(runGuard).toHaveBeenCalledWith(['--skip-marketplace-check', '--json']);
  });

  it('routes release ci shorthand to smoke+marketplace-lookup bypass', () => {
    const runGuard = vi.fn();
    runReleaseCommand(['ci', '--contract', 'release-check.json'], runGuard);
    expect(runGuard).toHaveBeenCalledWith([
      '--skip-marketplace-check',
      '--smoke',
      '--json',
      '--contract',
      'release-check.json',
    ]);
  });

  it('forwards dry-run to publish command', () => {
    const runGuard = vi.fn();
    runReleaseCommand(['publish', '--dry-run', '--json'], runGuard);
    expect(runGuard).toHaveBeenCalledWith(['--publish', '--dry-run', '--json']);
  });
});
