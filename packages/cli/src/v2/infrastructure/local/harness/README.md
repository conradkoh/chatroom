# Harness SDK (v2 local infrastructure)

**Future home** for harness provider code migrated from `packages/cli/src/infrastructure/services/remote-agents/`.

Structure exists now; implementation migrates in later slices.

## Planned layout

```
harness/
  registry.ts      ← init-registry.ts (provider registration)
  spawning/        ← harness-spawning/ (process lifecycle)
  adapters/        ← cursor-sdk/, claude-sdk/, pi-sdk/, opencode-sdk/, …
  README.md
```

## Belongs here (after migration)

- Provider-specific SDK adapters (cursor, claude, pi, opencode, …)
- Stream normalization → `OutboundEvent` type `harness.stream`
- Spawn/kill/restart harness processes

## Does not belong here

| Kind                     | Home instead                                            |
| ------------------------ | ------------------------------------------------------- |
| Session orchestration    | `domain/usecase/open-harness-session.ts`, etc.          |
| Convex session mutations | `infrastructure/convex/publishers/session-lifecycle.ts` |
| UI log viewer            | `local-web/client/`                                     |

## Adapters subfolder

See [adapters/README.md](./adapters/README.md) — one subfolder per provider during migration. **No adapter stubs yet** (README only).

## Legacy root

`packages/cli/src/infrastructure/services/remote-agents/`
