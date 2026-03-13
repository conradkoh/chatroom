/**
 * Intra-line diff utility — character-level diff for paired deletion/addition lines.
 *
 * Uses a character-level LCS (Longest Common Subsequence) to identify which
 * parts of two strings are the same and which have changed.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DiffSegment {
  text: string;
  type: 'same' | 'changed';
}

export interface IntraLineDiffResult {
  oldSegments: DiffSegment[];
  newSegments: DiffSegment[];
}

// ─── LCS Implementation ───────────────────────────────────────────────────────

/**
 * Computes the Longest Common Subsequence length table for two strings.
 * Returns a 2D array where lcs[i][j] = length of LCS of a[0..i-1] and b[0..j-1].
 */
function buildLCSTable(a: string, b: string): number[][] {
  const m = a.length;
  const n = b.length;
  // Allocate table with zeros
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i - 1]![j]!, dp[i]![j - 1]!);
      }
    }
  }

  return dp;
}

/**
 * Backtracks through the LCS table to produce character-level edit operations.
 * Returns arrays of 'same' | 'old-changed' | 'new-changed' operations.
 */
type CharOp =
  | { type: 'same'; char: string }
  | { type: 'old-changed'; char: string }
  | { type: 'new-changed'; char: string };

function backtrackLCS(a: string, b: string, dp: number[][]): CharOp[] {
  const ops: CharOp[] = [];
  let i = a.length;
  let j = b.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ type: 'same', char: a[i - 1]! });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      ops.push({ type: 'new-changed', char: b[j - 1]! });
      j--;
    } else {
      ops.push({ type: 'old-changed', char: a[i - 1]! });
      i--;
    }
  }

  ops.reverse();
  return ops;
}

// ─── Segment Builder ──────────────────────────────────────────────────────────

/**
 * Groups an array of character operations into merged DiffSegments.
 * Ensures no two adjacent segments have the same type.
 */
function buildSegments(chars: string[], types: ('same' | 'changed')[]): DiffSegment[] {
  if (chars.length === 0) return [];

  const segments: DiffSegment[] = [];
  let currentText = chars[0]!;
  let currentType = types[0]!;

  for (let i = 1; i < chars.length; i++) {
    if (types[i] === currentType) {
      currentText += chars[i];
    } else {
      segments.push({ text: currentText, type: currentType });
      currentText = chars[i]!;
      currentType = types[i]!;
    }
  }
  segments.push({ text: currentText, type: currentType });

  return segments;
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Computes intra-line diff between a pair of old and new line strings.
 *
 * @param oldLine - Content of the deletion line (without leading `-`)
 * @param newLine - Content of the addition line (without leading `+`)
 * @returns Segments for both lines, tagged as 'same' or 'changed'
 */
export function computeIntraLineDiff(oldLine: string, newLine: string): IntraLineDiffResult {
  // Edge cases: one or both empty
  if (oldLine === '' && newLine === '') {
    return { oldSegments: [], newSegments: [] };
  }
  if (oldLine === '') {
    return {
      oldSegments: [],
      newSegments: newLine ? [{ text: newLine, type: 'changed' }] : [],
    };
  }
  if (newLine === '') {
    return {
      oldSegments: oldLine ? [{ text: oldLine, type: 'changed' }] : [],
      newSegments: [],
    };
  }

  // Build LCS and backtrack to get character-level ops
  const dp = buildLCSTable(oldLine, newLine);
  const ops = backtrackLCS(oldLine, newLine, dp);

  // Separate ops into old-line characters and new-line characters
  const oldChars: string[] = [];
  const oldTypes: ('same' | 'changed')[] = [];
  const newChars: string[] = [];
  const newTypes: ('same' | 'changed')[] = [];

  for (const op of ops) {
    if (op.type === 'same') {
      oldChars.push(op.char);
      oldTypes.push('same');
      newChars.push(op.char);
      newTypes.push('same');
    } else if (op.type === 'old-changed') {
      oldChars.push(op.char);
      oldTypes.push('changed');
    } else {
      newChars.push(op.char);
      newTypes.push('changed');
    }
  }

  return {
    oldSegments: buildSegments(oldChars, oldTypes),
    newSegments: buildSegments(newChars, newTypes),
  };
}
