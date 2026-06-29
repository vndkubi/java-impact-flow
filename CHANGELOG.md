# Change Log

## 0.1.14 - 2026-06-29

- **A1 — AST local variable type inference**: `javaAstParser` now extracts all local
  variable declarations (`localVars`) with their declared types and, for `var` declarations,
  infers the concrete type from the `new` expression (e.g. `var svc = new OrderServiceImpl()`
  → type `OrderServiceImpl`). Multi-declarator lines (`Type a = …, b = …`) are handled
  correctly; `var` without a `new` expression emits no entry (no false inference).
- **A3 — AST-only field merging**: fields found by the AST that were missed by the
  line-by-line regex parser (e.g. multi-line declarations) are now added to the field index,
  enabling receiver type resolution for those fields in flow tracing.
- **AST field line numbers**: `AstField` now carries an optional `line` property (extracted
  from the variable declarator token) so AST-only fields can be registered as proper
  `JavaSymbol` entries with accurate source positions.
- **8 new tests** across two `describe` blocks proving: explicit type extraction, `var`+`new`
  inference, generic stripping (`List<Order>` → `List`), multi-declarator extraction, no
  false-positive for uninferable `var`, and end-to-end CDI/Jakarta EE call resolution.

## 0.1.13 - 2026-06-29

- Replaced static-regex Java parsing backbone with a proper AST engine (`java-parser`,
  Chevrotain-based) that understands the full Java grammar.
- Call extraction now correctly handles chained stream/fluent calls (`repo.findAll().stream().filter()`),
  avoids false positives from string literals, and tracks direct receivers for chained expressions.
- Field type resolution is enriched from the AST (correctly strips generics: `List<Order>` → `List`)
  enabling more resolved call targets for injected field receivers.
- AST parser is bundled inline via esbuild (220 KB minified, no external runtime dependencies)
  and falls back to the existing regex analyzer if parsing fails, so every file is still analyzed.
- Added 10 accuracy-coverage tests that prove AST detects chained calls the regex misses and
  emits no false-positive calls from string literal content.

## 0.1.12 - 2026-06-27

- Added a Command Palette (`Ctrl`/`Cmd`+`P`, also `Ctrl`/`Cmd`+`K` or `/`) with
  fuzzy search to jump to any flow, file, suggested test, reference, or graph
  node.
- Added a graph minimap (shown for graphs with 12+ nodes) with a live viewport
  box and click-to-recenter.
- Switched raw-graph edges from straight lines to curved Bezier paths to reduce
  visual overlap.
- Froze the participant header row at the top of the sequence diagram while
  scrolling vertically; it still pans horizontally so lifelines stay aligned,
  and hides when scrolled back to the top.

## 0.1.11 - 2026-06-27

- Reworked the sequence diagram into a proper UML view: combined fragments
  (`alt`/`opt`/`loop`/`try`) framed around branch, loop, and exception steps,
  activation bars on target lifelines, and dashed lines for low-confidence
  (<50%) steps.
- Made the sequence and empty-state SVG theme-aware by replacing hard-coded
  dark hex colors with CSS-variable-driven classes, and switched the webview to
  `color-scheme: light dark` so light VS Code themes render correctly.
- Added Ctrl/Cmd + scroll zoom to the sequence canvas.
- Replaced the concentric raw-graph layout with a layered (BFS-distance)
  layout that uses barycenter ordering to reduce edge crossings.
- Added pan, wheel-zoom, and node drag to the impact graph, plus hover-to-focus
  dimming that highlights a node and its direct neighbors.
- Added SVG and PNG export for both the sequence and impact graph views.
- Added collapsible sidebar and inspector panels to give the diagram more room.
- Extended render regression coverage to assert all of the above markers.

## 0.1.10 - 2026-06-22

- Expanded the Sequence tab into a focused layout by hiding the right inspector
  while the sequence diagram is active.
- Auto-fits sequence diagrams after render and resize so the initial view is
  visible without manual zoom in/out.
- Added regression coverage for the focused sequence layout and missing runtime
  helpers used by suggested-test rendering.

## 0.1.9 - 2026-06-22

- Fixed API-flow and Static Debug behavior when the selected target is a
  top-level JUnit test class instead of a production controller or service.
- Traces from related test methods into downstream controller/service calls so
  endpoint sequence diagrams are no longer replaced by the empty no-flow state.
- Added regression coverage for nested JUnit tests calling controller endpoints.

## 0.1.8 - 2026-06-22

- Improved API-flow traversal across injected service and client layers instead
  of stopping at the first controller-to-service hop.
- Resolved interface-typed injected receivers to a unique implementation method
  when static source evidence is unambiguous.
- Tightened method body scanning with brace-aware ranges so interface or
  downstream declarations are not misread as calls from the previous method.
- Added regression coverage for controller -> service -> service -> interface
  client -> concrete client flow traces.

## 0.1.7 - 2026-06-22

- Fixed the API sequence webview script syntax so sequence diagrams render
  reliably instead of failing before initialization.
- Added pointer drag/pan support to the sequence diagram canvas while preserving
  click-to-select behavior for real flow messages.
- Added regression coverage for generated webview script syntax and sequence
  drag/pan wiring.

## 0.1.6 - 2026-06-22

- Fixed API-flow generation for targets in middle service/policy layers by
  finding upstream endpoint handlers through resolved reverse call chains.
- Added regression coverage for controller-to-service-to-policy call paths so
  middle-layer methods still generate endpoint sequence output.

## 0.1.5 - 2026-06-22

- Updated API-flow sequence participants to model class-layer actors instead of
  method-level participants.
- Kept unresolved local calls, lambdas, and method references on the calling
  class participant when no target class can be resolved.
- Added regression coverage for unresolved local call and callback sequence
  rendering.

## 0.1.4 - 2026-06-22

- Published as next release with sequence UI readability upgrades for
  API-flow tracing, including clearer directional route labels and route
  confidence cues.

- Updated webview sequence hint summary and transition metadata exposure for more
  reliable interpretation during impact analysis.

## 0.1.3 - 2026-06-22

- Improved API sequence UI readability with clearer directional call annotations,
  confidence-aware transition emphasis, and a sequence helper hint bar.
- Added route-focused labels and hover tooltips for sequence transitions to
  reduce ambiguity when tracing API flow.
- Added compact sequence summary in the webview for easier flow interpretation.

## 0.1.2 - 2026-06-21

- Added a validation pack runner for expected endpoint, suggested-test, trust,
  and unresolved-call checks against Java sample workspaces.
- Added `java-impact-flow validate` for JSON and Markdown validation scorecards.
- Added `java-impact-flow risk` for CI-friendly patch risk reports with
  pass/warn/fail exit-code behavior.
- Added a native `Java Impact Flow` sidebar with patch risk, scan time, cache
  hit/miss, trust, unresolved calls, endpoints, and suggested tests.
- Added in-memory analyzer caching for repeated editor and CLI analysis.
- Added `java-impact-flow benchmark performance` for cold/warm performance and
  quality threshold gates.
- Added a Static Debugger webview tab and command for stepping through possible
  endpoint source paths with per-step explanations, confidence, source jumps,
  and copyable traces.

## 0.1.0

- Initial Java Impact Flow extension.
- Added impact views for Java references, calls, API flows, and patch impact.
- Added Sequence, References, and Graph tabs in the VS Code webview.
- Added suggested test files with copyable Gradle/Maven test commands.
- Added CLI JSON/HTML report generation.
- Added trust score metadata and a webview trust panel for static-analysis confidence.
- Added `Java Impact Flow: Analyze Current Changes` to infer changed Java symbols from Git diff and open patch impact.
- Added inline CodeLens impact counts for Java classes and methods.
- Added `Run`, `Run Top 3`, and `Copy` actions for suggested test commands.
- Added opt-in Problems diagnostics for low-confidence unresolved flow steps.
- Added `Java Impact Flow: Check Patch Risk` with pass/warn/fail patch reports.
- Added suggested-test explanations and copyable PR impact summaries.
