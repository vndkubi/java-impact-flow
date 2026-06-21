import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runValidationSuiteFile, validationMarkdown } from '../src/validation.js';

describe('validation pack', () => {
  it('passes the bundled Java sample suite and renders a scorecard', async () => {
    const result = await runValidationSuiteFile(path.resolve('validation/java-impact-flow.validation.json'), {
      maxFiles: 0,
      maxDepth: 0,
    });

    expect(result.passed).toBe(true);
    expect(result.summary).toEqual({ total: 2, passed: 2, failed: 0 });
    expect(result.cases.map(item => item.name)).toEqual([
      'spring-orders-service-impact',
      'jaxrs-admin-resource-impact',
    ]);
    expect(result.cases[0]?.actual.endpoints).toContain('GET /orders');
    expect(result.cases[0]?.actual.testClasses).toContain('example.OrderControllerTest');
    expect(result.cases[1]?.actual.endpoints).toEqual([
      'GET /admin/users/{id}',
      'POST /admin/users',
    ]);
    expect(result.cases[1]?.actual.testClasses).toContain('example.AdminUserResourceTest');

    const markdown = validationMarkdown(result);
    expect(markdown).toContain('Status: PASS');
    expect(markdown).toContain('| spring-orders-service-impact | OrderService.findOrders | PASS |');
    expect(markdown).toContain('Suggested tests: example.AdminUserResourceTest');
  });
});
