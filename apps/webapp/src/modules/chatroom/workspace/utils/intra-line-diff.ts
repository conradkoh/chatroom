/**
 * Intra-line diff utility — token-level diff for paired deletion/addition lines.
 *
 * Uses a token-level LCS (Longest Common Subsequence) to identify which
 * parts of two strings are the same and which have changed. Operates on
 * tokens (words, whitespace runs, individual punctuation) rather than
 * individual characters, producing coherent word-level highlights.
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

// ─── Tokenizer ────────────────────────────────────────────────────────────────

/**
 * Splits a string into tokens: word runs, whitespace runs, and individual
 * punctuation/symbols.
 *
 * Examples:
 *   "sha: string;" → ["sha", ":", " ", "string", ";"]
 *   'const name = "Alice";' → ["const", " ", "name", " ", "=", " ", '"', "Alice", '"', ";"]
 */
export function tokenize(s: string): string[] {
  return s.match(/\w+|\s+|[^\w\s]/g) ?? [];
}

// ─── LCS Implementation ───────────────────────────────────────────────────────

/**
 * Computes the Longest Common Subsequence length table for two token arrays.
 * Returns a 2D array where dp[i][j] = LCS length of a[0..i-1] and b[0..j-1].
 */
function buildLCSTable(a: string[], b: string[]): number[][] {
  const m = a.length;
  const n = b.length;
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

type TokenOp =
  | { type: 'same'; token: string }
  | { type: 'old-changed'; token: string }
  | { type: 'new-changed'; token: string };

/**
 * Backtracks through the LCS table to produce token-level edit operations.
 */
function backtrackLCS(a: string[], b: string[], dp: number[][]): TokenOp[] {
  const ops: TokenOp[] = [];
  let i = a.length;
  let j = b.length;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ type: 'same', token: a[i - 1]! });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i]![j - 1]! >= dp[i - 1]![j]!)) {
      ops.push({ type: 'new-changed', token: b[j - 1]! });
      j--;
    } else {
      ops.push({ type: 'old-changed', token: a[i - 1]! });
      i--;
    }
  }

  ops.reverse();
  return ops;
}

// ─── Segment Builder ──────────────────────────────────────────────────────────

/**
 * Groups token ops into merged DiffSegments.
 * Adjacent tokens of the same type are concatenated into one segment.
 */
function buildSegments(tokens: string[], types: ('same' | 'changed')[]): DiffSegment[] {
  if (tokens.length === 0) return [];

  const segments: DiffSegment[] = [];
  let currentText = tokens[0]!;
  let currentType = types[0]!;

  for (let i = 1; i < tokens.length; i++) {
    if (types[i] === currentType) {
      currentText += tokens[i];
    } else {
      segments.push({ text: currentText, type: currentType });
      currentText = tokens[i]!;
      currentType = types[i]!;
    }
  }
  segments.push({ text: currentText, type: currentType });

  return segments;
}

// ─── Main Export ──────────────────────────────────────────────────────────────

/**
 * Computes intra-line diff between a pair of old and new line strings.
 * Uses token-level LCS for coherent word/symbol-level highlighting.
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

  // Tokenize both lines
  const oldTokens = tokenize(oldLine);
  const newTokens = tokenize(newLine);

  // Build LCS on token arrays and backtrack
  const dp = buildLCSTable(oldTokens, newTokens);
  const ops = backtrackLCS(oldTokens, newTokens, dp);

  // Separate ops into old-line tokens and new-line tokens
  const oldTokenList: string[] = [];
  const oldTypes: ('same' | 'changed')[] = [];
  const newTokenList: string[] = [];
  const newTypes: ('same' | 'changed')[] = [];

  for (const op of ops) {
    if (op.type === 'same') {
      oldTokenList.push(op.token);
      oldTypes.push('same');
      newTokenList.push(op.token);
      newTypes.push('same');
    } else if (op.type === 'old-changed') {
      oldTokenList.push(op.token);
      oldTypes.push('changed');
    } else {
      newTokenList.push(op.token);
      newTypes.push('changed');
    }
  }

  return {
    oldSegments: buildSegments(oldTokenList, oldTypes),
    newSegments: buildSegments(newTokenList, newTypes),
  };
}
