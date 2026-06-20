import { describe, expect, it } from 'vitest';
import {
  inferTargetsFromJavaSource,
  parseGitPorcelainJavaFiles,
  parseUnifiedDiffNewLines,
} from '../src/gitChanges.js';

describe('git change target inference', () => {
  it('parses changed Java files from porcelain status', () => {
    const output = [
      ' M src/main/java/example/OrderService.java',
      '?? src/test/java/example/OrderServiceTest.java',
      ' D src/main/java/example/Deleted.java',
      ' M README.md',
      '',
    ].join('\0');

    expect(parseGitPorcelainJavaFiles(output)).toEqual([
      { file: 'src/main/java/example/OrderService.java', status: 'M' },
      { file: 'src/test/java/example/OrderServiceTest.java', status: '??' },
    ]);
  });

  it('maps diff hunks to changed new-file lines', () => {
    const diff = [
      '@@ -10,0 +11,2 @@',
      '+  String name() {',
      '+    return value;',
      '@@ -30 +34 @@',
      '-old',
      '+new',
    ].join('\n');

    expect(parseUnifiedDiffNewLines(diff)).toEqual([11, 12, 34]);
  });

  it('infers the changed method target from changed Java lines', () => {
    const source = `
package example;
class OrderService {
  private String prefix;

  String findOrders() {
    return prefix + "ok";
  }

  String countOrders() {
    return "1";
  }
}
`;

    expect(inferTargetsFromJavaSource('src/main/java/example/OrderService.java', source, [6])).toEqual([
      {
        target: 'OrderService.findOrders',
        file: 'src/main/java/example/OrderService.java',
        line: 6,
        kind: 'method',
        reason: 'changed line 6',
      },
    ]);
  });

  it('falls back to the class target for changed fields', () => {
    const source = `
package example;
class OrderService {
  private String prefix;

  String findOrders() {
    return prefix + "ok";
  }
}
`;

    expect(inferTargetsFromJavaSource('src/main/java/example/OrderService.java', source, [4])[0]).toMatchObject({
      target: 'OrderService',
      kind: 'class',
      line: 3,
    });
  });
});
