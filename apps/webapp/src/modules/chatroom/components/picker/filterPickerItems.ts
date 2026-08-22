function scoreSearchMatch(text: string, query: string, tokens: string[]): number {
  const phraseBonus = text.includes(query) ? 1000 : 0;
  // Matching all tokens is the primary signal; stable input order breaks ties.
  return phraseBonus + tokens.length;
}

export function filterPickerItems<T>(
  items: readonly T[],
  searchTerm: string,
  getSearchText: (item: T) => string
): T[] {
  const query = searchTerm.trim().toLowerCase();
  if (!query) return [...items];

  // Every token must match; scores rank contiguous phrases first and stay stable for ties.
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
