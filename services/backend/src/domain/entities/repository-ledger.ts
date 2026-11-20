import { v } from 'convex/values';

/** Max repositories stored for one snapshot. Extra entries are dropped and the snapshot is marked truncated. */
export const LEDGER_MAX_ENTRIES = 1000;
/** Max length of an entry's `path` and `root`, and of a root's `path`. Over-long values are dropped and counted, never truncated. */
export const LEDGER_MAX_PATH_LENGTH = 1024;
/** Max length of a failed report's `errorMessage`. Longer text is cut to this length; the report is never rejected. */
export const LEDGER_MAX_ERROR_MESSAGE_LENGTH = 2000;
/** Max length of an entry's `name`. */
export const LEDGER_MAX_NAME_LENGTH = 256;
/** Max length of an entry's `branch`. */
export const LEDGER_MAX_BRANCH_LENGTH = 256;
/** Max length of an entry's `remoteUrl`. */
export const LEDGER_MAX_REMOTE_URL_LENGTH = 2048;
/** Max roots stored per snapshot. Extra roots are dropped; the report still completes. */
export const LEDGER_MAX_ROOTS = 20;
/** Entries per chunk row. 100 entries stays well under the 1 MiB document limit. */
export const LEDGER_CHUNK_SIZE = 100;
/** Max chunk rows per snapshot. */
export const LEDGER_MAX_CHUNKS = LEDGER_MAX_ENTRIES / LEDGER_CHUNK_SIZE;
/** Max working directories accepted by one bulk create call. */
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
