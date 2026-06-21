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

Print your currently installed CLI version:

```powershell
java-impact-flow --version
```

Show command-specific help:

```powershell
java-impact-flow help risk
java-impact-flow --help validate
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

### Release Commands

Use `release` for machine-safe publish gates:

```powershell
java-impact-flow release check --json --contract .ext-graph\release-check.json
java-impact-flow release ci --json --contract .ext-graph\release-check-ci.json
java-impact-flow release publish --allow-existing --skip-duplicate --json
java-impact-flow release publish --dry-run --skip-duplicate --json --contract .ext-graph\release-dry-run.json
```

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
| `--target <symbol>` | yes | none | Class, method, field, or qualified symbol to inspect. Alias: `--symbol`. |
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
| `--markdown-out <file>` | no | none | Write validation scorecard Markdown. Alias: `--md-out`. |

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
npm.cmd run release:verify
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
- Run `npm.cmd run release:check` to validate version/manifest consistency and
  Marketplace version safety before publishing.
- Run `npm.cmd run release:check:ci` to validate both Marketplace state (without
  querying latest versions) and VSIX smoke checks in machine-readable form.
- For CI pipelines, pass `--json` to get machine-readable output:
  `{"ok":true,...}` when checks pass, and `{"ok":false,"error":"..."}` when
  blocked (including missing `.vsix` or duplicate version errors). A blocked check
  returns a non-zero exit code.
- Write a single release contract with `--contract <path>` to persist the exact JSON
  payload emitted by `--json`. It now includes `packageHash` (SHA-256) for
  immutable artifact audit across CI and human approvals.
- Run `npm.cmd run release:verify` for the full local release gate:
  lint/tests/build/validation/performance/package + VSIX smoke check.
- `VSIX_SMOKE_REPORT` can be set to capture smoke check JSON output
  (`npm.cmd run smoke:vsix -- --json --report path.json`), which CI uses
  as an artifact.
- `VSIX_SMOKE_MAX_SIZE_BYTES` (or `--max-size`) controls the smoke check package
  size limit; by default this is 20MB. CI currently enforces 10MB.
- `VSIX_SMOKE_MAX_ENTRIES` (or `--max-entries`) controls the maximum
  number of entries in `.vsix`; by default this is 120. CI currently enforces 120.
- Run `npm.cmd run smoke:vsix` to validate the packaged artifact files and confirm
  no forbidden source directories leak into the `.vsix`.
- Run `npm.cmd run validate:sample` and inspect the generated Markdown
  scorecard before publishing behavior claims.
- Confirm the README screenshots and examples match the packaged extension.

Recommended shortcuts:

- `npm.cmd run release:check:json`: validate package existence and marketplace state
  in machine-readable form.
- `npm.cmd run release:check:ci`: same as above but skip marketplace lookup for CI speed.
- `npm.cmd run release:publish:json`: same as `release:publish`, with JSON output.
- `npm.cmd run release:publish:dry-run`: full release verification + publish-mode
  validation without sending to Marketplace.

### CI Example

Use this pattern for release gates in GitHub Actions. The publish job reads the
hash from `release-check` output and passes it explicitly with
`--expected-package-hash` so the package is verified before publish:

```yaml
name: Release Health

on:
  pull_request:
    branches:
      - main
  workflow_dispatch:
    inputs:
      run_publish:
        description: "Run actual Marketplace publish (requires VSCE_PAT)"
        required: false
        default: false
        type: boolean
      allow_existing:
        description: "Allow republish when version already exists"
        required: false
        default: false
        type: boolean
      skip_duplicate:
        description: "Pass --skip-duplicate to vsce publish"
        required: false
        default: true
        type: boolean

jobs:
  release-check:
    name: Release Check
    runs-on: ubuntu-latest
    outputs:
      package_hash: ${{ steps.release-check-contract.outputs.package_hash }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - run: npm run release:verify
      - name: Check release JSON contract
        id: release-check-contract
        env:
          RELEASE_CHECK_JSON: release-check.json
        run: |
          set -o pipefail
          if ! npm run release:check:ci -- --contract "$RELEASE_CHECK_JSON"; then
            echo "release:check failed";
            exit 1;
          fi
          node - <<'NODE'
            const fs = require('fs');
            const raw = fs.readFileSync(process.env.RELEASE_CHECK_JSON, 'utf8').trim();
            if (!raw) {
              throw new Error('release check contract is empty');
            }
            const payload = JSON.parse(raw);
            if (payload.ok !== true) {
              throw new Error(payload.error ?? 'release:check failed');
            }
            if (!payload.smokeCheck || payload.smokeCheck.ok !== true) {
              throw new Error(`release check smoke gate failed for ${payload.packagePath}`);
            }
            if (!payload.packageHash) {
              throw new Error('release:check contract is missing packageHash');
            }
            console.log(`release:check ok for ${payload.manifest.name}@${payload.manifest.version} (${payload.packageHash})`);
            const outputFile = process.env.GITHUB_OUTPUT;
            if (outputFile) {
              fs.appendFileSync(outputFile, `package_hash=${payload.packageHash}\n`);
            }
          NODE
      - name: Upload release check contract
        uses: actions/upload-artifact@v4
        with:
          name: release-check-contract
          path: release-check.json
          if-no-files-found: error

  release-publish:
    name: Publish to Marketplace
    if: github.event_name == 'workflow_dispatch' && github.event.inputs.run_publish == true
    runs-on: ubuntu-latest
    needs: release-check
    env:
      VSCE_PAT: ${{ secrets.VSCE_PAT }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "20"
          cache: "npm"
      - run: npm ci
      - name: Guard and publish
        env:
          RELEASE_PUBLISH_JSON: release-publish.json
          RELEASE_EXPECTED_PACKAGE_HASH: ${{ needs.release-check.outputs.package_hash }}
        run: |
          set -o pipefail
          if [ -z "$VSCE_PAT" ]; then
            echo "VSCE_PAT secret is required for publish";
            exit 1;
          fi
          PUBLISH_ARGS="--json"
          if [ "${{ github.event.inputs.allow_existing }}" = "true" ] || [ "${{ github.event.inputs.allow_existing }}" = "True" ]; then
            PUBLISH_ARGS="$PUBLISH_ARGS --allow-existing";
          fi
          if [ "${{ github.event.inputs.skip_duplicate }}" != "false" ] && [ "${{ github.event.inputs.skip_duplicate }}" != "False" ]; then
            PUBLISH_ARGS="$PUBLISH_ARGS --skip-duplicate";
          fi
          if [ -n "$RELEASE_EXPECTED_PACKAGE_HASH" ]; then
            PUBLISH_ARGS="$PUBLISH_ARGS --expected-package-hash $RELEASE_EXPECTED_PACKAGE_HASH"
          fi
          PUBLISH_ARGS="$PUBLISH_ARGS --smoke --contract $RELEASE_PUBLISH_JSON"

          if ! npm run release:publish:json -- $PUBLISH_ARGS; then
            echo "release:publish failed";
            exit 1;
          fi
          node - <<'NODE'
            const fs = require('fs');
            const raw = fs.readFileSync(process.env.RELEASE_PUBLISH_JSON, 'utf8').trim();
            if (!raw) {
              throw new Error('release publish contract is empty');
            }
            const payload = JSON.parse(raw);
            if (payload.ok !== true) {
              throw new Error(payload.error ?? 'release:publish failed');
            }
            if (!payload.smokeCheck || payload.smokeCheck.ok !== true) {
              throw new Error(`release publish smoke gate failed for ${payload.packagePath}`);
            }
            if (payload.published !== true) {
              throw new Error('release:publish did not execute publish step');
            }
            if (payload.packageHash) {
              console.log(`release:publish succeeded for ${payload.manifest.name}@${payload.manifest.version} (${payload.packageHash})`);
            } else {
              console.log(`release:publish succeeded for ${payload.manifest.name}@${payload.manifest.version}`);
            }
          NODE
      - name: Upload release publish contract
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: release-publish-contract
          path: release-publish.json
          if-no-files-found: error
```

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
