import { v } from 'convex/values';

/** Max repositories stored for one snapshot. Extra entries are dropped and the snapshot is marked truncated. */
export const LEDGER_MAX_ENTRIES = 1000;
/** Entries per chunk row. 100 entries stays well under the 1 MiB document limit. */
export const LEDGER_CHUNK_SIZE = 100;
/** Max chunk rows per snapshot. */
export const LEDGER_MAX_CHUNKS = LEDGER_MAX_ENTRIES / LEDGER_CHUNK_SIZE;
/** Max working directories accepted by one bulk create call. */
// Consumer lands in slice 3A-4 (bulk create); remove this suppression then.
// fallow-ignore-next-line unused-export
export const BULK_CREATE_MAX_REPOSITORIES = 50;

const ledgerRootStatusValidator = v.union(
  v.literal('ok'),
  v.literal('missing'),
  v.literal('unreadable')
);

export const ledgerRootValidator = v.object({
  path: v.string(),
  status: ledgerRootStatusValidator,
  repositoryCount: v.number(),
});

export const ledgerEntryValidator = v.object({
  path: v.string(),
  name: v.string(),
  root: v.string(),
  branch: v.optional(v.string()),
  remoteUrl: v.optional(v.string()),
  discoveredAt: v.number(),
});
