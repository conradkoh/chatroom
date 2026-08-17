# Workspace file tree — tech debt tracker

Living checklist for file-tree sync, explorer hydration, and debug tooling. Update as items are resolved.

## Open

- [ ] **Explorer empty-state vs loading** — `idle` with no cache still shows "No files found" instead of a distinct "never synced" state; consider dedicated `awaiting-daemon` plan kind when checkpoint/manifest are null and a pending request exists.
- [ ] **Silent mutation failures** — `useRequestWorkspaceFileTree` swallows `requestFileTree` errors; surface toast or dev console warning on auth/network failure.
- [ ] **useWorkspaceFileTreeEntries loading SSOT** — entries hook still computes `isLoading = !hasTree` independently; explorer should not rely on it (partially addressed via `useWorkspaceFileTree.isLoading`).
- [ ] **FileTreeSyncStatus in UI** — expose checkpoint/manifest/pending status in explorer header or debug panel for support.
- [ ] **CLI status filtering** — `workspace file-tree status` returns all machine pending requests; add optional `--working-dir` filter on pending list in API.
- [ ] **Subscriber parity** — file-content and file-write subscribers may use the same stale `seen` id pattern; audit and align with file-tree snapshot dedup.
- [ ] **Hydration recover timeout** — recover plan shows loading indefinitely if daemon never fulfills; add timeout + user-visible error with retry.
- [ ] **workspaceFiles decomposition** — transport/repos extracted but `workspaceFiles.ts` convex module remains large; continue phased extraction per memory/architecture/workspace-file-tree-sync-strategies.md.

## Resolved (this branch)

- [x] **Force refresh stuck pending** — `requestWorkspaceFileTree` bumps `updatedAt` on force; pending query returns `updatedAt`; daemon subscriber uses snapshot dedup instead of one-shot `seen` ids.
- [x] **Recover shows empty explorer** — `isFileTreeHydrationLoading` returns true for `recover` plans.
- [x] **Explorer refresh wiring** — `useWorkspaceDirExplorer.refresh` calls both tree hydration and entries refresh with `force: true`.
- [x] **CLI debug commands** — `chatroom workspace file-tree request` and `chatroom workspace file-tree status`.
- [x] **requestFileTree use case** — `services/backend/src/domain/usecase/workspace/request-workspace-file-tree.ts`.

## Related

- [Workspace file tree sync strategies](architecture/workspace-file-tree-sync-strategies.md)
- Backlog item `ps77aqheb1an53az65c446rfdd8cmtgd` — workspace file-tree tech debt resolution
