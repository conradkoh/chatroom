/**
 * VSCode-style fuzzy string matching.
 *
 * Characters in the query must appear in order in the target, but not
 * necessarily contiguously. Scoring bonuses are awarded for:
 * - Consecutive character matches
 * - Matches at word boundaries (after `/`, `.`, `-`, `_`, space, or camelCase transitions)
 * - Exact prefix matches
 * - Word/segment prefix matches (e.g. repo → Repository, Repos)
 *
 * Scattered matches are penalized: each gap between matched characters
 * reduces the score, so "package.json" strongly prefers files named
 * `package.json` over random paths where those characters appear scattered.
 *
 * @param query  The search string (what the user typed)
 * @param target The string to match against
 * @returns A score ≥ 0. 0 means no match; higher is better.
 */

/** Split on path separators, punctuation, whitespace, and camelCase boundaries. */
const WORD_SPLIT = /[/\\._\-\s:]+|(?<=[a-z])(?=[A-Z])/;

/**
 * Score when query matches the start (or interior substring) of any word/segment.
 * Handles repo → Repository, Repos, repository-bridge, etc.
 */
// fallow-ignore-next-line complexity
function scoreWordPrefixMatch(query: string, target: string): number {
  if (query.length === 0) return 1;
  const q = query.toLowerCase();
  let best = 0;

  for (const segment of target.split(/[/\\]+/).filter(Boolean)) {
    const segmentBase = (segment.split('.')[0] ?? segment).toLowerCase();
    const words = segment.split(WORD_SPLIT).filter(Boolean);

    for (const word of words) {
      const w = word.toLowerCase();
      if (w.startsWith(q)) {
        const overlapRatio = q.length / w.length;
        const lengthBonus = w.length > q.length ? w.length : 0;
        const segmentMatchBonus = segmentBase === w ? 15 : 0;
        const wordScore = 24 + overlapRatio * 12 + lengthBonus + segmentMatchBonus;
        best = Math.max(best, wordScore);
      } else if (q.length >= 3 && w.includes(q)) {
        best = Math.max(best, 12 + q.length);
      }
    }
  }

  return best;
}

// fallow-ignore-next-line complexity
export function fuzzyMatch(query: string, target: string): number {
  if (query.length === 0) return 1; // empty query matches everything
  if (target.length === 0) return 0;

  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const prefixScore = scoreWordPrefixMatch(q, target);

  // Single pass: match characters in order and score simultaneously
  let score = 0;
  let consecutive = 0;
  let totalGaps = 0;
  let qi = 0;
  let lastMatchIndex = -1;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      // Base score for each matched character
      score += 1;

      // Consecutive match bonus (grows with streak length)
      consecutive++;
      score += consecutive;

      // Track gaps between matched characters (not counted for first match)
      if (lastMatchIndex >= 0) {
        const gap = ti - lastMatchIndex - 1;
        totalGaps += gap;
      }
      lastMatchIndex = ti;

      // Word boundary bonus: match at start or after separator/camelCase
      if (ti === 0) {
        score += 8; // Prefix match — strongest bonus
      } else {
        const prev = target.charAt(ti - 1);
        const curr = target.charAt(ti);
        const isSeparator = '/.-_ '.includes(prev);
        const isCamelBoundary =
          prev === prev.toLowerCase() && curr === curr.toUpperCase() && curr !== curr.toLowerCase();

        if (isSeparator || isCamelBoundary) {
          score += 5; // Word boundary bonus
        }
      }

      qi++;
    } else {
      consecutive = 0; // Reset streak
    }
  }

  // All query characters must have matched for greedy scoring
  if (qi !== q.length) return prefixScore;

  // Suffix/extension match bonus: if the query matches the end of the target
  // (e.g., searching ".csv" matches "data.csv" at the end), give a strong bonus.
  // This ensures extension searches rank exact extension matches highest.
  if (t.endsWith(q)) {
    score += 10;
  }

  // Gap penalty: penalize scattered matches. Each gap character between
  // matched characters reduces the score. This prevents "package.json" from
  // matching every file whose path happens to contain those characters.
  score -= totalGaps * 0.5;

  // Minimum quality threshold: for queries longer than 3 characters, require
  // a minimum score proportional to query length. This filters out extremely
  // weak matches where characters are spread across the entire path.
  if (q.length > 3) {
    // A reasonable match should score at least 2 points per query character.
    // A perfect consecutive match scores ~N*(N+1)/2 + N, so 2*N is a low bar
    // that still eliminates very scattered matches.
    const minScore = q.length * 2;
    if (score < minScore) return prefixScore;
  }

  const finalGreedy = Math.max(0, score);
  const qualityBar = q.length * 4;
  if (prefixScore > 0 && finalGreedy < qualityBar) {
    return Math.max(prefixScore, finalGreedy);
  }
  return finalGreedy;
}

/**
 * cmdk-compatible filter function.
 *
 * `<Command filter={fuzzyFilter}>` — cmdk calls `filter(value, search)` for
 * each item. Returns 0 for no match, or a positive number (used for ranking;
 * higher = better). cmdk treats any value > 0 as a match.
 */
export function fuzzyFilter(value: string, search: string, keywords?: string[]): number {
  const valueScore = fuzzyMatch(search, value);

  if (!keywords || keywords.length === 0) return valueScore;

  let maxScore = valueScore;
  for (const keyword of keywords) {
    const keywordScore = fuzzyMatch(search, keyword);
    if (keywordScore > maxScore) maxScore = keywordScore;
  }

  return maxScore;
}
