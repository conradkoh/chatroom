# Daemon v2 (strangler migration)

Guide for migrating the machine daemon from `commands/machine/daemon-start/` to a layered `v2/` layout alongside the legacy entry point.

**Root:** `packages/cli/src/v2/`

**Progress tracker:** [MIGRATION-TRACKER.md](./MIGRATION-TRACKER.md) — definition of done, unit checklist, backlog mapping (branch: `feat/v2-daemon-migration`)

---

## Purpose

v2 is the **sole daemon runtime** after U14: `daemon-start/index.ts` delegates to `startDaemonV2`, which runs v2 infrastructure (persistence, local-web, subscribers, `createDaemonRuntime`) with legacy `daemon-start/` reduced to handlers, drains, and thin shims.

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

## Migration order (complete)

1. **Scaffold** — folders, READMEs, compiling stubs ✅
2. **Entities** — migrate types from legacy `domain/` and `daemon-start/` ✅
3. **Use cases** — one orchestration per file from legacy handlers ✅
4. **Subscribers / publishers** — per-context Convex wiring via incremental-sync ✅
5. **Persistence** — SQLite default write sink + outbox ✅
6. **Local-web** — server + client for full-granularity harness streams ✅
7. **Entry cutover** — `startDaemonV2` active via `daemon-start/index.ts` ✅
8. **Shim removal** — legacy `domain/agent-lifecycle` and `domain/direct-harness` re-exports removed ✅
9. **Legacy subscription removal** — v2 subscribers sole Convex listeners (U13) ✅
10. **daemon-start teardown** — runtime SSOT in `v2/entry/` (U14) ✅

Consumers import `v2/domain/*` directly. Preserved: `domain/native-integration/`, `domain/harness-activity-emitter.ts`.

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
