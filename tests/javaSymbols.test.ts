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
        endLine: 13,
        kind: 'class',
      },
      {
        target: 'OrderController.listOrders',
        name: 'listOrders',
        owner: 'OrderController',
        file: 'src/main/java/example/OrderController.java',
        line: 6,
        endLine: 8,
        kind: 'method',
      },
      {
        target: 'OrderController.countOrders',
        name: 'countOrders',
        owner: 'OrderController',
        file: 'src/main/java/example/OrderController.java',
        line: 10,
        endLine: 12,
        kind: 'method',
      },
    ]);
  });

  it('detects multiline method declarations spread beyond the previous hard limit', () => {
    const source = `
package example;
class MultilineController {
  String longSignature(
      String first,
      String second,
      int third,
      String fourth,
      String fifth,
      String sixth,
      String seventh,
      String eighth,
      String ninth,
      String tenth,
      String eleventh,
      String twelfth
  ) {
    return first;
  }
}
`;

    expect(findJavaSourceSymbols('src/main/java/example/MultilineController.java', source)).toEqual([
      {
        target: 'MultilineController',
        name: 'MultilineController',
        file: 'src/main/java/example/MultilineController.java',
        line: 3,
        endLine: 20,
        kind: 'class',
      },
      {
        target: 'MultilineController.longSignature',
        name: 'longSignature',
        owner: 'MultilineController',
        file: 'src/main/java/example/MultilineController.java',
        line: 4,
        endLine: 19,
        kind: 'method',
      },
    ]);
  });

  it('ignores braces inside string literals when computing method scope', () => {
    const source = `
package example;
class BraceLiteralService {
  String render() {
    String payload = "{}";
    return payload.replace("{", "\\{").concat("}");
  }
}
`;

    expect(findJavaSourceSymbols('src/main/java/example/BraceLiteralService.java', source)).toEqual([
      {
        target: 'BraceLiteralService',
        name: 'BraceLiteralService',
        file: 'src/main/java/example/BraceLiteralService.java',
        line: 3,
        endLine: 8,
        kind: 'class',
      },
      {
        target: 'BraceLiteralService.render',
        name: 'render',
        owner: 'BraceLiteralService',
        file: 'src/main/java/example/BraceLiteralService.java',
        line: 4,
        endLine: 7,
        kind: 'method',
      },
    ]);
  });

  it('formats an inline impact CodeLens title from graph counts', () => {
    expect(impactLensTitle({ endpoints: 3, tests: 7, references: 12 })).toBe('Impact: 3 endpoints | 7 tests | 12 refs');
  });

  it('does not treat commented class declarations as real class symbols', () => {
    const source = `
package example;
// class Ghost {
//   void fake() {}
// }
class RealService {
  String real() {
    return "ok";
  }
}
`;

    expect(findJavaSourceSymbols('src/main/java/example/RealService.java', source)).toEqual([
      {
        target: 'RealService',
        name: 'RealService',
        file: 'src/main/java/example/RealService.java',
        line: 6,
        endLine: 10,
        kind: 'class',
      },
      {
        target: 'RealService.real',
        name: 'real',
        owner: 'RealService',
        file: 'src/main/java/example/RealService.java',
        line: 7,
        endLine: 9,
        kind: 'method',
      },
    ]);
  });

  it('does not detect commented method-like text as a method symbol', () => {
    const source = `
package example;
/*
 * void fake(String id) {}
 */
class RealService {
  void real() {}
}
`;

    expect(findJavaSourceSymbols('src/main/java/example/RealService.java', source)).toEqual([
      {
        target: 'RealService',
        name: 'RealService',
        file: 'src/main/java/example/RealService.java',
        line: 6,
        endLine: 8,
        kind: 'class',
      },
      {
        target: 'RealService.real',
        name: 'real',
        owner: 'RealService',
        file: 'src/main/java/example/RealService.java',
        line: 7,
        endLine: 7,
        kind: 'method',
      },
    ]);
  });
});
