/**
 * Cold-hydrate helper when incremental merge cannot build a row from signal alone.
 */

export interface SnapshotRowResolver<TRow, TSignal> {
  mergeSignal(signal: TSignal): TRow | undefined;
  getBySignal(signal: TSignal): TRow | undefined;
  replaceAll(rows: readonly TRow[]): void;
}

export async function resolveSnapshotRowForSignal<TRow, TSignal>(
  snapshot: SnapshotRowResolver<TRow, TSignal>,
  signal: TSignal,
  hydrate: () => Promise<readonly TRow[]>
): Promise<TRow | undefined> {
  const merged = snapshot.mergeSignal(signal);
  if (merged) return merged;

  snapshot.replaceAll(await hydrate());
  return snapshot.mergeSignal(signal) ?? snapshot.getBySignal(signal);
}
