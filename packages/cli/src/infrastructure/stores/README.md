# Daemon reactive stores

In-memory caches that **mirror remote (Convex) query results** for the machine daemon.

## Belongs here

- Subscribe → `replace*` → sync `list*` / `get*` reads
- Cleared on feature/daemon stop
- No disk persistence, no Effect, no Convex client inside the store module

## Does not belong here

| Kind | Home instead |
| --- | --- |
| Incremental dual-channel snapshots (`WorkingSnapshot`) | `infrastructure/incremental-sync/` |
| Process coordination (mutex, generation, session registry) | `commands/machine/daemon-start/` |
| Disk-backed machine/harness state | `infrastructure/machine/` / harness packages |
| Temp/file I/O buffers | feature handlers (e.g. process output) |

## Convention

1. File name: `*-store.ts` (+ colocated `*-store.test.ts`)
2. API: `replace*` / `list*` (or `get*`) / `clear*` / optional `has*`
3. Reads are synchronous; writers are subscription (or explicit hydrate) call sites
4. Keep subscribe wiring in the feature module (or a thin `*-store-subscription.ts` next to the feature) — the store stays dumb memory
