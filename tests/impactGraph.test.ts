import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildImpactGraph } from '../src/impactGraph.js';
import { renderImpactGraphHtml } from '../src/render.js';

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
    expect(html).toContain("type: 'openLocation'");
    expect(html).toContain('open-hint');
    expect(html).toContain('Suggested Tests');
    expect(html).toContain('Trust Score');
    expect(html).toContain('trust-card');
    expect(html).toContain('renderTrust');
    expect(html).toContain('Copy PR Summary');
    expect(html).toContain('impactPrSummaryMarkdown');
    expect(html).toContain("type: 'publishDiagnostics'");
    expect(html).toContain('copy-test-command');
    expect(html).toContain('data-run-test-command');
    expect(html).toContain('<strong>Why:</strong>');
    expect(html).toContain("type: 'runTestCommand'");
    expect(html).toContain('testCommandForFile');
    expect(html).toContain("type: 'copyText'");
    expect(html).toContain('mapFilterBanner');
    expect(html).toContain('activeMapFilter');
    expect(html).toContain('References are filtered by this map group.');
    expect(html).toContain('References are filtered by this selection.');
    expect(html).toContain('Mermaid sequence');
    expect(html).toContain('sequenceDiagram');
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
      target: 'ProfileController',
      mode: 'api-flow',
      maxFiles: 50,
      maxDepth: 6,
    });

    expect(graph.flows[0]?.diagnostics.resolvedCalls).toBeGreaterThanOrEqual(2);
    expect(graph.flows[0]?.steps.some(step => step.target?.endsWith('AuthorizationService.assertLoggedIn'))).toBe(true);
    expect(graph.flows[0]?.steps.some(step => step.target?.endsWith('Profile.name'))).toBe(true);
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
});

function write(root: string, file: string, content: string): void {
  const abs = path.join(root, file);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content.trimStart(), 'utf-8');
}
