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
    <domain>/                    # e.g. machine-config, run-command
      stores/
        <name>Store.ts           # Pure client store module
        <name>Store.test.ts
      hooks/
        use<Name>Store.ts        # React binding (useSyncExternalStore)
        use<Domain>.ts           # Convex-backed or composite hook
      lib/                       # Pure helpers (compute*, sort*)
        compute<Thing>.ts
      README.md                  # Domain-specific notes (optional)
  lib/                           # Shared primitives (frecencyScoring, teamRoleKey)
  types/                         # Shared types until moved into feature
```

## Store module contract (`*Store.ts`)

- Export `getXxxStore()` singleton accessor; keep the class private.
- Export `subscribeXxx(listener): unsubscribe` for React binding.
- Export a revision/snapshot getter for `useSyncExternalStore` (e.g. `getXxxRevision()`).
- Include `clear()` for tests.
- localStorage keys: `chatroom:<domain>-<purpose>` with a versioned schema.
- SSR-safe: guard `typeof window === 'undefined'`.
- Call `emit()` (or equivalent) after every mutation so subscribers update.

**Reference implementation:** [features/machine-config/stores/machineConfigUsageStore.ts](../../apps/webapp/src/modules/chatroom/features/machine-config/stores/machineConfigUsageStore.ts)

## React hook contract

| Hook name           | Role                                                   |
| ------------------- | ------------------------------------------------------ |
| `use<Name>Store.ts` | Binds a client store via `useSyncExternalStore`        |
| `use<Domain>.ts`    | Convex query/mutation only, or composes multiple hooks |

- No business logic in binding hooks — delegate to store methods or pure `lib/` helpers.
- Never copy store data into `useState` via `useEffect`.

**Reference implementation:** [features/machine-config/hooks/useMachineConfigUsage.ts](../../apps/webapp/src/modules/chatroom/features/machine-config/hooks/useMachineConfigUsage.ts)

## Server vs local persistence

| Data                                   | Where                  | Example                             |
| -------------------------------------- | ---------------------- | ----------------------------------- |
| User preferences (sync across devices) | Convex                 | Machine-config favorites            |
| Frécency / usage telemetry             | localStorage store     | Machine-config usage, command usage |
| Ephemeral UI caches                    | In-memory module store | Workspace file tree                 |

## Component rules

- Import hooks from `features/<domain>/hooks/`, not store modules.
- Fire-and-forget mutations go through hook methods (e.g. `recordUsage()`), not `getXxxStore()`.

## Incremental migration

Legacy paths were removed; import from `features/machine-config/` directly.

## Related docs

- [legend-state-signals.md](./legend-state-signals.md) — Legend State for complex delta stores (message timeline, file tree)
- [features/machine-config/README.md](../../apps/webapp/src/modules/chatroom/features/machine-config/README.md) — first feature adopting this layout
