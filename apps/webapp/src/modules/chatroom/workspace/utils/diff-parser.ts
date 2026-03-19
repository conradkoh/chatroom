/**
 * Unified diff parser — extracts per-file diff sections from raw git diff output.
 *
 * Handles:
 * - Standard unified diffs (`git diff`, `git show`)
 * - New file / deleted file detection
 * - Hunk header parsing with line numbers
 * - Intra-line diff enrichment (character-level highlighting)
 * - Filtering of non-diff preamble (e.g. `--stat` output from `git show`)
 */

import { computeIntraLineDiff, type DiffSegment } from './intra-line-diff';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DiffLine {
  type: 'addition' | 'deletion' | 'hunk' | 'context';
  content: string;
  oldLineNum?: number; // line number in original file
  newLineNum?: number; // line number in new file
  /** Intra-line diff segments — present when this line is part of a paired deletion/addition */
  intraSegments?: DiffSegment[];
}

export interface FileDiffSection {
  /** File path extracted from the +++ b/... line. */
  filePath: string;
  lines: DiffLine[];
  status: 'created' | 'deleted' | 'modified';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns the filename portion of a file path.
 * e.g. "src/utils/parser.ts" → "parser.ts"
 */
export function basename(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}

// ─── Intra-line Diff Enrichment ───────────────────────────────────────────────

/**
 * Post-processing pass: pairs consecutive deletion/addition blocks and enriches
 * them with character-level intra-line diff segments.
 */
export function enrichWithIntraLineDiff(lines: DiffLine[]): DiffLine[] {
  const result = [...lines];
  let i = 0;

  while (i < result.length) {
    // Scan for a block of consecutive deletions
    const delStart = i;
    while (i < result.length && result[i]!.type === 'deletion') i++;
    const delEnd = i;

    // Immediately followed by a block of consecutive additions
    const addStart = i;
    while (i < result.length && result[i]!.type === 'addition') i++;
    const addEnd = i;

    const delCount = delEnd - delStart;
    const addCount = addEnd - addStart;

    if (delCount > 0 && addCount > 0) {
      // Pair up: min(delCount, addCount) pairs
      const pairs = Math.min(delCount, addCount);
      for (let p = 0; p < pairs; p++) {
        const delLine = result[delStart + p]!;
        const addLine = result[addStart + p]!;
        // Strip the leading -/+ for diff computation
        const oldContent = delLine.content.slice(1);
        const newContent = addLine.content.slice(1);
        const intra = computeIntraLineDiff(oldContent, newContent);
        result[delStart + p] = { ...delLine, intraSegments: intra.oldSegments };
        result[addStart + p] = { ...addLine, intraSegments: intra.newSegments };
      }
    }

    // If no deletion block was found, advance past the current line
    if (i === delStart) i++;
  }

  return result;
}

// ─── Diff Parser ──────────────────────────────────────────────────────────────

/**
 * Parses a unified diff string into per-file sections.
 * Splits on `diff --git` boundaries and classifies each line.
 * Tracks old/new line numbers from @@ hunk headers.
 * Detects file status (created/deleted/modified).
 *
 * Non-diff preamble (e.g. `--stat` output from `git show`) is filtered out.
 */
export function parseDiff(content: string): FileDiffSection[] {
  if (!content.trim()) return [];

  const rawSections = content.split(/^(?=diff --git )/m).filter((s) => s.startsWith('diff --git '));

  return rawSections.map((section): FileDiffSection => {
    const lines = section.split('\n');

    // Extract file path from `+++ b/<path>` or fall back to the diff header
    let filePath = '';
    let status: FileDiffSection['status'] = 'modified';

    for (const line of lines) {
      if (line.startsWith('new file mode') || line.startsWith('--- /dev/null')) {
        status = 'created';
      }
      if (line.startsWith('deleted file mode') || line.startsWith('+++ /dev/null')) {
        status = 'deleted';
      }
      if (line.startsWith('+++ b/')) {
        filePath = line.slice(6);
      } else if (line.startsWith('+++ /dev/null')) {
        filePath = filePath || '(deleted file)';
      }
      if (line.startsWith('diff --git ')) {
        // e.g. "diff --git a/foo/bar.ts b/foo/bar.ts"
        const match = /diff --git a\/.+ b\/(.+)/.exec(line);
        if (match) filePath = filePath || match[1]!;
      }
    }

    const parsedLines: DiffLine[] = [];
    let pastHeader = false;
    let oldLineNum = 0;
    let newLineNum = 0;

    for (const raw of lines) {
      // Skip the meta-header lines (diff --git, index, --- a/, +++ b/)
      if (
        raw.startsWith('diff --git ') ||
        raw.startsWith('index ') ||
        raw.startsWith('--- ') ||
        raw.startsWith('+++ ') ||
        raw.startsWith('new file mode') ||
        raw.startsWith('deleted file mode') ||
        raw.startsWith('old mode') ||
        raw.startsWith('new mode')
      ) {
        pastHeader = true;
        continue;
      }

      if (!pastHeader) continue;

      if (raw.startsWith('@@')) {
        // Parse hunk header: @@ -oldStart[,oldCount] +newStart[,newCount] @@
        const match = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
        if (match) {
          oldLineNum = parseInt(match[1]!, 10);
          newLineNum = parseInt(match[2]!, 10);
        }
        parsedLines.push({ type: 'hunk', content: raw });
      } else if (raw.startsWith('+')) {
        parsedLines.push({ type: 'addition', content: raw, newLineNum: newLineNum++ });
      } else if (raw.startsWith('-')) {
        parsedLines.push({ type: 'deletion', content: raw, oldLineNum: oldLineNum++ });
      } else {
        // context line (or empty trailing line)
        if (
          raw === '' &&
          parsedLines.length > 0 &&
          parsedLines[parsedLines.length - 1]!.type === 'hunk'
        ) {
          // skip trailing empty lines after hunk headers
          continue;
        }
        parsedLines.push({
          type: 'context',
          content: raw,
          oldLineNum: oldLineNum++,
          newLineNum: newLineNum++,
        });
      }
    }

    return { filePath, lines: enrichWithIntraLineDiff(parsedLines), status };
  });
}
