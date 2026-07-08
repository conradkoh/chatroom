# Convex Local Backend: Stale Export Fix

> **Context as of 2026-07-08.** This document captures our understanding of the Convex local backend stale-export issue based on analysis of [`get-convex/convex-backend`](https://github.com/get-convex/convex-backend) at commit `3461a926`. When you revisit this guide later, treat the date as a freshness signal — upstream code and Convex versions may have changed. Use the [automated fix script](#automated-fix-recommended) for the operational fix, and see [Updating this guide](#updating-this-guide) for how to refresh our understanding.

## Problem

When upgrading the local Convex backend (e.g. via `npx convex dev`), the upgrade process fails with:

```
Error fetching POST http://127.0.0.1:3210/api/export/request/zip?includeStorage=true 400 Bad Request: ExportInProgress: There is already an export requested or in progress.
```

This happens when a previous upgrade attempt crashed mid-export, leaving the export state stuck in a non-terminal state (`Requested` or `InProgress`). The state persists across backend restarts because it's stored in SQLite and never auto-cleaned for non-terminal states.

## Repo Information

- **Repository**: [get-convex/convex-backend](https://github.com/get-convex/convex-backend)
- **Branch used for analysis**: `main` (cloned at commit 3461a926)
- **Local clone path**: `/tmp/convex-backend`

## Error Trace

### 1. CLI triggers upgrade

**File**: `npm-packages/convex/src/cli/lib/localDeployment/upgrade.ts`

The upgrade flow starts the old backend, then calls `startSnapshotExport()` to export data before switching versions:

```ts
const snapshotExportState = await startSnapshotExport(ctx, {
  deploymentUrl,
  adminKey,
  includeStorage: true,
  inputPath: exportPath,
});
```

### 2. CLI POSTs to the backend API

**File**: `npm-packages/convex/src/cli/lib/convexExport.ts` (line ~167)

```ts
await fetch(`/api/export/request/zip?includeStorage=${args.includeStorage}`, { method: 'POST' });
```

### 3. HTTP handler receives the request

**File**: `crates/local_backend/src/snapshot_export.rs`

```rust
pub async fn request_zip_export(
    MtState(st): MtState,
    ...
) -> Result<StatusCode> {
    st.application.request_export(...).await?;
    Ok(StatusCode::OK)
}
```

### 4. Application layer checks for existing exports

**File**: `crates/application/src/lib.rs` (line ~1590–1620)

This is where the error originates:

```rust
let export_requested = exports_model.latest_requested().await?;
let export_in_progress = exports_model.latest_in_progress().await?;

match (export_requested, export_in_progress) {
    (None, None) => {
        // OK — no existing export, insert new one
        exports_model.insert_requested(...).await
    },
    _ => Err(
        anyhow::anyhow!("Can only have one export requested or in progress at once")
            .context(ErrorMetadata::bad_request(
                "ExportInProgress",
                "There is already an export requested or in progress.",
            )),
    ),
}?;
```

### 5. DB query against the `_exports` system table

**File**: `crates/model/src/exports/mod.rs`

The state check queries via index `by_state_and_ts`:

```rust
async fn export_in_state(&mut self, export_state: &str) -> ... {
    self.tx.query_system(TableNamespace::Global, &*EXPORTS_BY_STATE_AND_TS_INDEX)?
        .eq(&[export_state])?
        .unique()
        .await?
}
```

### 6. Export state machine

**File**: `crates/model/src/exports/types.rs`

Valid transitions:

| State        | Transitions to                          |
| ------------ | --------------------------------------- |
| `Requested`  | → `InProgress`, → `Canceled`            |
| `InProgress` | → `Completed`, → `Failed`, → `Canceled` |
| `Completed`  | terminal                                |
| `Failed`     | terminal                                |
| `Canceled`   | terminal                                |

**The bug**: Non-terminal states (`Requested`, `InProgress`) are never cleaned up. Only `Completed`, `Failed`, and `Canceled` entries get deleted by the retention cleanup logic. A crashed export leaves a permanent blocker.

## Automated Fix (Recommended)

The fix is automated by [`scripts/fix-convex-stale-exports.ts`](../../scripts/fix-convex-stale-exports.ts) (run via `pnpm fix:convex-stale-exports`). The script's `--help` output also points back to this document for background context.

Run the bundled Bun script to clear stale non-terminal exports:

```bash
pnpm fix:convex-stale-exports
```

Preview what would be deleted without making changes:

```bash
pnpm fix:convex-stale-exports -- --dry-run
```

Delete all export records (nuclear option):

```bash
pnpm fix:convex-stale-exports -- --all
```

The script uses Bun's built-in SQLite driver (`bun:sqlite`) and targets the default local database at `services/backend/.convex/local/default/convex_local_backend.sqlite3`. Use `--db-path` to override.

## How to Fix: Clear Stale Exports via SQLite

If you prefer manual steps or the script is unavailable, use SQLite directly:

### Locate the database

```
services/backend/.convex/local/default/convex_local_backend.sqlite3
```

### Inspect current exports

```bash
sqlite3 services/backend/.convex/local/default/convex_local_backend.sqlite3 \
  "SELECT id, state, start_ts, expiration_ts FROM _exports;"
```

This shows all export records. Look for rows where `state` is `requested` or `in_progress`.

### Delete stale (non-terminal) exports

```bash
sqlite3 services/backend/.convex/local/default/convex_local_backend.sqlite3 \
  "DELETE FROM _exports WHERE state IN ('requested', 'in_progress');"
```

This removes only stuck non-terminal entries. Terminal states (`completed`, `failed`, `canceled`) are left alone since they're already cleaned up by retention or can be safely ignored.

### Verify the fix

```bash
sqlite3 services/backend/.convex/local/default/convex_local_backend.sqlite3 \
  "SELECT id, state FROM _exports;"
```

No rows with `requested` or `in_progress` should remain. Then run `pnpm dev` again — the upgrade/export will proceed normally.

### Alternative: Delete all exports (nuclear option)

If you don't care about preserving any export history:

```bash
sqlite3 services/backend/.convex/local/default/convex_local_backend.sqlite3 \
  "DELETE FROM _exports;"
```

## Prevention

The root cause is that the upgrade process doesn't clean up stale exports before attempting a new one. A fix in `upgrade.ts` could cancel any existing export before calling `startSnapshotExport()`:

```ts
// Before startSnapshotExport, cancel any pending export:
const existingExports = await listExports(deploymentUrl, adminKey);
for (const exp of existingExports) {
  if (exp.state === 'requested' || exp.state === 'in_progress') {
    await cancelExport(deploymentUrl, adminKey, exp.id);
  }
}
```

This would require exposing a `list_exports` and `cancel_export` endpoint to the CLI.

## Updating this guide

When Convex or the local backend changes, refresh this document so future readers are not working from stale analysis:

1. **Reproduce or confirm the issue** — capture the exact error message and Convex/backend versions in use.
2. **Re-clone or update the upstream repo** — see [Repo Information](#repo-information) for the clone path and branch used during analysis.
3. **Trace the code path** — follow the error from CLI → HTTP handler → application layer → `_exports` table (sections above show the last known trace).
4. **Update the as-of date** at the top of this file to today's date.
5. **Verify the automated fix still applies** — run `pnpm fix:convex-stale-exports -- --dry-run` against a local database with stuck exports, or inspect `_exports` manually per [How to Fix: Clear Stale Exports via SQLite](#how-to-fix-clear-stale-exports-via-sqlite).
6. **Adjust the script if needed** — implementation lives in [`scripts/fix-convex-stale-exports.ts`](../../scripts/fix-convex-stale-exports.ts); keep its `--help` text in sync with any doc changes.
