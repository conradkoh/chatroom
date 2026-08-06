# Local machine adapters (v2 daemon)

Machine-local configuration and process management — not Convex, not domain logic.

## Belongs here

| File / folder       | Role                                                 |
| ------------------- | ---------------------------------------------------- |
| `machine-config.ts` | Port over `infrastructure/machine/storage.ts`        |
| `process-spawn.ts`  | Port over daemon-start process spawner               |
| `harness/`          | Harness SDK registry + bound direct-harness adapters |

## Does not belong here

| Kind                                 | Home instead                                                               |
| ------------------------------------ | -------------------------------------------------------------------------- |
| Remote agent HTTP/SDK service bodies | `infrastructure/services/remote-agents/` (agent services not moved in U12) |
| Convex                               | `infrastructure/convex/`                                                   |
| Business rules                       | `domain/usecase/`                                                          |

## Legacy sources (thin re-exports until U14)

| v2                                  | Legacy shim                                              |
| ----------------------------------- | -------------------------------------------------------- |
| `machine-config.ts`                 | (no shim — import v2 directly)                           |
| `process-spawn.ts`                  | (no shim — import v2 directly)                           |
| `harness/registry.ts`               | `infrastructure/services/remote-agents/init-registry.ts` |
| `harness/bound-harness-registry.ts` | `infrastructure/harnesses/registry.ts`                   |
| `harness/adapters/*`                | `infrastructure/harnesses/{provider}-sdk/` shims         |
