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
should later be backed by JDT LS, CodeGraph indexed facts, or another semantic
Java index.

## What It Shows

- API flows for Spring MVC and Jakarta/JAX-RS controllers.
- Field, method, class, and callback references with source lines.
- Impact map grouped by entrypoints, production files, tests, callbacks, and
  framework annotations.
- Suggested test files ranked from matching evidence.
- Copyable Gradle/Maven test commands when a build wrapper is detected.
- Exportable JSON and standalone HTML reports.

## Requirements

- VS Code `^1.90.0`
- Node.js `>=20`
- Java source workspace
- PowerShell examples below use `npm.cmd` because Windows may block `npm.ps1`

## Quickstart

```powershell
cd D:\Personal\Projects\ext-graph
npm.cmd install
npm.cmd run build
npm.cmd test
```

Expected result: TypeScript builds successfully and Vitest reports all tests
passing.

## Run In VS Code

1. Open `D:\Personal\Projects\ext-graph` in VS Code.
2. Run `npm.cmd install` once, then `npm.cmd run build`.
3. Press `F5` to start an Extension Development Host.
4. In the Extension Development Host, open a Java workspace, for example
   `D:\Personal\Projects\doughnut`.
5. Open a Java file, place the cursor on a class, method, or field, then run:
   `Java Impact Flow: Show Impact View`.
6. Pick a mode such as `api-flow` or `patch-impact`.

The webview opens beside the editor. Reference rows include an `Open` action
that jumps back to the source line. Suggested tests include a copyable command
such as:

```powershell
.\gradlew.bat :backend:test --tests "com.odde.doughnut.controllers.NotebookSharingGroupControllerTest"
```

## CLI

The CLI uses the same analyzer and renderer as the VS Code webview.

```powershell
node dist/cli.js --root D:\Personal\Projects\doughnut --target BazaarNotebook --mode patch-impact --max-files 0 --max-depth 0 --out outputs\ui-bazaarnotebook-patch-impact.json --html-out outputs\ui-bazaarnotebook-patch-impact.html
```

After packaging or linking the binary, the equivalent command is:

```powershell
java-impact-flow --root D:\Personal\Projects\doughnut --target BazaarNotebook --mode patch-impact --max-files 0 --max-depth 0 --out .ext-graph\BazaarNotebook.impact.json --html-out .ext-graph\BazaarNotebook.impact.html
```

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

## Modes

| Mode | Use When | Primary View |
| --- | --- | --- |
| `references` | You need definitions, reads, writes, and usage evidence. | References |
| `call` | You are focused on caller-like method edges. | Graph |
| `api-flow` | The target is a controller/resource or endpoint-related class. | Sequence |
| `patch-impact` | You want a blast-radius view before editing a symbol. | Map + Suggested Tests |

## Configuration

These settings are available under `Java Impact Flow` in VS Code settings.

| Setting | Default | Description |
| --- | --- | --- |
| `extGraph.maxFiles` | `0` | Maximum Java files scanned by the static fallback analyzer. `0` scans the full project up to the `100000`-file safety cap. |
| `extGraph.maxFileBytes` | `300000` | Maximum bytes read from a single Java file. |
| `extGraph.includeTests` | `true` | Include Java test files as impact evidence. |
| `extGraph.maxDepth` | `0` | Maximum recursive method/callback depth for endpoint flow traces. `0` traces full depth up to the `20`-level safety cap. |

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
node dist/cli.js --root D:\Personal\Projects\doughnut --target BazaarNotebook --mode patch-impact --max-files 0 --max-depth 0 --out outputs\ui-bazaarnotebook-patch-impact.json --html-out outputs\ui-bazaarnotebook-patch-impact.html
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
```

Useful files:

- `src/extension.ts` - VS Code command and webview bridge.
- `src/impactGraph.ts` - static Java analyzer and graph schema.
- `src/render.ts` - standalone HTML/webview renderer.
- `src/cli.ts` - headless CLI entrypoint.
- `tests/impactGraph.test.ts` - analyzer and renderer coverage.

## Release Checklist

For maintainers preparing a Marketplace release:

- Add an icon and screenshots for the Marketplace page.
- Decide whether to rename command IDs from `extGraph.*` to
  `javaImpactFlow.*`; keep the old IDs as aliases if existing users matter.
- Package locally with `vsce package` and test the generated `.vsix`.
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
