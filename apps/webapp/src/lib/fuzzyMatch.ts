/**
 * VSCode-style fuzzy string matching.
 *
 * Characters in the query must appear in order in the target, but not
 * necessarily contiguously. Scoring bonuses are awarded for:
 * - Consecutive character matches
 * - Matches at word boundaries (after `/`, `.`, `-`, `_`, space, or camelCase transitions)
 * - Exact prefix matches
 *
 * @param query  The search string (what the user typed)
 * @param target The string to match against
 * @returns A score ≥ 0. 0 means no match; higher is better.
 */
export function fuzzyMatch(query: string, target: string): number {
  if (query.length === 0) return 1; // empty query matches everything
  if (target.length === 0) return 0;

  const q = query.toLowerCase();
  const t = target.toLowerCase();

  // Single pass: match characters in order and score simultaneously
  let score = 0;
  let consecutive = 0;
  let qi = 0;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      // Base score for each matched character
      score += 1;

      // Consecutive match bonus (grows with streak length)
      consecutive++;
      score += consecutive;

      // Word boundary bonus: match at start or after separator/camelCase
      if (ti === 0) {
        score += 8; // Prefix match — strongest bonus
      } else {
        const prev = target[ti - 1]!;
        const curr = target[ti]!;
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

  // All query characters must have matched
  return qi === q.length ? score : 0;
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
