# Chatroom client store conventions

This document defines how client-side state ("stores") is organized in the chatroom webapp. It complements [legend-state-signals.md](./legend-state-signals.md), which covers the long-term target for complex delta stores.

## Principles

1. **Stores own client state** — persistence, merge logic, and read/write API live in `*Store.ts` modules (no React, no Convex).
2. **Hooks are thin adapters** — components call hooks, not `getXxxStore()` directly.
3. **Convex is server SSOT** — durable user data (favorites, settings) lives in Convex. Device-local frécency/usage uses localStorage stores.
4. **Feature-colocated** — new domain stores live under `features/<domain>/`, not scattered in top-level `lib/`.

## Folder layout

```
apps/webapp/src/modules/chatroom/
  features/
    <domain>/                    # e.g. machine-config, search-config, run-command
      stores/
        <name>Store.ts           # Pure client store module
        <name>Store.test.ts
      hooks/
        use<Name>Store.ts        # React binding (useSyncExternalStore)
        use<Domain>.ts           # Convex-backed or composite hook
      lib/                       # Domain-only pure helpers (compute*, sort*)
        compute<Thing>.ts
      types/                     # Domain types once moved out of top-level types/
      README.md                  # Domain-specific notes (optional)
  lib/                           # Shared primitives (frecencyScoring, teamRoleKey)
  types/                         # Shared types until moved into a feature
  workspace/                     # Workspace UI domain (file tree store still here — see migration)
```

## Store module contract (`*Store.ts`)

- Export `getXxxStore()` singleton accessor; keep the class private.
- Export `subscribeXxx(listener): unsubscribe` for React binding.
- Export a revision/snapshot getter for `useSyncExternalStore` (e.g. `getXxxRevision()`).
- Include `clear()` for tests.
- localStorage keys: `chatroom:<domain>-<purpose>` with a versioned schema.
- SSR-safe: guard `typeof window === 'undefined'`.
- Call `emit()` (or equivalent) after every mutation so subscribers update.

**Reference implementations:**

- [features/machine-config/stores/machineConfigUsageStore.ts](../../apps/webapp/src/modules/chatroom/features/machine-config/stores/machineConfigUsageStore.ts) — first adopter
- [features/search-config/stores/searchConfigUsageStore.ts](../../apps/webapp/src/modules/chatroom/features/search-config/stores/searchConfigUsageStore.ts) — second adopter (same layout)

## React hook contract

| Hook name           | Role                                                   |
| ------------------- | ------------------------------------------------------ |
| `use<Name>Store.ts` | Binds a client store via `useSyncExternalStore`        |
| `use<Domain>.ts`    | Convex query/mutation only, or composes multiple hooks |

- No business logic in binding hooks — delegate to store methods or pure `lib/` helpers.
- Never copy store data into `useState` via `useEffect`.
- Prefer `useSyncExternalStore` + store revision over a local `useState` version bump after mutations.

**Reference implementations:**

- [features/machine-config/hooks/useMachineConfigUsage.ts](../../apps/webapp/src/modules/chatroom/features/machine-config/hooks/useMachineConfigUsage.ts)
- [features/search-config/hooks/useSearchConfigUsage.ts](../../apps/webapp/src/modules/chatroom/features/search-config/hooks/useSearchConfigUsage.ts)

## Server vs local persistence

| Data                                   | Where                  | Example                                           |
| -------------------------------------- | ---------------------- | ------------------------------------------------- |
| User preferences (sync across devices) | Convex                 | Machine-config favorites, search-config favorites |
| Frécency / usage telemetry             | localStorage store     | Machine-config usage, command usage               |
| Ephemeral UI caches                    | In-memory module store | Workspace file tree                               |

## Component rules

- Import hooks from `features/<domain>/hooks/` (or the domain's public hooks), not store modules.
- Fire-and-forget mutations go through hook methods (e.g. `recordUsage()`), not `getXxxStore()`.
- Tests may call `getXxxStore().clear()` for isolation; production UI components must not.

## Incremental migration status (as of v1.70.x)

### Done

| Item                                               | Notes                                                                                                                                                                |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Machine-config usage store + usage/favorites hooks | Under `features/machine-config/`. Legacy re-export shims (`lib/machineConfigUsageStore.ts`, top-level `hooks/useMachineConfigFavorites.ts`) are **already removed**. |
| Search-config feature                              | Under `features/search-config/` with `stores/` + `hooks/` + `types/` — follows this layout. Not listed in older migration checklists.                                |

### Remaining

| Priority | Item                                  | Current location                                                                     | Target / action                                                                                                                                                                                                                                                                              |
| -------- | ------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | Command usage store                   | `lib/commandUsageStore.ts`                                                           | Move to `features/run-command/stores/`. Add `subscribe` + revision; replace version-bump in `hooks/useCommandRanking.ts`.                                                                                                                                                                    |
| 1        | Command favorites store               | `lib/commandFavoritesStore.ts` + `features/run-command/hooks/useCommandFavorites.ts` | Move store under `features/run-command/stores/`. Replace version-bump with `useSyncExternalStore`. Stop direct `getCommandFavoritesStore()` / `getCommandUsageStore()` from `components/CommandPalette/useCommandPaletteCommands.tsx`.                                                       |
| 2        | Machine-config types + ranking helper | `types/machineConfig.ts`, `lib/computeRecommendedMachineConfigs.ts`                  | Move into `features/machine-config/types/` and `features/machine-config/lib/`.                                                                                                                                                                                                               |
| 2        | Machine scope key helpers             | `lib/teamRoleKey.ts` (`buildMachineFavoriteScopeKey`, `buildMachineConfigScopeKey`)  | Prefer moving **only** the machine-scoped helpers into `features/machine-config/lib/`. Keep `buildTeamRoleKey` (and any shared key helpers) in `lib/teamRoleKey.ts` for parity with `services/backend/convex/utils/teamRoleKey.ts` — do **not** relocate the whole file into machine-config. |
| 3        | Workspace file tree store             | `workspace/files/workspaceFileTreeStore.ts`                                          | Already has `subscribe` + `useWorkspaceFileTreeStoreRevision` (`useSyncExternalStore`). Relocate to `workspace/stores/` (or `features/workspace/stores/`) with consistent naming; stop direct store imports from UI such as `components/AgentSettingsModal.tsx`.                             |
| 4        | Reducer-in-hook stores                | `hooks/useChatroomMessageStore.ts`, `direct-harness/hooks/useHarnessTurnStore*.ts`   | Extract reducers into `*Store.ts` modules. Evaluate Legend State per [legend-state-signals.md](./legend-state-signals.md). Note: harness turn store is already split across Core/Streaming hooks — extract shared state next, do not invent a parallel API.                                  |
| Decision | Command favorites persistence         | localStorage today                                                                   | Decide whether to migrate to Convex (like machine-config / search-config favorites) before or after the store move. Keep local until decided.                                                                                                                                                |

### Explicitly out of date (do not re-do)

- Removing machine-config re-export shims — already done; import from `features/machine-config/` only.
- Treating `search-config` as not yet adopting the convention — it already does.
- Moving all of `lib/teamRoleKey.ts` into machine-config — would break the shared / backend-parity story.

## Related docs

- [legend-state-signals.md](./legend-state-signals.md) — Legend State for complex delta stores (message timeline, file tree)
- [features/machine-config/README.md](../../apps/webapp/src/modules/chatroom/features/machine-config/README.md) — first feature adopting this layout
- [features/search-config/README.md](../../apps/webapp/src/modules/chatroom/features/search-config/README.md) — second feature adopting this layout
