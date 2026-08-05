# Daemon v2 (strangler migration)

Guide for migrating the machine daemon from `commands/machine/daemon-start/` to a layered `v2/` layout alongside the legacy entry point.

**Root:** `packages/cli/src/v2/`

---

## Purpose

v2 is a **strangler migration**: new code lands here while `daemon-start/index.ts` remains the active entry until the final cutover slice. Subscribers normalize Convex transport into `InboundEvent`; use cases emit `OutboundEvent`; publishers project facts back to Convex (and eventually persistence + local-web).

**v1 stays active:** `packages/cli/src/commands/machine/daemon-start/index.ts` must not delegate to v2 until subscribers, use cases, and publishers are migrated.

---

## Layer diagram

```
local-web/          ← localhost UI (future primary harness stream sink)
    ↑
entry/              ← composition root (start-daemon, registries, event-router)
    ↑
infrastructure/     ← Convex subscribers/publishers, local adapters, persistence
    ↑
domain/usecase/     ← orchestration (ports co-located per file)
    ↑
domain/entities/    ← pure types + event registries
```

---

## Dependency rules

| Layer               | May import                                                 |
| ------------------- | ---------------------------------------------------------- |
| `domain/entities/`  | Nothing outside `domain/entities/`                         |
| `domain/usecase/`   | `domain/entities/` only                                    |
| `infrastructure/`   | `domain/entities/` (normalization types only)              |
| `entry/`            | `domain/`, `infrastructure/`                               |
| `local-web/server/` | `domain/entities/`, `infrastructure/persistence/` (future) |
| `local-web/client/` | HTTP/WebSocket only — no direct domain imports             |

---

## Migration order

1. **Scaffold** (this slice) — folders, READMEs, compiling stubs
2. **Entities** — migrate types from legacy `domain/` and `daemon-start/`
3. **Use cases** — one orchestration per file from legacy handlers
4. **Subscribers / publishers** — per-context Convex wiring via incremental-sync
5. **Persistence** — SQLite default write sink + outbox
6. **Local-web** — server + client for full-granularity harness streams
7. **Entry cutover LAST** — `start-daemon.ts` replaces `daemon-start/index.ts`

---

## Subfolder guides

| Folder               | README                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------- |
| Domain               | [domain/README.md](./domain/README.md)                                                       |
| Entities             | [domain/entities/README.md](./domain/entities/README.md)                                     |
| Use cases            | [domain/usecase/README.md](./domain/usecase/README.md)                                       |
| Infrastructure       | [infrastructure/README.md](./infrastructure/README.md)                                       |
| Convex               | [infrastructure/convex/README.md](./infrastructure/convex/README.md)                         |
| Subscribers          | [infrastructure/convex/subscribers/README.md](./infrastructure/convex/subscribers/README.md) |
| Publishers           | [infrastructure/convex/publishers/README.md](./infrastructure/convex/publishers/README.md)   |
| Persistence          | [infrastructure/persistence/README.md](./infrastructure/persistence/README.md)               |
| Local adapters       | [infrastructure/local/README.md](./infrastructure/local/README.md)                           |
| Harness SDK (future) | [infrastructure/local/harness/README.md](./infrastructure/local/harness/README.md)           |
| Entry                | [entry/README.md](./entry/README.md)                                                         |
| Local web            | [local-web/README.md](./local-web/README.md)                                                 |
