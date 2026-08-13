# Daemon module

Canonical home for all machine daemon code within the CLI.

**Root:** `packages/cli/src/daemon/`

---

## Purpose

The `daemon/` module is the **sole daemon runtime**: `daemon-start/index.ts` delegates to `startDaemon`, which runs persistence, local-web, Convex subscribers, and `createDaemonRuntime`. Legacy `daemon-start/` retains handlers, drains, and thin re-export shims.

**P5 (inbound-only Convex subscription):** when `orchestration flags` is enabled, the daemon subscribes only to user-intent inbound Convex state (git, files, workspace list, webapp commands, direct harness, agentic queries). Orchestration subscribers (assigned-task signals/presence, enhancer-job) are removed because the daemon no longer subscribes to its own projected state. All outbound flows go **event store → outbox → projection** (see `infrastructure/projection/`); the publisher registry becomes a local event bus (append + `harness.stream` fan-out only).

---

## Layer diagram

```
local-web/          ← localhost UI (harness stream sink)
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

| Layer              | May import                                           |
| ------------------ | ---------------------------------------------------- |
| `domain/entities/` | Nothing outside `domain/entities/`                   |
| `domain/usecase/`  | `domain/entities/` only                              |
| `infrastructure/`  | `domain/entities/` (normalization types only)        |
| `entry/`           | `domain/`, `infrastructure/`                         |
| `local-web/`       | `entry/` (stream hub), `infrastructure/persistence/` |

---

## Entry cutover

`commands/machine/daemon-start/index.ts` → `startDaemon()` in `entry/start-daemon.ts`.

---

## Further reading

- [entry/README.md](./entry/README.md) — composition root files
- [domain/usecase/README.md](./domain/usecase/README.md) — use case map
