# Java Impact Flow

Visualize Java field, method, callback, API-flow impact, and the tests most likely
to matter before you change code.

Java Impact Flow is a VS Code extension and headless CLI for exploring Java
change impact from inside the editor. Select a class, method, or field, choose a
mode, and inspect the result as an API sequence, references list, or impact map.

Repository name: `java-impact-flow`

## Status

This extension is an early preview. It scans source files locally with bounded
regex-based Java parsing. For production-grade precision, the data provider
should later be backed by JDT LS or another semantic Java index.

## What It Shows

- API flows for Spring MVC and Jakarta/JAX-RS controllers.
- A Static Debugger tab that lets you step through possible endpoint source
  paths without running the Java app.
- Field, method, class, and callback references with source lines.
- Impact map grouped by entrypoints, production files, tests, callbacks, and
  framework annotations.
- Suggested test files ranked from matching evidence.
- Runnable and copyable Gradle/Maven test commands when a build wrapper is detected.
- Exportable JSON and standalone HTML reports.
- A trust score that explains whether a static report is high, medium, or low
  confidence.
- A VS Code command that detects changed Java symbols from the current Git diff
  and opens a patch-impact report.
- Inline CodeLens impact counts on Java classes and methods.
- Opt-in Problems diagnostics for low-confidence unresolved flow steps.
- A patch risk gate for changed Java code with pass/warn/fail, impacted
  endpoints, suggested tests, trust, and unresolved-call risk.
- "Why this test?" explanations and copyable PR impact summaries.
- A validation pack runner that checks expected endpoints, suggested tests,
  trust score, and unresolved-call thresholds against Java sample workspaces.
- A CI-friendly patch risk CLI that writes Markdown/JSON and returns a failing
  exit code when the configured risk threshold is crossed.
- A `Java Impact Flow` sidebar with patch risk, scan time, cache hit/miss,
  trust, unresolved calls, endpoints, and suggested tests.
- A performance benchmark gate that checks cold scan time, warm cache time,
  trust, unresolved calls, endpoint count, and suggested-test count.

## Requirements

- VS Code `^1.90.0`
- Node.js `>=20`
- Java source workspace
- PowerShell examples below use `npm.cmd` because Windows may block `npm.ps1`

## Quickstart

```powershell
cd <java-impact-flow-repo>
npm.cmd install
npm.cmd run build
npm.cmd test
```

Expected result: TypeScript builds successfully and Vitest reports all tests
passing.

## Run In VS Code

1. Open this repository in VS Code.
2. Run `npm.cmd install` once, then `npm.cmd run build`.
3. Press `F5` to start an Extension Development Host.
4. In the Extension Development Host, open a Java workspace, for example
   `<java-workspace>`.
5. Open a Java file, place the cursor on a class, method, or field, then run:
   `Java Impact Flow: Show Impact View`.
6. Pick a mode such as `api-flow` or `patch-impact`.
7. To inspect the current patch instead of typing a target, run:
   `Java Impact Flow: Analyze Current Changes`.
8. To get a commit/PR-oriented risk decision, run:
   `Java Impact Flow: Check Patch Risk`.
9. Open the `Java Impact Flow` Activity Bar item and refresh
   `Patch Risk Workbench` for a persistent sidebar view.
10. To step through a possible endpoint source path, run:
    `Java Impact Flow: Static Debug Endpoint`.

The webview opens beside the editor. Reference rows include an `Open` action
that jumps back to the source line. Suggested tests include `Run`, `Copy`, and
`Run Top 3` actions for commands such as:

```powershell
.\gradlew.bat :backend:test --tests "com.example.controllers.OrderControllerTest"
```

## CLI

The CLI uses the same analyzer and renderer as the VS Code webview.

```powershell
node dist/cli.js --root <java-workspace> --target OrderService --mode patch-impact --max-files 0 --max-depth 0 --out outputs\order-service-patch-impact.json --html-out outputs\order-service-patch-impact.html
```

After packaging or linking the binary, the equivalent command is:

```powershell
java-impact-flow --root <java-workspace> --target OrderService --mode patch-impact --max-files 0 --max-depth 0 --out .ext-graph\OrderService.impact.json --html-out .ext-graph\OrderService.impact.html
```

### CI Patch Risk Gate

Use `risk` to turn the VS Code patch-risk workflow into a terminal gate. It
reads changed Java files from Git status and diff, builds patch-impact graphs,
then writes a PR-ready Markdown summary.

```powershell
java-impact-flow risk --root <java-workspace> --changed --fail-on fail --out .ext-graph\risk.md --json-out .ext-graph\risk.json
```

`--fail-on fail` exits non-zero only for `FAIL`. Use `--fail-on warn` when a
medium-trust or unresolved-call report should also block CI. Use
`--fail-on never` to collect advisory output without failing the job.

### Validation Pack

Use `validate` to run expected-output checks against Java sample workspaces. A
suite is a JSON file containing cases with a workspace root, target symbol, mode,
and expected endpoints/tests/trust thresholds.

```powershell
npm.cmd run build
node dist/cli.js validate --suite validation\java-impact-flow.validation.json --out outputs\validation-report.json --markdown-out outputs\validation-report.md
```

The bundled suite currently covers Spring MVC and Jakarta/JAX-RS fixtures. It
fails if an expected endpoint or suggested test disappears, if trust drops below
the configured threshold, or if unresolved calls exceed the allowed maximum.

### Performance Gate

Use `benchmark performance` to prove the analyzer stays fast enough for the
editor workflow. It runs the target once cold and once warm through the cache,
then fails the process when any configured threshold is crossed.

```powershell
npm.cmd run build
node dist/cli.js benchmark performance --root validation\fixtures\spring-orders --target OrderService.findOrders --mode patch-impact --cold-ms 500 --warm-ms 100 --min-trust-score 50 --max-unresolved-calls 2 --min-endpoints 1 --min-suggested-tests 1 --out outputs\performance-report.json
```

`coldMs` measures the first analyzer run in the current process. `warmMs`
measures a repeated request for the same target through the in-memory cache.

### CLI Options

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--root <path>` | yes | none | Java workspace root to scan. |
| `--target <symbol>` | yes | none | Class, method, field, or qualified symbol to inspect. |
| `--mode <mode>` | no | `references` | One of `references`, `call`, `api-flow`, or `patch-impact`. |
| `--out <file>` | no | none | Write graph JSON. |
| `--html-out <file>` | no | none | Write standalone HTML report. |
| `--max-files <n>` | no | `0` | Maximum Java files to scan. `0` scans the full project up to the `100000`-file safety cap. |
| `--max-file-bytes <n>` | no | `300000` | Skip Java files larger than this byte limit. |
| `--max-depth <n>` | no | `0` | Recursive endpoint/callback flow depth. `0` traces full depth up to the `20`-level safety cap. |
| `--no-tests` | no | tests included | Exclude test files from evidence. |

### Risk CLI Options

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--root <path>` | yes | none | Java workspace root and Git repository to inspect. |
| `--changed` | no | enabled | Accepted for readability; risk mode always reads changed Java files. |
| `--out <file>` | no | none | Write patch risk Markdown. |
| `--json-out <file>` | no | none | Write patch risk JSON. |
| `--fail-on <level>` | no | `fail` | One of `never`, `fail`, or `warn`. |
| `--max-targets <n>` | no | `12` | Maximum changed Java targets to analyze. |

### Validation CLI Options

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--suite <file>` | yes | none | Validation suite JSON. |
| `--out <file>` | no | none | Write validation result JSON. |
| `--markdown-out <file>` | no | none | Write validation scorecard Markdown. |

### Performance CLI Options

| Option | Required | Default | Description |
| --- | --- | --- | --- |
| `--root <path>` | yes | none | Java workspace root to scan. |
| `--target <symbol>` | yes | none | Class, method, field, or qualified symbol to benchmark. |
| `--mode <mode>` | no | `patch-impact` | One of `references`, `call`, `api-flow`, or `patch-impact`. |
| `--out <file>` | no | none | Write performance benchmark JSON. |
| `--cold-ms <n>` | no | none | Fail if the cold run is slower than this threshold. |
| `--warm-ms <n>` | no | none | Fail if the warm cache run is slower than this threshold. |
| `--min-trust-score <n>` | no | none | Fail if trust score is lower than this threshold. |
| `--max-unresolved-calls <n>` | no | none | Fail if unresolved calls exceed this threshold. |
| `--min-endpoints <n>` | no | none | Fail if fewer endpoints are detected. |
| `--min-suggested-tests <n>` | no | none | Fail if fewer suggested tests are detected. |

## Modes

| Mode | Use When | Primary View |
| --- | --- | --- |
| `references` | You need definitions, reads, writes, and usage evidence. | References |
| `call` | You are focused on caller-like method edges. | Graph |
| `api-flow` | The target is a controller/resource or endpoint-related class. | Sequence |
| `patch-impact` | You want a blast-radius view before editing a symbol. | Map + Suggested Tests |

`Java Impact Flow: Analyze Current Changes` uses Git status and diff hunks to
infer changed Java classes or methods, then opens `patch-impact` for the selected
changed symbol.

The Static Debugger tab turns endpoint flow evidence into a debugger-style
timeline. It supports next/previous step controls, source jumps, confidence
labels, per-step "Why" explanations, and copyable trace text. It is intentionally
static: it shows possible source flow, not one measured runtime scenario.

Inline CodeLens entries are shown on Java class and method declarations with
counts such as `Impact: 3 endpoints | 7 tests | 12 refs`. Clicking the CodeLens
opens the corresponding patch-impact view.

The `Java Impact Flow` sidebar shows the same patch-risk signal as a native
Tree View. It displays `Patch Risk`, scan time, Java files scanned, cache
hit/miss count, trust score, unresolved calls, changed targets, impacted
endpoints, suggested tests, and risk reasons. Title actions refresh the
workbench, open the full risk report, copy the PR summary, or run the top tests.

The Trust Score panel includes `Publish Diagnostics`, which adds low-confidence
unresolved call/callback steps to the VS Code Problems panel on demand.

`Java Impact Flow: Check Patch Risk` produces a pass/warn/fail report for the
current Git patch. It includes changed targets, impacted endpoints, top tests,
why each test was suggested, unresolved calls, and a copyable PR summary.

## Configuration

These settings are available under `Java Impact Flow` in VS Code settings.

| Setting | Default | Description |
| --- | --- | --- |
| `extGraph.maxFiles` | `0` | Maximum Java files scanned by the static fallback analyzer. `0` scans the full project up to the `100000`-file safety cap. |
| `extGraph.maxFileBytes` | `300000` | Maximum bytes read from a single Java file. |
| `extGraph.includeTests` | `true` | Include Java test files as impact evidence. |
| `extGraph.maxDepth` | `0` | Maximum recursive method/callback depth for endpoint flow traces. `0` traces full depth up to the `20`-level safety cap. |
| `extGraph.enableCodeLens` | `true` | Show inline Java Impact Flow CodeLens entries on Java classes and methods. |
| `extGraph.codeLensMaxSymbols` | `6` | Maximum Java classes or methods per file that receive impact-count CodeLens entries. |

The setting prefix remains `extGraph` for compatibility with the current
prototype command IDs.

## Java Support

The static fallback analyzer currently recognizes:

- Spring MVC endpoints: `@RestController`, `@Controller`, `@RequestMapping`,
  `@GetMapping`, `@PostMapping`, `@PutMapping`, `@DeleteMapping`,
  `@PatchMapping`, and `@RequestParam`.
- Jakarta/JAX-RS endpoints: `@Path`, `@GET`, `@POST`, `@PUT`, `@DELETE`,
  `@PATCH`, `@HEAD`, `@OPTIONS`, and `@PathParam`.
- Common framework annotations as evidence, including `@Service`,
  `@Repository`, `@Component`, `@Bean`, `@Autowired`, `@Inject`, `@Named`,
  `@ApplicationScoped`, `@RequestScoped`, `@Singleton`, `@Entity`,
  `@Transactional`, `@Scheduled`, `@EventListener`, `@KafkaListener`,
  `@RabbitListener`, and `@MessageDriven`.
- Lambda and method-reference callbacks such as `user -> ...` and
  `this::method`.
- Gradle and Maven wrapper detection for suggested test commands.

## Verified Smoke Run

The current smoke report was generated with:

```powershell
node dist/cli.js --root <java-workspace> --target OrderService --mode patch-impact --max-files 0 --max-depth 0 --out outputs\order-service-patch-impact.json --html-out outputs\order-service-patch-impact.html
```

Observed output from that run:

- `531` Java files scanned
- `285` evidence rows
- `160` graph nodes
- `250` graph edges
- `2` API flows
- `41` test evidence hits

## Development

```powershell
npm.cmd install
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run validate:sample
npm.cmd run benchmark:performance
```

Useful files:

- `src/extension.ts` - VS Code command and webview bridge.
- `src/impactGraph.ts` - static Java analyzer and graph schema.
- `src/render.ts` - standalone HTML/webview renderer.
- `src/cli.ts` - headless CLI entrypoint.
- `src/impactCache.ts` - in-memory impact graph cache.
- `src/performance.ts` - cold/warm analyzer performance benchmark gate.
- `src/riskReport.ts` - pass/warn/fail patch risk report logic.
- `src/riskWorkbench.ts` - native VS Code sidebar Tree View provider.
- `src/staticDebugger.ts` - debugger-style static endpoint flow sessions.
- `src/validation.ts` - expected-output validation suite runner.
- `validation/java-impact-flow.validation.json` - bundled Java validation suite.
- `tests/impactGraph.test.ts` - analyzer and renderer coverage.

## Release Checklist

For maintainers preparing a Marketplace release:

- Add an icon and screenshots for the Marketplace page.
- Decide whether to rename command IDs from `extGraph.*` to
  `javaImpactFlow.*`; keep the old IDs as aliases if existing users matter.
- Package locally with `vsce package` and test the generated `.vsix`.
- Run `npm.cmd run validate:sample` and inspect the generated Markdown
  scorecard before publishing behavior claims.
- Confirm the README screenshots and examples match the packaged extension.

## Troubleshooting

### The command does not appear in VS Code

Cause: the extension was not built or the Extension Development Host is not
running the current workspace.

Fix:

```powershell
npm.cmd run build
```

Then restart the Extension Development Host with `F5`.

### The graph is sparse

Cause: the target may be too broad, too generic, or outside the scanned file
limit.

Fix: try a more specific target such as `ClassName.methodName`, keep
`extGraph.maxFiles` at `0` for full-project scan, or include tests if they were
disabled.

### API flow misses a call

Cause: the current analyzer is static and regex-based. It does not fully resolve
overloads, dependency injection, reflection, generated code, or framework
proxies.

Fix: use the References and Graph tabs as supporting evidence, then validate the
source manually. Future production precision should come from JDT LS or an
indexed semantic graph.

## License

MIT
