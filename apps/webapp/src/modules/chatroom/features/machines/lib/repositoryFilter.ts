import type { LedgerEntryView } from '../hooks/useRepositoryLedger';

function matchesNeedle(entry: LedgerEntryView, needle: string): boolean {
  return [entry.name, entry.path, entry.branch ?? ''].some((field) =>
    field.toLowerCase().includes(needle)
  );
}

/**
 * Entries whose name, path, or branch contains the filter, case-insensitively, in list order.
 * The filter is trimmed. An empty filter returns the input array itself.
 */
export function filterRepositories(entries: LedgerEntryView[], filter: string): LedgerEntryView[] {
  const needle = filter.trim().toLowerCase();
  if (needle === '') return entries;
  return entries.filter((entry) => matchesNeedle(entry, needle));
}
