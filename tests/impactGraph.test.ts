import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import { buildImpactGraph } from '../src/impactGraph.js';
import type { ImpactGraph } from '../src/impactGraph.js';
import { renderImpactGraphHtml } from '../src/render.js';
import { TEST_COMMAND_BATCH_LIMIT } from '../src/testCommandRunner.js';
import { WEBVIEW_MESSAGE_TYPES } from '../src/webviewMessageSchema.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe('buildImpactGraph', () => {
  it('builds a compact graph with definitions, calls, tests, and endpoints', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-graph-'));
    roots.push(root);
    fs.writeFileSync(path.join(root, 'gradlew.bat'), '', 'utf-8');
    write(root, 'src/main/java/example/OrderController.java', `
package example;
import org.springframework.web.bind.annotation.GetMapping;
class OrderController {
  private final OrderService service = new OrderService();
  @GetMapping("/orders")
  String getOrders() {
    return service.findOrders();
  }
}
`);
    write(root, 'src/main/java/example/OrderService.java', `
package example;
class OrderService {
  String findOrders() {
    return "ok";
  }
}
`);
    write(root, 'src/test/java/example/OrderServiceTest.java', `
package example;
class OrderServiceTest {
  void testFindOrders() {
    new OrderService().findOrders();
  }
}
`);

    const graph = await buildImpactGraph({
      root,
      target: 'OrderService.findOrders',
      mode: 'api-flow',
      maxFiles: 0,
      maxDepth: 0,
    });

    expect(graph.summary.definitions).toBe(1);
    expect(graph.summary.callSites).toBeGreaterThanOrEqual(2);
    expect(graph.summary.tests).toBeGreaterThanOrEqual(1);
    expect(graph.summary.endpoints).toBeGreaterThanOrEqual(1);
    expect(graph.summary.flows).toBeGreaterThanOrEqual(1);
    expect(graph.metadata.fileLimit).toBe(100000);
    expect(graph.flows[0]?.maxDepth).toBe(20);
    expect(graph.metadata.buildSystem).toEqual({ tool: 'gradle', wrapper: 'gradlew.bat' });
    expect(graph.metadata.trust.level).toMatch(/high|medium|low/);
    expect(graph.metadata.trust.score).toBeGreaterThan(0);
    expect(graph.metadata.trust.reasons.join(' ')).toContain('Static regex analyzer');
    expect(graph.flows[0]?.mermaid).toContain('sequenceDiagram');
    expect(graph.nodes.some(node => node.kind === 'endpoint')).toBe(true);
    expect(graph.edges.some(edge => edge.kind === 'call')).toBe(true);
  });

  it('treats a controller class api-flow as all class endpoints', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-graph-'));
    roots.push(root);
    write(root, 'src/main/java/example/AdminUserController.java', `
package example;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
@RestController
@RequestMapping("/api/admin/users")
class AdminUserController {
  @GetMapping("")
  public UserListingPage listUsers(
      @RequestParam(defaultValue = "0") int pageIndex,
      @RequestParam(defaultValue = "10") int pageSize) {
    return new UserListingPage();
  }

  @PostMapping("/{id}/reset")
  public UserListingPage resetUser(
      @RequestParam(defaultValue = "false") boolean dryRun) {
    return new UserListingPage();
  }
}
class UserListingPage {}
`);

    const graph = await buildImpactGraph({
      root,
      target: 'AdminUserController',
      mode: 'api-flow',
      maxFiles: 50,
    });

    const endpoints = graph.nodes.filter(node => node.kind === 'endpoint');
    expect(graph.summary.endpoints).toBe(2);
    expect(graph.flows[0]?.mermaid).toContain('participant Client');
    expect(endpoints.map(node => node.label).sort()).toEqual([
      'GET /api/admin/users',
      'POST /api/admin/users/{id}/reset',
    ]);
    expect(graph.edges.filter(edge => edge.kind === 'endpoint_handler')).toHaveLength(2);

    const html = renderImpactGraphHtml(graph);
    expect(html).toContain('data-tab="sequence"');
    expect(html).toContain('data-tab="references"');
    expect(html).toContain('data-tab="graph"');
    expect(html).toContain('data-graph-scope="map"');
    expect(html).toContain('data-graph-scope="raw"');
    expect(html).toContain('graph-mode');
    expect(html).toContain('applyActiveTabLayout');
    expect(html).toContain('setActiveTab');
    expect(html).toContain('acquireVsCodeApi');
    expect(html).toContain(`type: WEBVIEW_MESSAGE_TYPES.${WEBVIEW_MESSAGE_TYPES.openLocation}`);
    expect(html).toContain('open-hint');
    expect(html).toContain('Suggested Tests');
    expect(html).toContain('Trust Score');
    expect(html).toContain('trust-card');
    expect(html).toContain('renderTrust');
    expect(html).toContain('Copy PR Summary');
    expect(html).toContain('impactPrSummaryMarkdown');
    expect(html).toContain(`type: WEBVIEW_MESSAGE_TYPES.${WEBVIEW_MESSAGE_TYPES.publishDiagnostics}`);
    expect(html).toContain('copy-test-command');
    expect(html).toContain('data-run-test-command');
    expect(html).toContain('<strong>Why:</strong>');
    expect(html).toContain(`type: WEBVIEW_MESSAGE_TYPES.${WEBVIEW_MESSAGE_TYPES.runTestCommand}`);
    expect(html).toContain('testCommandForFile');
    expect(html).toContain(`type: WEBVIEW_MESSAGE_TYPES.${WEBVIEW_MESSAGE_TYPES.copyText}`);
    expect(html).toContain('mapFilterBanner');
    expect(html).toContain('activeMapFilter');
    expect(html).toContain('References are filtered by this map group.');
    expect(html).toContain('References are filtered by this selection.');
    expect(html).toContain('Mermaid sequence');
    expect(html).toContain('sequenceDiagram');
  });

  it('uses sendWebviewMessage for extension-bound webview actions', () => {
    const baseGraph = baseRenderGraphFixture();
    const html = renderImpactGraphHtml({
      ...baseGraph,
      summary: {
        ...baseGraph.summary,
        flows: 1,
      },
    });

    const messageFnIndex = html.indexOf('function sendWebviewMessage');
    expect(messageFnIndex).toBeGreaterThan(0);
    expect(html).toContain('sendWebviewMessage({ type: WEBVIEW_MESSAGE_TYPES.copyText');
    expect(html).toContain('sendWebviewMessage({ type: WEBVIEW_MESSAGE_TYPES.runTestCommand');
    expect(html).toContain('sendWebviewMessage({ type: WEBVIEW_MESSAGE_TYPES.runTestCommands');
    expect(html).toContain('sendWebviewMessage({ type: WEBVIEW_MESSAGE_TYPES.openLocation');
    expect(html).toContain('sendWebviewMessage({ type: WEBVIEW_MESSAGE_TYPES.publishDiagnostics');

    expect(html.slice(0, messageFnIndex)).not.toContain('vscodeApi.postMessage');
    expect((html.match(/vscodeApi\.postMessage\(/g) || []).length).toBe(5);
  });

  it('validates webview action payloads inside sendWebviewMessage before posting', () => {
    const html = renderImpactGraphHtml(baseRenderGraphFixture());

    expect(html).toContain('if (type === WEBVIEW_MESSAGE_TYPES.copyText)');
    expect(html).toContain('if (typeof message.text !== \'string\') return false;');
    expect(html).toContain('if (type === WEBVIEW_MESSAGE_TYPES.runTestCommand)');
    expect(html).toContain('if (typeof message.command !== \'string\') return false;');
    expect(html).toContain('const command = message.command.trim();');
    expect(html).toContain('if (type === WEBVIEW_MESSAGE_TYPES.runTestCommands)');
    expect(html).toContain('const commands = collectNormalizedCommands(message.commands);');
    expect(html).toContain('if (!commands.length) return false;');
    expect(html).toContain('if (type === WEBVIEW_MESSAGE_TYPES.openLocation)');
    expect(html).toContain('if (typeof message.file !== \'string\' || !message.file.trim().length) return false;');
    expect(html).toContain('const rawLine = Number(message.line);');
    expect(html).toContain('if (type === WEBVIEW_MESSAGE_TYPES.publishDiagnostics)');
  });

  it('renders pointer drag pan support for the sequence diagram', () => {
    const html = renderImpactGraphHtml(baseRenderGraphFixture());

    expect(html).toContain('.sequence-scroller.dragging');
    expect(html).toContain('function bindSequencePan()');
    expect(html).toContain('sequenceScroller.addEventListener(\'pointerdown\', startSequencePan);');
    expect(html).toContain('sequenceScroller.addEventListener(\'pointermove\', moveSequencePan);');
    expect(html).toContain('sequenceScroller.scrollLeft = state.sequencePan.scrollLeft - dx;');
    expect(html).toContain('sequenceScroller.scrollTop = state.sequencePan.scrollTop - dy;');
  });

  it('emits syntactically valid webview scripts', () => {
    const html = renderImpactGraphHtml(baseRenderGraphFixture());
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);

    expect(scripts.length).toBeGreaterThan(0);
    for (const script of scripts) {
      expect(() => new vm.Script(script)).not.toThrow();
    }
  });

  it('shows current manifest version in product header', () => {
    const manifestPath = path.resolve(process.cwd(), 'package.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as { version?: unknown };
    const expectedVersion = `v${typeof manifest.version === 'string' ? manifest.version : 'unknown'}`;

    const html = renderImpactGraphHtml(baseRenderGraphFixture());

    expect(html).toContain(`class="version-pill">${expectedVersion}</span>`);
  });

  it('uses explicit version override in product header', () => {
    const html = renderImpactGraphHtml(baseRenderGraphFixture(), { productVersion: '9.9.9-preview' });

    expect(html).toContain('class="version-pill">v9.9.9-preview</span>');
  });

  it('supports Jakarta JAX-RS endpoint annotations', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-graph-'));
    roots.push(root);
    write(root, 'src/main/java/example/AdminUserResource.java', `
package example;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.POST;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.PathParam;
@Path("/admin/users")
class AdminUserResource {
  @GET
  @Path("/{id}")
  public UserDto findUser(@PathParam("id") String id) {
    return new UserDto();
  }

  @POST
  public UserDto createUser(UserDto dto) {
    return dto;
  }
}
class UserDto {}
`);

    const graph = await buildImpactGraph({
      root,
      target: 'AdminUserResource',
      mode: 'api-flow',
      maxFiles: 50,
    });

    expect(graph.summary.endpoints).toBe(2);
    expect(graph.summary.frameworkAnnotations).toBeGreaterThanOrEqual(5);
    expect(graph.nodes.filter(node => node.kind === 'endpoint').map(node => node.label).sort()).toEqual([
      'GET /admin/users/{id}',
      'POST /admin/users',
    ]);
  });

  it('keeps JAX-RS endpoint annotations across multiline annotation blocks', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-graph-'));
    roots.push(root);
    write(root, 'src/main/java/example/ClusterResource.java', `
package example;
import jakarta.ws.rs.GET;
import jakarta.ws.rs.Path;
import jakarta.ws.rs.Produces;
@Path("/cluster")
class ClusterResource {
  private final ClusterService service = new ClusterService();

  @GET
  @Path(Paths.INFO)
  @Produces({
      "application/json",
      "application/xml"
  })
  @Override
  public Info getInfo() {
    service.load();
    return new Info();
  }
}
class Paths { static final String INFO = "/info"; }
class ClusterService {
  Info load() {
    return new Info();
  }
}
class Info {}
`);

    const graph = await buildImpactGraph({
      root,
      target: 'ClusterResource',
      mode: 'api-flow',
      maxFiles: 50,
      maxDepth: 6,
    });

    expect(graph.summary.endpoints).toBe(1);
    expect(graph.nodes.some(node => node.kind === 'endpoint' && node.label.includes('Paths.INFO'))).toBe(true);
    expect(graph.flows[0]?.diagnostics.resolvedCalls).toBeGreaterThanOrEqual(1);
  });

  it('resolves field and parameter receiver calls when their source type is unique', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-graph-'));
    roots.push(root);
    write(root, 'src/main/java/example/ProfileController.java', `
package example;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
@RestController
@RequestMapping("/profiles")
class ProfileController {
  private final AuthorizationService authorizationService = new AuthorizationService();

  @GetMapping("/{profile}")
  public String show(Profile profile) {
    authorizationService.assertLoggedIn();
    return profile.name();
  }
}
class AuthorizationService {
  void assertLoggedIn() {}
}
class Profile {
  String name() {
    return "Ada";
  }
}
`);

    const graph = await buildImpactGraph({
      root,
      target: 'ProfileController.show',
      mode: 'api-flow',
      maxFiles: 50,
      maxDepth: 6,
    });

    expect(graph.flows[0]?.diagnostics.resolvedCalls).toBeGreaterThanOrEqual(2);
    expect(graph.flows[0]?.steps.some(step => step.target?.endsWith('AuthorizationService.assertLoggedIn'))).toBe(true);
    expect(graph.flows[0]?.steps.some(step => step.target?.endsWith('Profile.name'))).toBe(true);
  });

  it('generates endpoint flow when the target is a transitive middle-layer method', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-graph-'));
    roots.push(root);
    write(root, 'src/main/java/example/OrderController.java', `
package example;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
@RestController
@RequestMapping("/orders")
class OrderController {
  private final OrderService service = new OrderService();

  @PostMapping("")
  String create(OrderRequest request) {
    return service.create(request);
  }
}
class OrderRequest {}
`);
    write(root, 'src/main/java/example/OrderService.java', `
package example;
class OrderService {
  private final OrderPolicy policy = new OrderPolicy();

  String create(OrderRequest request) {
    policy.validate(request);
    return "ok";
  }
}
`);
    write(root, 'src/main/java/example/OrderPolicy.java', `
package example;
class OrderPolicy {
  void validate(OrderRequest request) {
    if (request == null) {
      throw new IllegalArgumentException();
    }
  }
}
`);

    const graph = await buildImpactGraph({
      root,
      target: 'OrderPolicy.validate',
      mode: 'api-flow',
      maxFiles: 50,
      maxDepth: 8,
    });

    expect(graph.summary.endpoints).toBe(1);
    expect(graph.flows).toHaveLength(1);
    expect(graph.flows[0]?.endpoint?.path).toBe('/orders');
    expect(graph.flows[0]?.steps.some(step => step.target?.endsWith('OrderService.create'))).toBe(true);
    expect(graph.flows[0]?.steps.some(step => step.target?.endsWith('OrderPolicy.validate'))).toBe(true);
    expect(graph.flows[0]?.mermaid).toContain('participant OrderPolicy as OrderPolicy');
  });

  it('finds endpoint sequence flow when the target is a top-level test class', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-graph-'));
    roots.push(root);
    write(root, 'src/main/java/example/BookController.java', `
package example;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
@RestController
@RequestMapping("/books")
class BookController {
  private final BookService service = new BookService();

  @PostMapping("/blocks")
  BookBlock create(CreateBookBlockFromContentRequest request) {
    return service.create(request);
  }
}
class BookService {
  BookBlock create(CreateBookBlockFromContentRequest request) {
    return new BookBlock();
  }
}
class BookBlock {}
class CreateBookBlockFromContentRequest {
  CreateBookBlockFromContentRequest(String content) {}
}
`);
    write(root, 'src/test/java/example/BookControllerTest.java', `
package example;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
class BookControllerTest {
  @Nested
  class CreateBookBlockFromContent {
    private final BookController controller = new BookController();

    @Test
    void createsBlock() {
      controller.create(splitRequest("intro"));
    }

    private CreateBookBlockFromContentRequest splitRequest(String content) {
      return new CreateBookBlockFromContentRequest(content);
    }
  }
}
`);

    const graph = await buildImpactGraph({
      root,
      target: 'BookControllerTest',
      mode: 'api-flow',
      maxFiles: 50,
      maxDepth: 6,
    });

    const targets = graph.flows[0]?.steps.map(step => step.target ?? '') ?? [];
    expect(graph.summary.endpoints).toBe(1);
    expect(graph.summary.flows).toBe(1);
    expect(graph.flows[0]?.endpoint?.path).toBe('/books/blocks');
    expect(targets.some(target => target.endsWith('BookController.create'))).toBe(true);
    expect(targets.some(target => target.endsWith('BookService.create'))).toBe(true);
    expect(graph.flows[0]?.mermaid).toContain('participant BookController as BookController');

    const html = renderImpactGraphHtml(graph, { initialTab: 'static-debug' });
    expect(html).toContain('"title":"Enter POST /books/blocks"');
    const match = /const staticDebuggerSessions = (\[[\s\S]*?\]);/.exec(html);
    const sessions = JSON.parse(match?.[1] ?? '[]') as Array<{ steps?: unknown[] }>;
    expect(sessions[0]?.steps?.length).toBeGreaterThan(0);
  });

  it('traces full injected service and client layers through interface receivers', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-graph-'));
    roots.push(root);
    write(root, 'src/main/java/example/OrderController.java', `
package example;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
@RestController
@RequestMapping("/orders")
class OrderController {
  private final OrderService service = new OrderService();

  @PostMapping("")
  Receipt create(OrderRequest request) {
    return service.create(request);
  }
}
class OrderRequest {}
class Receipt {}
`);
    write(root, 'src/main/java/example/OrderService.java', `
package example;
class OrderService {
  private final InventoryService inventoryService = new InventoryService();
  private final PaymentService paymentService = new PaymentService();

  Receipt create(OrderRequest request) {
    inventoryService.reserve(request);
    return paymentService.pay(request);
  }
}
`);
    write(root, 'src/main/java/example/InventoryService.java', `
package example;
class InventoryService {
  void reserve(OrderRequest request) {}
}
`);
    write(root, 'src/main/java/example/PaymentService.java', `
package example;
class PaymentService {
  private final FraudClient fraudClient = new StripeFraudClient();
  private final BillingClient billingClient = new BillingClient();

  Receipt pay(OrderRequest request) {
    fraudClient.screen(request);
    return billingClient.charge(request);
  }
}
interface FraudClient {
  void screen(OrderRequest request);
}
class StripeFraudClient implements FraudClient {
  public void screen(OrderRequest request) {}
}
class BillingClient {
  Receipt charge(OrderRequest request) {
    return new Receipt();
  }
}
`);

    const graph = await buildImpactGraph({
      root,
      target: 'StripeFraudClient.screen',
      mode: 'api-flow',
      maxFiles: 50,
      maxDepth: 12,
    });

    const targets = graph.flows[0]?.steps.map(step => step.target ?? '') ?? [];
    expect(graph.summary.endpoints).toBe(1);
    expect(graph.flows[0]?.endpoint?.path).toBe('/orders');
    expect(targets.some(target => target.endsWith('OrderController.create'))).toBe(true);
    expect(targets.some(target => target.endsWith('OrderService.create'))).toBe(true);
    expect(targets.some(target => target.endsWith('InventoryService.reserve'))).toBe(true);
    expect(targets.some(target => target.endsWith('PaymentService.pay'))).toBe(true);
    expect(targets.some(target => target.endsWith('StripeFraudClient.screen'))).toBe(true);
    expect(targets.some(target => target.endsWith('BillingClient.charge'))).toBe(true);
    expect(graph.flows[0]?.diagnostics.unresolvedCalls).toBe(0);
    expect(graph.flows[0]?.mermaid).toContain('participant StripeFraudClient as StripeFraudClient');
  });

  it('uses class names for mermaid sequence participants instead of method names', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-graph-'));
    roots.push(root);
    write(root, 'src/main/java/example/ProfileController.java', `
package example;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
@RequestMapping("/profiles")
class ProfileController {
  private final AuthorizationService authorizationService = new AuthorizationService();

  @GetMapping("/{profile}")
  public String show(Profile profile) {
    return authorizationService.assertLoggedIn() + profile.name();
  }
}
class AuthorizationService {
  String assertLoggedIn() {
    return "ok";
  }
}
class Profile {
  String name() {
    return "Ada";
  }
}
`);

    const graph = await buildImpactGraph({
      root,
      target: 'ProfileController',
      mode: 'api-flow',
      maxFiles: 50,
      maxDepth: 6,
    });

    const mermaid = graph.flows[0]?.mermaid ?? '';
    const participantLabels = [...mermaid.matchAll(/^participant\s+\S+\s+as\s+(.+)$/gm)].map(match => match[1] ?? '');
    expect(participantLabels).toEqual(expect.arrayContaining([
      'Client',
      'ProfileController',
      'AuthorizationService',
      'Profile',
    ]));
    expect(participantLabels.some(label => /assertLoggedIn|name|show/.test(label))).toBe(false);
  });

  it('uses the calling class for unresolved local call steps', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-graph-'));
    roots.push(root);
    write(root, 'src/main/java/example/LocalCallHandler.java', `
package example;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
@RestController
@RequestMapping("/local-calls")
class A {
  @GetMapping("")
  String route() {
    helper();
    return "ok";
  }
}
class B {
  void helper() {}
}
class C {
  void helper() {}
}
`);

    const graph = await buildImpactGraph({
      root,
      target: 'A.route',
      mode: 'api-flow',
      maxFiles: 50,
      maxDepth: 6,
    });

    const mermaid = graph.flows[0]?.mermaid ?? '';
    const participantLabels = [...mermaid.matchAll(/^participant\s+\S+\s+as\s+(.+)$/gm)].map(match => match[1] ?? '');
    expect(participantLabels).toEqual(expect.arrayContaining(['Client', 'A']));
    expect(participantLabels).not.toContain('helper');
    expect(graph.flows[0]?.steps.some(step => step.kind === 'call' && step.target === 'helper' && step.label === 'helper()')).toBe(true);
  });

  it('uses the calling class for unresolved local callback steps', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-graph-'));
    roots.push(root);
    write(root, 'src/main/java/example/LocalCallbackClassLayer.java', `
package example;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
@RestController
@RequestMapping("/local-callbacks")
class A {
  @GetMapping("")
  String route(List<String> names) {
    names.forEach(name -> helper(name));
    return "ok";
  }
}
class B {
  String helper(String name) {
    return name;
  }
}
class C {
  String helper(String name) {
    return name;
  }
}
`);

    const graph = await buildImpactGraph({
      root,
      target: 'A.route',
      mode: 'api-flow',
      maxFiles: 50,
      maxDepth: 6,
    });

    const mermaid = graph.flows[0]?.mermaid ?? '';
    const participantLabels = [...mermaid.matchAll(/^participant\s+\S+\s+as\s+(.+)$/gm)].map(match => match[1] ?? '');
    expect(participantLabels).toEqual(expect.arrayContaining(['Client', 'A']));
    expect(participantLabels).not.toContain('helper');
    expect(participantLabels).not.toContain('lambda -> helper');
    expect(graph.flows[0]?.steps.some(step => step.kind === 'lambda' && step.target === 'helper' && step.label === 'lambda -> helper')).toBe(true);
  });

  it('detects Elasticsearch BaseRestHandler routes as API endpoints', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-graph-'));
    roots.push(root);
    write(root, 'src/main/java/example/RestThingAction.java', `
package example;
import java.util.List;
import static org.elasticsearch.rest.RestRequest.Method.GET;
class RestThingAction {
  private final ThingService service = new ThingService();

  public List<Route> routes() {
    return List.of(new Route(GET, "/_thing"));
  }

  public RestChannelConsumer prepareRequest(RestRequest request, NodeClient client) {
    return channel -> service.run();
  }
}
class ThingService { void run() {} }
class Route { Route(Object method, String path) {} }
class RestRequest {}
class NodeClient {}
interface RestChannelConsumer {}
`);

    const graph = await buildImpactGraph({
      root,
      target: 'RestThingAction',
      mode: 'api-flow',
      maxFiles: 50,
      maxDepth: 6,
    });

    expect(graph.summary.endpoints).toBe(1);
    expect(graph.nodes.some(node => node.kind === 'endpoint' && node.label === 'GET /_thing')).toBe(true);
    expect(graph.flows[0]?.endpoint?.handler).toContain('prepareRequest');
  });

  it('shows lambdas and method references as callback flow evidence', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-graph-'));
    roots.push(root);
    write(root, 'src/main/java/example/CallbackController.java', `
package example;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
@RestController
@RequestMapping("/callbacks")
class CallbackController {
  @GetMapping("")
  public List<String> list(List<User> users) {
    return users.stream()
      .filter(user -> isAllowed(user))
      .map(this::toDto)
      .toList();
  }

  boolean isAllowed(User user) {
    return true;
  }

  String toDto(User user) {
    return user.name();
  }
}
record User(String name) {}
`);

    const graph = await buildImpactGraph({
      root,
      target: 'CallbackController',
      mode: 'api-flow',
      maxFiles: 50,
      maxDepth: 6,
    });

    expect(graph.summary.callbacks).toBeGreaterThanOrEqual(2);
    expect(graph.evidence.some(item => item.kind === 'lambda')).toBe(true);
    expect(graph.evidence.some(item => item.kind === 'method_reference')).toBe(true);
    expect(graph.flows[0]?.steps.some(step => step.kind === 'lambda')).toBe(true);
    expect(graph.flows[0]?.steps.some(step => step.kind === 'method_reference')).toBe(true);
    expect(graph.flows[0]?.mermaid).toContain('sequenceDiagram');
  });

  it('marks branches, loops, exceptions, returns, and flow diagnostics', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ext-graph-'));
    roots.push(root);
    write(root, 'src/main/java/example/ComplexController.java', `
package example;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
@RestController
@RequestMapping("/complex")
class ComplexController {
  private final ComplexService service = new ComplexService();
  @GetMapping("")
  public String run(List<String> ids) {
    if (ids.isEmpty()) {
      return "empty";
    }
    try {
      for (String id : ids) {
        service.handle(id);
      }
    } catch (RuntimeException error) {
      throw error;
    }
    return service.finish();
  }
}
class ComplexService {
  void handle(String id) {}
  String finish() { return "ok"; }
}
`);

    const graph = await buildImpactGraph({
      root,
      target: 'ComplexController',
      mode: 'api-flow',
      maxFiles: 50,
      maxDepth: 6,
    });

    const kinds = graph.flows[0]?.steps.map(step => step.kind) ?? [];
    expect(kinds).toContain('branch');
    expect(kinds).toContain('loop');
    expect(kinds).toContain('exception');
    expect(kinds).toContain('throw');
    expect(kinds).toContain('return');
    expect(graph.flows[0]?.diagnostics.branchMarkers).toBeGreaterThanOrEqual(1);
    expect(graph.flows[0]?.diagnostics.loopMarkers).toBeGreaterThanOrEqual(1);
    expect(graph.flows[0]?.diagnostics.exceptionMarkers).toBeGreaterThanOrEqual(1);
    expect(graph.flows[0]?.diagnostics.returnMarkers).toBeGreaterThanOrEqual(1);

    const html = renderImpactGraphHtml(graph);
    expect(html).toContain('Flow Diagnostics');
    expect(html).toContain('Branches');
    expect(html).toContain('Unresolved');
  });

  it('injects precomputed Maven commands for test files into webview payload', () => {
    const html = renderImpactGraphHtml({
      schemaVersion: 1,
      metadata: {
        root: '/tmp/workspace',
        target: 'AuthService.findUser',
        mode: 'patch-impact',
        generatedAt: '2026-06-21T00:00:00.000Z',
        analyzer: 'ext-graph-static-java',
        fileLimit: 100000,
        truncated: false,
        skippedLargeFiles: 0,
        buildSystem: { tool: 'maven', wrapper: 'mvnw' },
        trust: {
          level: 'high',
          score: 92,
          reasons: [],
          resolvedCallRate: 1,
          averageConfidence: 1,
          unresolvedCalls: 0,
          staticOnly: true,
        },
      },
      summary: {
        javaFilesScanned: 1,
        definitions: 0,
        references: 1,
        callSites: 0,
        fieldReads: 0,
        fieldWrites: 0,
        endpoints: 1,
        callbacks: 0,
        frameworkAnnotations: 0,
        flows: 1,
        maxFlowDepth: 20,
        tests: 1,
        topFiles: [],
      },
      nodes: [],
      edges: [],
      flows: [{
        id: 'flow-1',
        label: 'Auth endpoint',
        endpoint: {
          method: 'GET',
          path: '/users/{id}',
          handler: 'AuthService.findUser',
          file: 'src/main/java/example/AuthService.java',
          line: 10,
        },
        maxDepth: 20,
        truncated: false,
        mermaid: 'sequenceDiagram',
        diagnostics: {
          resolvedCalls: 0,
          unresolvedCalls: 0,
          branchMarkers: 0,
          loopMarkers: 0,
          exceptionMarkers: 0,
          returnMarkers: 0,
          averageConfidence: 1,
          staticOnly: true,
          notes: [],
        },
        steps: [],
      }],
      evidence: [{
        id: 'ev-1',
        kind: 'test',
        file: 'core module/src/test/java/example/AuthServiceTest.java',
        line: 7,
        text: 'void testFindUser() {}',
        symbol: 'AuthService.findUser',
        confidence: 0.9,
      }],
      warnings: [],
    } as ImpactGraph);

    const match = /const testCommandsByFile = (\{[\s\S]*?\});/.exec(html);
    expect(match).not.toBeNull();
    const commands = JSON.parse(match?.[1] ?? '{}');
    const command = commands['core module/src/test/java/example/AuthServiceTest.java'];
    expect(command).toBe('./mvnw -pl "core module" -Dtest="AuthServiceTest" test');
  });

  it('injects Windows Maven wrapper command in webview payload', () => {
    const html = renderImpactGraphHtml({
      schemaVersion: 1,
      metadata: {
        root: 'C:\\workspace\\project',
        target: 'AuthService.findUser',
        mode: 'patch-impact',
        generatedAt: '2026-06-21T00:00:00.000Z',
        analyzer: 'ext-graph-static-java',
        fileLimit: 100000,
        truncated: false,
        skippedLargeFiles: 0,
        buildSystem: { tool: 'maven', wrapper: 'mvnw' },
        trust: {
          level: 'high',
          score: 92,
          reasons: [],
          resolvedCallRate: 1,
          averageConfidence: 1,
          unresolvedCalls: 0,
          staticOnly: true,
        },
      },
      summary: {
        javaFilesScanned: 1,
        definitions: 0,
        references: 1,
        callSites: 0,
        fieldReads: 0,
        fieldWrites: 0,
        endpoints: 1,
        callbacks: 0,
        frameworkAnnotations: 0,
        flows: 1,
        maxFlowDepth: 20,
        tests: 1,
        topFiles: [],
      },
      nodes: [],
      edges: [],
      flows: [{
        id: 'flow-1',
        label: 'Auth endpoint',
        endpoint: {
          method: 'GET',
          path: '/users/{id}',
          handler: 'AuthService.findUser',
          file: 'src/main/java/example/AuthService.java',
          line: 10,
        },
        maxDepth: 20,
        truncated: false,
        mermaid: 'sequenceDiagram',
        diagnostics: {
          resolvedCalls: 0,
          unresolvedCalls: 0,
          branchMarkers: 0,
          loopMarkers: 0,
          exceptionMarkers: 0,
          returnMarkers: 0,
          averageConfidence: 1,
          staticOnly: true,
          notes: [],
        },
        steps: [],
      }],
      evidence: [{
        id: 'ev-1',
        kind: 'test',
        file: 'core\\module\\src\\test\\java\\example\\AuthServiceTest.java',
        line: 7,
        text: 'void testFindUser() {}',
        symbol: 'AuthService.findUser',
        confidence: 0.9,
      }],
      warnings: [],
    } as ImpactGraph);

    const match = /const testCommandsByFile = (\{[\s\S]*?\});/.exec(html);
    expect(match).not.toBeNull();
    const commands = JSON.parse(match?.[1] ?? '{}');
    const command = commands[Object.keys(commands).find(key => key.endsWith('AuthServiceTest.java')) || ''];
    expect(command).toBe('.\\mvnw.cmd -pl "core/module" -Dtest="AuthServiceTest" test');
  });

  it('dedupes run-test command batches before posting to the webview host', () => {
    const html = renderImpactGraphHtml({
      schemaVersion: 1,
      metadata: {
        root: '/tmp/workspace',
        target: 'AuthService.findUser',
        mode: 'patch-impact',
        generatedAt: '2026-06-21T00:00:00.000Z',
        analyzer: 'ext-graph-static-java',
        fileLimit: 100000,
        truncated: false,
        skippedLargeFiles: 0,
        buildSystem: { tool: 'maven', wrapper: 'mvnw' },
        trust: {
          level: 'high',
          score: 92,
          reasons: [],
          resolvedCallRate: 1,
          averageConfidence: 1,
          unresolvedCalls: 0,
          staticOnly: true,
        },
      },
      summary: {
        javaFilesScanned: 1,
        definitions: 0,
        references: 1,
        callSites: 0,
        fieldReads: 0,
        fieldWrites: 0,
        endpoints: 1,
        callbacks: 0,
        frameworkAnnotations: 0,
        flows: 1,
        maxFlowDepth: 20,
        tests: 1,
        topFiles: [],
      },
      nodes: [],
      edges: [],
      flows: [{
        id: 'flow-1',
        label: 'Auth endpoint',
        endpoint: {
          method: 'GET',
          path: '/users/{id}',
          handler: 'AuthService.findUser',
          file: 'src/main/java/example/AuthService.java',
          line: 10,
        },
        maxDepth: 20,
        truncated: false,
        mermaid: 'sequenceDiagram',
        diagnostics: {
          resolvedCalls: 0,
          unresolvedCalls: 0,
          branchMarkers: 0,
          loopMarkers: 0,
          exceptionMarkers: 0,
          returnMarkers: 0,
          averageConfidence: 1,
          staticOnly: true,
          notes: [],
        },
        steps: [],
      }],
      evidence: [{
        id: 'ev-1',
        kind: 'test',
        file: 'submodule/src/test/java/example/AuthServiceTest.java',
        line: 7,
        text: 'void testFindUser() {}',
        symbol: 'AuthService.findUser',
        confidence: 0.9,
      }],
      warnings: [],
    } as ImpactGraph);

    expect(html).toContain('collectNormalizedCommands(commands)');
    expect(html).toContain('command.trim()');
  });

  it('deduplicates test suggestions in the impact webview when evidence file separators differ', () => {
    const html = renderImpactGraphHtml({
      schemaVersion: 1,
      metadata: {
        root: '/tmp/workspace',
        target: 'AuthService.findUser',
        mode: 'patch-impact',
        generatedAt: '2026-06-21T00:00:00.000Z',
        analyzer: 'ext-graph-static-java',
        fileLimit: 100000,
        truncated: false,
        skippedLargeFiles: 0,
        buildSystem: { tool: 'maven', wrapper: 'mvnw' },
        trust: {
          level: 'high',
          score: 92,
          reasons: [],
          resolvedCallRate: 1,
          averageConfidence: 1,
          unresolvedCalls: 0,
          staticOnly: true,
        },
      },
      summary: {
        javaFilesScanned: 1,
        definitions: 0,
        references: 1,
        callSites: 0,
        fieldReads: 0,
        fieldWrites: 0,
        endpoints: 1,
        callbacks: 0,
        frameworkAnnotations: 0,
        flows: 1,
        maxFlowDepth: 20,
        tests: 1,
        topFiles: [],
      },
      nodes: [],
      edges: [],
      flows: [{
        id: 'flow-1',
        label: 'Auth endpoint',
        endpoint: {
          method: 'GET',
          path: '/users/{id}',
          handler: 'AuthService.findUser',
          file: 'src/main/java/example/AuthService.java',
          line: 10,
        },
        maxDepth: 20,
        truncated: false,
        mermaid: 'sequenceDiagram',
        diagnostics: {
          resolvedCalls: 0,
          unresolvedCalls: 0,
          branchMarkers: 0,
          loopMarkers: 0,
          exceptionMarkers: 0,
          returnMarkers: 0,
          averageConfidence: 1,
          staticOnly: true,
          notes: [],
        },
        steps: [],
      }],
      evidence: [{
        id: 'ev-1',
        kind: 'test',
        file: 'core\\module\\src/test/java/example/AuthServiceTest.java',
        line: 7,
        text: 'void testFindUser() {}',
        symbol: 'AuthService.findUser',
        confidence: 0.9,
      }, {
        id: 'ev-2',
        kind: 'test',
        file: 'core/module/src/test/java/example/AuthServiceTest.java',
        line: 8,
        text: 'void testFindUserAgain() {}',
        symbol: 'AuthService.findUser',
        confidence: 0.8,
      }],
      warnings: [],
    } as ImpactGraph);

    const testSuggestionRows = html.match(/class=\"test-suggestion /g) ?? [];
    expect(testSuggestionRows).toHaveLength(1);
    expect(html).toContain(`Run Top ${TEST_COMMAND_BATCH_LIMIT}`);
    expect(html).toContain('AuthServiceTest');
  });
});

function write(root: string, file: string, content: string): void {
  const abs = path.join(root, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content.trimStart(), 'utf-8');
}

function baseRenderGraphFixture(): ImpactGraph {
  return {
    schemaVersion: 1,
    metadata: {
      root: '/tmp/workspace',
      target: 'AuthService.findUser',
      mode: 'patch-impact',
      generatedAt: '2026-06-21T00:00:00.000Z',
      analyzer: 'ext-graph-static-java',
      fileLimit: 100000,
      truncated: false,
      skippedLargeFiles: 0,
      buildSystem: { tool: 'maven', wrapper: 'mvnw' },
      trust: {
        level: 'high',
        score: 92,
        reasons: [],
        resolvedCallRate: 1,
        averageConfidence: 1,
        unresolvedCalls: 0,
        staticOnly: true,
      },
    },
    summary: {
      javaFilesScanned: 1,
      definitions: 1,
      references: 1,
      callSites: 1,
      fieldReads: 0,
      fieldWrites: 0,
      endpoints: 1,
      callbacks: 0,
      frameworkAnnotations: 0,
      flows: 1,
      maxFlowDepth: 20,
      tests: 1,
      topFiles: [],
    },
    nodes: [
      {
        id: 'node-1',
        kind: 'endpoint',
        file: 'src/main/java/example/AuthService.java',
        line: 10,
        label: 'Auth endpoint',
        signature: 'AuthService.findUser',
        color: '#f472b6',
      },
    ],
    edges: [],
    flows: [
      {
        id: 'flow-1',
        label: 'Auth endpoint',
        endpoint: {
          method: 'GET',
          path: '/users/{id}',
          handler: 'AuthService.findUser',
          file: 'src/main/java/example/AuthService.java',
          line: 10,
        },
        maxDepth: 20,
        truncated: false,
        mermaid: 'sequenceDiagram\\nparticipant A\\nparticipant B',
        diagnostics: {
          resolvedCalls: 0,
          unresolvedCalls: 0,
          branchMarkers: 0,
          loopMarkers: 0,
          exceptionMarkers: 0,
          returnMarkers: 0,
          averageConfidence: 1,
          staticOnly: true,
          notes: [],
        },
        steps: [],
      },
    ],
    evidence: [],
    warnings: [],
  };
}
