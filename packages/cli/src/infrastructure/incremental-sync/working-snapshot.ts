/**
 * In-memory working snapshot — merged from reconcile polls and incremental signals.
 * Not durable; reconcile poll re-authorizes from Convex on each refresh.
 */
// fallow-ignore-file unused-class-member

export type MergeSignalFn<TRow, TSignal> = (
  existing: TRow | undefined,
  signal: TSignal
) => TRow | undefined;

export interface WorkingSnapshotOptions<TRow, TSignal> {
  readonly rowKey: (row: TRow) => string;
  readonly signalKey: (signal: TSignal) => string;
  readonly mergeSignal: MergeSignalFn<TRow, TSignal>;
}

/** Daemon-side map between reconcile ticks; Convex wins on every reconcile replaceAll. */
export class WorkingSnapshot<TRow, TSignal> {
  private readonly rows = new Map<string, TRow>();

  constructor(private readonly opts: WorkingSnapshotOptions<TRow, TSignal>) {}

  replaceAll(rows: readonly TRow[]): void {
    this.rows.clear();
    for (const row of rows) {
      this.rows.set(this.opts.rowKey(row), row);
    }
  }

  getByKey(key: string): TRow | undefined {
    return this.rows.get(key);
  }

  upsertRow(row: TRow): void {
    this.rows.set(this.opts.rowKey(row), row);
  }

  getBySignal(signal: TSignal): TRow | undefined {
    return this.rows.get(this.opts.signalKey(signal));
  }

  mergeSignal(signal: TSignal): TRow | undefined {
    const key = this.opts.signalKey(signal);
    const merged = this.opts.mergeSignal(this.rows.get(key), signal);
    if (!merged) {
      return undefined;
    }
    this.rows.set(key, merged);
    return merged;
  }
}
