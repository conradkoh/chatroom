export interface SearchConfigEntry {
  harnessName: string;
  modelKey: string; // "providerID::modelID"
}

export function buildSearchConfigKey(entry: SearchConfigEntry): string {
  return `${entry.harnessName}|${entry.modelKey}`;
}

export function searchConfigEntriesEqual(a: SearchConfigEntry, b: SearchConfigEntry): boolean {
  return a.harnessName === b.harnessName && a.modelKey === b.modelKey;
}
