export function filterPickerItems<T>(
  items: readonly T[],
  searchTerm: string,
  getSearchText: (item: T) => string
): T[] {
  const term = searchTerm.trim().toLowerCase();
  if (!term) return [...items];
  return items.filter((item) => getSearchText(item).toLowerCase().includes(term));
}
