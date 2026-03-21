import { describe, it, expect } from 'vitest';

import { parseDiff, basename, enrichWithIntraLineDiff, type DiffLine } from './diff-parser';

// ─── Test Fixtures ────────────────────────────────────────────────────────────

/** Simple single-file modification diff */
const SINGLE_FILE_MODIFIED = `diff --git a/src/utils.ts b/src/utils.ts
index abc1234..def5678 100644
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -1,5 +1,5 @@
 const x = 1;
-const y = 2;
+const y = 3;
 const z = 4;
`;

/** New file creation diff */
const NEW_FILE_DIFF = `diff --git a/src/new-file.ts b/src/new-file.ts
new file mode 100644
index 0000000..abc1234
--- /dev/null
+++ b/src/new-file.ts
@@ -0,0 +1,3 @@
+export const hello = 'world';
+export const foo = 'bar';
+export const baz = 42;
`;

/** Deleted file diff */
const DELETED_FILE_DIFF = `diff --git a/src/old-file.ts b/src/old-file.ts
deleted file mode 100644
index abc1234..0000000
--- a/src/old-file.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-const old = true;
-export default old;
`;

/** Multiple files in a single diff */
const MULTI_FILE_DIFF = `diff --git a/src/a.ts b/src/a.ts
index abc1234..def5678 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 20;
 const c = 3;
diff --git a/src/b.ts b/src/b.ts
index 1111111..2222222 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -10,3 +10,4 @@
 function foo() {
   return 1;
 }
+function bar() { return 2; }
`;

/** Diff with --stat preamble (from git show --stat -p) */
const DIFF_WITH_STAT_PREAMBLE = ` src/a.ts | 2 +-
 src/b.ts | 1 +
 2 files changed, 2 insertions(+), 1 deletion(-)

diff --git a/src/a.ts b/src/a.ts
index abc1234..def5678 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 20;
 const c = 3;
diff --git a/src/b.ts b/src/b.ts
index 1111111..2222222 100644
--- a/src/b.ts
+++ b/src/b.ts
@@ -10,3 +10,4 @@
 function foo() {
   return 1;
 }
+function bar() { return 2; }
`;

/** Diff with mode change (e.g. chmod) */
const MODE_CHANGE_DIFF = `diff --git a/script.sh b/script.sh
old mode 100644
new mode 100755
index abc1234..def5678
--- a/script.sh
+++ b/script.sh
@@ -1,2 +1,2 @@
 #!/bin/bash
-echo "hello"
+echo "world"
`;

/** Multiple hunk diff in a single file */
const MULTI_HUNK_DIFF = `diff --git a/src/large.ts b/src/large.ts
index abc1234..def5678 100644
--- a/src/large.ts
+++ b/src/large.ts
@@ -1,5 +1,5 @@
 const a = 1;
-const b = 2;
+const b = 22;
 const c = 3;
 const d = 4;
 const e = 5;
@@ -100,5 +100,5 @@
 const x = 1;
-const y = 2;
+const y = 99;
 const z = 3;
 const w = 4;
 const v = 5;
`;

/** Rename diff */
const RENAME_DIFF = `diff --git a/src/old-name.ts b/src/new-name.ts
similarity index 95%
rename from src/old-name.ts
rename to src/new-name.ts
index abc1234..def5678 100644
--- a/src/old-name.ts
+++ b/src/new-name.ts
@@ -1,3 +1,3 @@
-export const name = 'old';
+export const name = 'new';
 export const value = 42;
`;

/** Binary file diff */
const BINARY_FILE_DIFF = `diff --git a/image.png b/image.png
index abc1234..def5678 100644
Binary files a/image.png and b/image.png differ
`;

/** Complex --stat preamble with long file names */
const COMPLEX_STAT_PREAMBLE = ` .../commands/machine/daemon-start/git-polling.ts   | 227 ++++++++++++++++++++-
 packages/cli/src/infrastructure/git/git-reader.ts  |  28 ++-
 2 files changed, 243 insertions(+), 12 deletions(-)

diff --git a/packages/cli/src/commands/machine/daemon-start/git-polling.ts b/packages/cli/src/commands/machine/daemon-start/git-polling.ts
index 6dec4b9a..4f5f6f97 100644
--- a/packages/cli/src/commands/machine/daemon-start/git-polling.ts
+++ b/packages/cli/src/commands/machine/daemon-start/git-polling.ts
@@ -2,4 +2,4 @@
 /**
- * Old comment
+ * New comment
  */
`;

// ─── parseDiff ────────────────────────────────────────────────────────────────

describe('parseDiff', () => {
  // ─── Empty / Edge Cases ───────────────────────────────────────────────

  describe('empty and edge cases', () => {
    it('returns empty array for empty string', () => {
      expect(parseDiff('')).toEqual([]);
    });

    it('returns empty array for whitespace-only string', () => {
      expect(parseDiff('   \n\n  \t  ')).toEqual([]);
    });

    it('returns empty array for non-diff content', () => {
      expect(parseDiff('just some random text\nwith newlines')).toEqual([]);
    });

    it('returns empty array for stat-only output (no diff sections)', () => {
      const statOnly = ` src/a.ts | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)
`;
      expect(parseDiff(statOnly)).toEqual([]);
    });
  });

  // ─── Single File ──────────────────────────────────────────────────────

  describe('single file diff', () => {
    it('parses a simple modification', () => {
      const sections = parseDiff(SINGLE_FILE_MODIFIED);
      expect(sections).toHaveLength(1);

      const section = sections[0]!;
      expect(section.filePath).toBe('src/utils.ts');
      expect(section.status).toBe('modified');

      // Should have: hunk, context, deletion, addition, context, context (trailing empty line)
      const types = section.lines.map((l) => l.type);
      expect(types).toEqual(['hunk', 'context', 'deletion', 'addition', 'context', 'context']);
    });

    it('parses a new file creation', () => {
      const sections = parseDiff(NEW_FILE_DIFF);
      expect(sections).toHaveLength(1);

      const section = sections[0]!;
      expect(section.filePath).toBe('src/new-file.ts');
      expect(section.status).toBe('created');

      // All lines should be additions (plus the hunk header)
      const additions = section.lines.filter((l) => l.type === 'addition');
      expect(additions).toHaveLength(3);
    });

    it('parses a deleted file', () => {
      const sections = parseDiff(DELETED_FILE_DIFF);
      expect(sections).toHaveLength(1);

      const section = sections[0]!;
      // For deleted files, +++ /dev/null means filePath falls back to diff header
      expect(section.filePath).toBe('src/old-file.ts');
      expect(section.status).toBe('deleted');

      const deletions = section.lines.filter((l) => l.type === 'deletion');
      expect(deletions).toHaveLength(2);
    });

    it('parses a mode change diff', () => {
      const sections = parseDiff(MODE_CHANGE_DIFF);
      expect(sections).toHaveLength(1);

      const section = sections[0]!;
      expect(section.filePath).toBe('script.sh');
      expect(section.status).toBe('modified');
    });
  });

  // ─── Multiple Files ───────────────────────────────────────────────────

  describe('multi-file diffs', () => {
    it('parses multiple files correctly', () => {
      const sections = parseDiff(MULTI_FILE_DIFF);
      expect(sections).toHaveLength(2);

      expect(sections[0]!.filePath).toBe('src/a.ts');
      expect(sections[1]!.filePath).toBe('src/b.ts');
    });

    it('parses each file status independently', () => {
      const combined = NEW_FILE_DIFF + DELETED_FILE_DIFF + SINGLE_FILE_MODIFIED;
      const sections = parseDiff(combined);
      expect(sections).toHaveLength(3);

      expect(sections[0]!.status).toBe('created');
      expect(sections[1]!.status).toBe('deleted');
      expect(sections[2]!.status).toBe('modified');
    });
  });

  // ─── Stat Preamble Filtering (the bug fix) ───────────────────────────

  describe('stat preamble filtering', () => {
    it('filters out --stat preamble from git show output', () => {
      const sections = parseDiff(DIFF_WITH_STAT_PREAMBLE);
      expect(sections).toHaveLength(2);

      // No section should have empty filePath
      for (const section of sections) {
        expect(section.filePath).not.toBe('');
        expect(section.filePath).not.toBe('(unknown)');
        expect(section.filePath).not.toBe('(unknown file)');
      }

      expect(sections[0]!.filePath).toBe('src/a.ts');
      expect(sections[1]!.filePath).toBe('src/b.ts');
    });

    it('filters out complex stat preamble with truncated paths', () => {
      const sections = parseDiff(COMPLEX_STAT_PREAMBLE);
      expect(sections).toHaveLength(1);

      expect(sections[0]!.filePath).toBe(
        'packages/cli/src/commands/machine/daemon-start/git-polling.ts'
      );
    });

    it('handles diff with only stat preamble and no actual diff', () => {
      const statOnly = ` src/a.ts | 2 +-
 1 file changed, 1 insertion(+), 1 deletion(-)
`;
      const sections = parseDiff(statOnly);
      expect(sections).toHaveLength(0);
    });

    it('all sections have valid file paths — never empty', () => {
      // This is the exact scenario that caused the bug:
      // git show with --stat produces preamble before diff --git sections
      const diffWithPreamble = ` file1.ts | 5 ++---
 file2.ts | 3 +++
 2 files changed, 5 insertions(+), 3 deletions(-)

diff --git a/file1.ts b/file1.ts
index abc..def 100644
--- a/file1.ts
+++ b/file1.ts
@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 3;
 const c = 4;
diff --git a/file2.ts b/file2.ts
index 111..222 100644
--- a/file2.ts
+++ b/file2.ts
@@ -1,2 +1,5 @@
 const x = 10;
+const y = 20;
+const z = 30;
+const w = 40;
`;
      const sections = parseDiff(diffWithPreamble);

      // Should have exactly 2 sections, not 3 (no preamble section)
      expect(sections).toHaveLength(2);

      // Every section must have a non-empty filePath
      for (const section of sections) {
        expect(section.filePath.length).toBeGreaterThan(0);
        expect(section.filePath).not.toMatch(/unknown/i);
      }
    });
  });

  // ─── Line Numbers ─────────────────────────────────────────────────────

  describe('line number tracking', () => {
    it('tracks old and new line numbers from hunk header', () => {
      const sections = parseDiff(SINGLE_FILE_MODIFIED);
      const lines = sections[0]!.lines;

      // Hunk: @@ -1,5 +1,5 @@ → oldLineNum starts at 1, newLineNum starts at 1
      const contextLine = lines.find((l) => l.type === 'context' && l.content === ' const x = 1;');
      expect(contextLine?.oldLineNum).toBe(1);
      expect(contextLine?.newLineNum).toBe(1);

      const deletion = lines.find((l) => l.type === 'deletion');
      expect(deletion?.oldLineNum).toBe(2);
      expect(deletion?.newLineNum).toBeUndefined();

      const addition = lines.find((l) => l.type === 'addition');
      expect(addition?.newLineNum).toBe(2);
      expect(addition?.oldLineNum).toBeUndefined();
    });

    it('tracks line numbers across multiple hunks', () => {
      const sections = parseDiff(MULTI_HUNK_DIFF);
      const lines = sections[0]!.lines;

      // Find the second hunk
      const hunks = lines.filter((l) => l.type === 'hunk');
      expect(hunks).toHaveLength(2);

      // Find the deletion in the second hunk (should start at line 101)
      const secondHunkIdx = lines.indexOf(hunks[1]!);
      const secondDeletion = lines.slice(secondHunkIdx).find((l) => l.type === 'deletion');
      expect(secondDeletion?.oldLineNum).toBe(101);
    });
  });

  // ─── Line Type Classification ─────────────────────────────────────────

  describe('line type classification', () => {
    it('classifies hunk headers', () => {
      const sections = parseDiff(SINGLE_FILE_MODIFIED);
      const hunks = sections[0]!.lines.filter((l) => l.type === 'hunk');
      expect(hunks).toHaveLength(1);
      expect(hunks[0]!.content).toMatch(/^@@/);
    });

    it('classifies additions with leading +', () => {
      const sections = parseDiff(NEW_FILE_DIFF);
      const additions = sections[0]!.lines.filter((l) => l.type === 'addition');
      for (const add of additions) {
        expect(add.content).toMatch(/^\+/);
      }
    });

    it('classifies deletions with leading -', () => {
      const sections = parseDiff(DELETED_FILE_DIFF);
      const deletions = sections[0]!.lines.filter((l) => l.type === 'deletion');
      for (const del of deletions) {
        expect(del.content).toMatch(/^-/);
      }
    });

    it('classifies context lines (no +/- prefix)', () => {
      const sections = parseDiff(SINGLE_FILE_MODIFIED);
      const context = sections[0]!.lines.filter((l) => l.type === 'context');
      expect(context.length).toBeGreaterThan(0);
      // Context lines start with a space, except trailing empty lines
      for (const ctx of context) {
        expect(ctx.content === '' || ctx.content.startsWith(' ')).toBe(true);
      }
    });

    it('skips meta-header lines (diff --git, index, ---, +++)', () => {
      const sections = parseDiff(SINGLE_FILE_MODIFIED);
      const lines = sections[0]!.lines;

      // None of the parsed lines should be meta-headers
      for (const line of lines) {
        expect(line.content).not.toMatch(/^diff --git /);
        expect(line.content).not.toMatch(/^index /);
        expect(line.content).not.toMatch(/^--- /);
        expect(line.content).not.toMatch(/^\+\+\+ /);
      }
    });
  });

  // ─── File Path Extraction ─────────────────────────────────────────────

  describe('file path extraction', () => {
    it('extracts path from +++ b/ line', () => {
      const sections = parseDiff(SINGLE_FILE_MODIFIED);
      expect(sections[0]!.filePath).toBe('src/utils.ts');
    });

    it('extracts path from diff --git header as fallback', () => {
      // When +++ is /dev/null (deleted file), uses diff --git header
      const sections = parseDiff(DELETED_FILE_DIFF);
      expect(sections[0]!.filePath).toBe('src/old-file.ts');
    });

    it('extracts path for renamed files', () => {
      const sections = parseDiff(RENAME_DIFF);
      expect(sections[0]!.filePath).toBe('src/new-name.ts');
    });

    it('extracts path for deeply nested files', () => {
      const deepDiff = `diff --git a/packages/cli/src/commands/machine/daemon-start/git-polling.ts b/packages/cli/src/commands/machine/daemon-start/git-polling.ts
index abc..def 100644
--- a/packages/cli/src/commands/machine/daemon-start/git-polling.ts
+++ b/packages/cli/src/commands/machine/daemon-start/git-polling.ts
@@ -1,2 +1,2 @@
-const old = 1;
+const new_val = 2;
`;
      const sections = parseDiff(deepDiff);
      expect(sections[0]!.filePath).toBe(
        'packages/cli/src/commands/machine/daemon-start/git-polling.ts'
      );
    });
  });

  // ─── File Status Detection ────────────────────────────────────────────

  describe('file status detection', () => {
    it('detects created files (new file mode)', () => {
      const sections = parseDiff(NEW_FILE_DIFF);
      expect(sections[0]!.status).toBe('created');
    });

    it('detects deleted files (deleted file mode)', () => {
      const sections = parseDiff(DELETED_FILE_DIFF);
      expect(sections[0]!.status).toBe('deleted');
    });

    it('detects modified files (default)', () => {
      const sections = parseDiff(SINGLE_FILE_MODIFIED);
      expect(sections[0]!.status).toBe('modified');
    });

    it('detects created file from --- /dev/null', () => {
      // Some diffs don't have "new file mode" but have --- /dev/null
      const diff = `diff --git a/src/new.ts b/src/new.ts
index 0000000..abc1234
--- /dev/null
+++ b/src/new.ts
@@ -0,0 +1,1 @@
+export const x = 1;
`;
      const sections = parseDiff(diff);
      expect(sections[0]!.status).toBe('created');
    });
  });

  // ─── Binary Files ─────────────────────────────────────────────────────

  describe('binary files', () => {
    it('parses binary file diff with no hunk lines', () => {
      const sections = parseDiff(BINARY_FILE_DIFF);
      expect(sections).toHaveLength(1);
      expect(sections[0]!.filePath).toBe('image.png');
      expect(sections[0]!.status).toBe('modified');
      // Binary diffs have no hunk/add/del lines — just the "Binary files..." context
      const nonContext = sections[0]!.lines.filter((l) => l.type !== 'context');
      // May be empty or have the "Binary files..." line as context
      expect(nonContext.length).toBeLessThanOrEqual(1);
    });
  });

  // ─── Intra-line Diff Enrichment ─────────────────────────────────────

  describe('intra-line diff enrichment', () => {
    it('adds intra-line segments to paired deletion/addition', () => {
      const sections = parseDiff(SINGLE_FILE_MODIFIED);
      const lines = sections[0]!.lines;

      const deletion = lines.find((l) => l.type === 'deletion');
      const addition = lines.find((l) => l.type === 'addition');

      // Both should have intraSegments since they are paired
      expect(deletion?.intraSegments).toBeDefined();
      expect(addition?.intraSegments).toBeDefined();
    });

    it('does not add intra-line segments to unpaired additions', () => {
      // New file: all additions, no deletions to pair with
      const sections = parseDiff(NEW_FILE_DIFF);
      const additions = sections[0]!.lines.filter((l) => l.type === 'addition');

      for (const add of additions) {
        expect(add.intraSegments).toBeUndefined();
      }
    });

    it('does not add intra-line segments to unpaired deletions', () => {
      // Deleted file: all deletions, no additions to pair with
      const sections = parseDiff(DELETED_FILE_DIFF);
      const deletions = sections[0]!.lines.filter((l) => l.type === 'deletion');

      for (const del of deletions) {
        expect(del.intraSegments).toBeUndefined();
      }
    });
  });
});

// ─── enrichWithIntraLineDiff ─────────────────────────────────────────────────

describe('enrichWithIntraLineDiff', () => {
  it('enriches paired deletion+addition blocks', () => {
    const lines: DiffLine[] = [
      { type: 'deletion', content: '-const x = 2;', oldLineNum: 1 },
      { type: 'addition', content: '+const x = 3;', newLineNum: 1 },
    ];
    const result = enrichWithIntraLineDiff(lines);

    expect(result[0]!.intraSegments).toBeDefined();
    expect(result[1]!.intraSegments).toBeDefined();
  });

  it('pairs multiple consecutive deletions and additions', () => {
    const lines: DiffLine[] = [
      { type: 'deletion', content: '-line A old', oldLineNum: 1 },
      { type: 'deletion', content: '-line B old', oldLineNum: 2 },
      { type: 'addition', content: '+line A new', newLineNum: 1 },
      { type: 'addition', content: '+line B new', newLineNum: 2 },
    ];
    const result = enrichWithIntraLineDiff(lines);

    // Both pairs should be enriched
    expect(result[0]!.intraSegments).toBeDefined();
    expect(result[1]!.intraSegments).toBeDefined();
    expect(result[2]!.intraSegments).toBeDefined();
    expect(result[3]!.intraSegments).toBeDefined();
  });

  it('handles unequal deletion/addition counts (pairs min)', () => {
    const lines: DiffLine[] = [
      { type: 'deletion', content: '-line A', oldLineNum: 1 },
      { type: 'deletion', content: '-line B', oldLineNum: 2 },
      { type: 'deletion', content: '-line C', oldLineNum: 3 },
      { type: 'addition', content: '+line X', newLineNum: 1 },
    ];
    const result = enrichWithIntraLineDiff(lines);

    // Only 1 pair (min of 3 deletions, 1 addition)
    expect(result[0]!.intraSegments).toBeDefined(); // paired deletion
    expect(result[1]!.intraSegments).toBeUndefined(); // unpaired
    expect(result[2]!.intraSegments).toBeUndefined(); // unpaired
    expect(result[3]!.intraSegments).toBeDefined(); // paired addition
  });

  it('does not enrich isolated additions', () => {
    const lines: DiffLine[] = [
      { type: 'context', content: ' context', oldLineNum: 1, newLineNum: 1 },
      { type: 'addition', content: '+new line', newLineNum: 2 },
      { type: 'context', content: ' context2', oldLineNum: 2, newLineNum: 3 },
    ];
    const result = enrichWithIntraLineDiff(lines);

    expect(result[1]!.intraSegments).toBeUndefined();
  });

  it('does not enrich isolated deletions', () => {
    const lines: DiffLine[] = [
      { type: 'context', content: ' context', oldLineNum: 1, newLineNum: 1 },
      { type: 'deletion', content: '-old line', oldLineNum: 2 },
      { type: 'context', content: ' context2', oldLineNum: 3, newLineNum: 2 },
    ];
    const result = enrichWithIntraLineDiff(lines);

    expect(result[1]!.intraSegments).toBeUndefined();
  });

  it('handles empty input', () => {
    expect(enrichWithIntraLineDiff([])).toEqual([]);
  });

  it('does not modify context or hunk lines', () => {
    const lines: DiffLine[] = [
      { type: 'hunk', content: '@@ -1,5 +1,5 @@' },
      { type: 'context', content: ' unchanged', oldLineNum: 1, newLineNum: 1 },
    ];
    const result = enrichWithIntraLineDiff(lines);

    expect(result[0]!.intraSegments).toBeUndefined();
    expect(result[1]!.intraSegments).toBeUndefined();
  });
});

// ─── basename ────────────────────────────────────────────────────────────────

describe('basename', () => {
  it('extracts filename from a path', () => {
    expect(basename('src/utils/parser.ts')).toBe('parser.ts');
  });

  it('handles a single filename (no directory)', () => {
    expect(basename('file.ts')).toBe('file.ts');
  });

  it('handles deeply nested paths', () => {
    expect(basename('a/b/c/d/e/file.tsx')).toBe('file.tsx');
  });

  it('handles empty string', () => {
    expect(basename('')).toBe('');
  });

  it('handles path ending with slash', () => {
    expect(basename('src/utils/')).toBe('');
  });

  it('handles root-level file', () => {
    expect(basename('README.md')).toBe('README.md');
  });
});
