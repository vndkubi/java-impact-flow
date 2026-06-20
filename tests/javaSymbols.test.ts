import { describe, expect, it } from 'vitest';
import { findJavaSourceSymbols, impactLensTitle } from '../src/javaSymbols.js';

describe('java source symbols', () => {
  it('finds class and method targets for CodeLens placement', () => {
    const source = `
package example;
class OrderController {
  private final OrderService service = new OrderService();

  String listOrders() {
    return service.findOrders();
  }

  String countOrders() {
    return "1";
  }
}
`;

    expect(findJavaSourceSymbols('src/main/java/example/OrderController.java', source)).toEqual([
      {
        target: 'OrderController',
        name: 'OrderController',
        file: 'src/main/java/example/OrderController.java',
        line: 3,
        endLine: 5,
        kind: 'class',
      },
      {
        target: 'OrderController.listOrders',
        name: 'listOrders',
        owner: 'OrderController',
        file: 'src/main/java/example/OrderController.java',
        line: 6,
        endLine: 9,
        kind: 'method',
      },
      {
        target: 'OrderController.countOrders',
        name: 'countOrders',
        owner: 'OrderController',
        file: 'src/main/java/example/OrderController.java',
        line: 10,
        endLine: 13,
        kind: 'method',
      },
    ]);
  });

  it('formats an inline impact CodeLens title from graph counts', () => {
    expect(impactLensTitle({ endpoints: 3, tests: 7, references: 12 })).toBe('Impact: 3 endpoints | 7 tests | 12 refs');
  });
});
