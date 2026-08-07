# Harness SDK (daemon local infrastructure)

Harness provider code for native direct harness adapters and process lifecycle.

## Layout

```
harness/
  registry.ts           ← init-registry.ts (provider registration)
  bound-harness-registry.ts ← start/stop bound harness processes
  spawning/             ← harness-spawning/ (process lifecycle)
  adapters/             ← cursor-sdk/, claude-sdk/, pi-sdk/, opencode-sdk/, …
  README.md
```

## Belongs here

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

See [adapters/README.md](./adapters/README.md) — one subfolder per provider.

## Agent services

`RemoteAgentService` implementations live in `packages/cli/src/daemon/infrastructure/local/harness/services/`. The harness registry in this module binds those services to direct-harness names at startup.
