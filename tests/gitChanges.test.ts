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

  it('uses the new Java path for renamed or copied porcelain records', () => {
    const output = [
      ' R src/main/java/example/RenamedService.java',
      'src/main/java/example/OldService.java',
      'C  src/main/java/example/CopiedService.java',
      'src/main/java/example/SourceService.java',
      '',
    ].join('\0');

    expect(parseGitPorcelainJavaFiles(output)).toEqual([
      { file: 'src/main/java/example/OldService.java', status: 'R' },
      { file: 'src/main/java/example/SourceService.java', status: 'C' },
    ]);
  });

  it('handles rename targets with spaces while preserving the destination file only', () => {
    const output = [
      'R100 src/main/java/example/Legacy Service.java',
      'src/main/java/example/Legacy Service V2.java',
      '',
    ].join('\0');

    expect(parseGitPorcelainJavaFiles(output)).toEqual([
      { file: 'src/main/java/example/Legacy Service V2.java', status: 'R' },
    ]);
  });

  it('ignores non-java paths even when status is rename/copy', () => {
    const output = [
      'R100 src/main/resources/config.yaml',
      'src/main/resources/new-config.yaml',
      'M src/main/java/example/OldService.java',
      '',
      'M src/test/java/example/OldServiceTest.java',
      '',
    ].join('\0');

    expect(parseGitPorcelainJavaFiles(output)).toEqual([
      { file: 'src/main/java/example/OldService.java', status: 'M' },
      { file: 'src/test/java/example/OldServiceTest.java', status: 'M' },
    ]);
  });

  it('picks the destination for rename/copy when only destination is Java', () => {
    const output = [
      'R100 src/main/resources/config.yaml',
      'src/main/java/example/LegacyService.java',
      '',
    ].join('\0');

    expect(parseGitPorcelainJavaFiles(output)).toEqual([
      { file: 'src/main/java/example/LegacyService.java', status: 'R' },
    ]);
  });

  it('does not skip a malformed rename/copy pair when no destination path exists', () => {
    const output = [
      'R100 src/main/java/example/OrphanRename.java',
      '',
    ].join('\0');

    expect(parseGitPorcelainJavaFiles(output)).toEqual([
      { file: 'src/main/java/example/OrphanRename.java', status: 'R' },
    ]);
  });

  it('parses score-prefixed rename records with multiple spaces after score', () => {
    const output = [
      'R100  src/main/java/example/LegacyService.java',
      'src/main/java/example/LegacyServiceV2.java',
      '',
    ].join('\0');

    expect(parseGitPorcelainJavaFiles(output)).toEqual([
      { file: 'src/main/java/example/LegacyServiceV2.java', status: 'R' },
    ]);
  });

  it('handles score-prefixed rename and copy porcelain entries', () => {
    const output = [
      'R100 src/main/java/example/Old Service.java',
      'src/main/java/example/LegacyService.java',
      'C012 src/main/java/example/Feature Branch.java',
      'src/main/java/example/FeatureBranchBackup.java',
      '',
    ].join('\0');

    expect(parseGitPorcelainJavaFiles(output)).toEqual([
      { file: 'src/main/java/example/LegacyService.java', status: 'R' },
      { file: 'src/main/java/example/FeatureBranchBackup.java', status: 'C' },
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

  it('ignores malformed diff hunk headers with invalid start positions or counts', () => {
    const diff = [
      '@@ -10,0 +0,2 @@',
      '+line',
      '@@ -20 +bad @@',
      '+line',
      '@@ -30 +31,-2 @@',
      '+line',
    ].join('\n');

    expect(parseUnifiedDiffNewLines(diff)).toEqual([]);
  });

  it('limits each diff hunk contribution to avoid runaway line-list growth', () => {
    const diff = [
      '@@ -1,0 +1,100000 @@',
      '+line',
    ].join('\n');
    const parsed = parseUnifiedDiffNewLines(diff);

    expect(parsed).toHaveLength(5000);
    expect(parsed[0]).toBe(1);
    expect(parsed[4999]).toBe(5000);
    expect(parsed.includes(100000)).toBe(false);
  });

  it('caps total parsed changed lines across multiple hunks', () => {
    const hunks = [
      ['@@ -1,0 +1,5000 @@', '+line1'],
      ['@@ -5000,0 +5001,5000 @@', '+line2'],
      ['@@ -10000,0 +10001,5000 @@', '+line3'],
      ['@@ -15000,0 +15001,5000 @@', '+line4'],
      ['@@ -20000,0 +20001,5000 @@', '+line5'],
    ];

    const diff = hunks.map(item => item.join('\n')).join('\n');
    const parsed = parseUnifiedDiffNewLines(diff);

    expect(parsed).toHaveLength(20_000);
    expect(parsed[0]).toBe(1);
    expect(parsed[4_999]).toBe(5_000);
    expect(parsed[5_000]).toBe(5_001);
    expect(parsed[19_999]).toBe(20_000);
    expect(parsed.includes(20_001)).toBe(false);
  });

  it('normalizes backslashes to forward slashes in porcelain paths', () => {
    const output = [
      ' M src\\main\\java\\example\\OrderService.java',
      '',
    ].join('\0');

    expect(parseGitPorcelainJavaFiles(output)).toEqual([
      { file: 'src/main/java/example/OrderService.java', status: 'M' },
    ]);
  });

  it('deduplicates repeated Java file entries from porcelain status', () => {
    const output = [
      ' M src/main/java/example/OrderService.java',
      ' M src/main/java/example/OrderService.java',
      ' R100 src/main/java/example/NewService.java',
      'src/main/java/example/LegacyService.java',
      ' R099 src/main/java/example/AnotherService.java',
      'src/main/java/example/LegacyService.java',
      '',
    ].join('\0');

    expect(parseGitPorcelainJavaFiles(output)).toEqual([
      { file: 'src/main/java/example/OrderService.java', status: 'M' },
      { file: 'src/main/java/example/LegacyService.java', status: 'R' },
    ]);
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

  it('does not attribute class-level changes after a method to the previous method', () => {
    const source = `
package example;
class OrderService {
  String findOrders() {
    return "ok";
  }

  private String suffix;

  String countOrders() {
    return "1";
  }
}
`;

    expect(inferTargetsFromJavaSource('src/main/java/example/OrderService.java', source, [8])[0]).toMatchObject({
      target: 'OrderService',
      kind: 'class',
      line: 3,
    });
  });

  it('ignores braces inside block comments when locating changed methods', () => {
    const source = `
package example;
class OrderService {
  String findOrders() {
    /*
     }
    */
    return "ok";
  }

  String countOrders() {
    return "1";
  }
}
`;

    expect(inferTargetsFromJavaSource('src/main/java/example/OrderService.java', source, [8])[0]).toMatchObject({
      target: 'OrderService.findOrders',
      kind: 'method',
      line: 4,
    });
  });

  it('ignores braces inside Java text blocks when locating changed methods', () => {
    const source = `
package example;
class OrderService {
  String findOrders() {
    String payload = """
      }
      {"status":"ok"}
      """;
    return payload;
  }

  String countOrders() {
    return "1";
  }
}
`;

    expect(inferTargetsFromJavaSource('src/main/java/example/OrderService.java', source, [9])[0]).toMatchObject({
      target: 'OrderService.findOrders',
      kind: 'method',
      line: 4,
    });
  });

  it('infers nested class method targets from changed lines', () => {
    const source = `
package example;
class OuterService {
  void outer() {}

  class NestedService {
    void nested() {}
  }
}
`;

    expect(inferTargetsFromJavaSource('src/main/java/example/OuterService.java', source, [7])[0]).toMatchObject({
      target: 'NestedService.nested',
      file: 'src/main/java/example/OuterService.java',
      kind: 'method',
      line: 7,
    });
  });

  it('falls back to an outer class when a changed line is outside a nested class body', () => {
    const source = `
package example;
class OuterService {
  class NestedService {
    void nested() {}
  }

  int outsideNestedClass() {
    return 1;
  }
}
`;
    const targets = inferTargetsFromJavaSource('src/main/java/example/OuterService.java', source, [7]);

    expect(targets).toEqual([{
      target: 'OuterService',
      file: 'src/main/java/example/OuterService.java',
      line: 3,
      kind: 'class',
      reason: 'changed line 7',
    }]);
  });
});
