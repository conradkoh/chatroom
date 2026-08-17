# Workspace file tree — tech debt tracker

Living checklist for file-tree sync, explorer hydration, and debug tooling. Update as items are resolved.

## Open

- [ ] **Explorer empty-state vs loading** — `idle` with no cache still shows "No files found" instead of a distinct "never synced" state; consider dedicated `awaiting-daemon` plan kind when checkpoint/manifest are null and a pending request exists.
- [ ] **useWorkspaceFileTreeEntries loading SSOT** — entries hook still computes `isLoading = !hasTree` independently; explorer should not rely on it (partially addressed via `useWorkspaceFileTree.isLoading`).
- [ ] **FileTreeSyncStatus in UI** — deferred; user declined a debug panel.
- [ ] **workspaceFiles decomposition** — transport/repos extracted but `workspaceFiles.ts` convex module remains large; continue phased extraction per memory/architecture/workspace-file-tree-sync-strategies.md.

## Resolved (this branch)

- [x] **Force refresh stuck pending** — `requestWorkspaceFileTree` bumps `updatedAt` on force; pending query returns `updatedAt`; daemon subscriber uses snapshot dedup instead of one-shot `seen` ids.
- [x] **Silent mutation failures** — request failures surface a toast.
- [x] **Hydration recover timeout** — recover loading times out with retryable error.
- [x] **CLI status filtering** — pending status is filtered by working directory.
- [x] **Subscriber parity** — content/write subscribers use snapshot dedup.
- [x] **Recover shows empty explorer** — `isFileTreeHydrationLoading` returns true for `recover` plans.
- [x] **Explorer refresh wiring** — `useWorkspaceDirExplorer.refresh` calls both tree hydration and entries refresh with `force: true`.
- [x] **CLI debug commands** — `chatroom workspace file-tree request` and `chatroom workspace file-tree status`.
- [x] **requestFileTree use case** — `services/backend/src/domain/usecase/workspace/request-workspace-file-tree.ts`.

## Related

- [Workspace file tree sync strategies](architecture/workspace-file-tree-sync-strategies.md)
- Backlog item `ps77aqheb1an53az65c446rfdd8cmtgd` — workspace file-tree tech debt resolution
