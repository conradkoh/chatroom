function scoreSearchMatch(text: string, query: string, tokens: string[]): number {
  const phraseBonus = text.includes(query) ? 1000 : 0;
  if (tokens.length === 1) return phraseBonus;

  const tokenPositionScore = tokens.reduce((score, token) => {
    const index = text.indexOf(token);
    return score + Math.max(0, 100 - index);
  }, 0);
  return phraseBonus + tokenPositionScore;
}

export function filterPickerItems<T>(
  items: readonly T[],
  searchTerm: string,
  getSearchText: (item: T) => string
): T[] {
  const query = searchTerm.trim().toLowerCase();
  if (!query) return [...items];

  // Every token must match; scores rank phrases, then earlier matches, with stable ties.
  const tokens = query.split(/\s+/);
  return items
    .map((item, index) => {
      const text = getSearchText(item).toLowerCase();
      if (!tokens.every((token) => text.includes(token))) return null;
      return { item, index, score: scoreSearchMatch(text, query, tokens) };
    })
    .filter((result): result is { item: T; index: number; score: number } => result !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map(({ item }) => item);
}
