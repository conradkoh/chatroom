/** Max gap without UI renewal before daemon stops pushing. */
export const FILE_TREE_WATCH_LEASE_MS = 10 * 60 * 1000;

/** UI heartbeat interval while Explorer / @ autocomplete holds a lease. */
export const FILE_TREE_WATCH_RENEW_INTERVAL_MS = 3 * 60 * 1000;

/** Snapshot/request staleness for requestFileTree and Cmd+P freshness. */
export const FILE_TREE_SNAPSHOT_STALENESS_MS = 10 * 60 * 1000;
