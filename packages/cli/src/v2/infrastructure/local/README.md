# Local machine adapters (v2 daemon)

Machine-local configuration and process management — not Convex, not domain logic.

## Belongs here

| File / folder       | Role                                            |
| ------------------- | ----------------------------------------------- |
| `machine-config.ts` | Load `machine.json` / machine identity          |
| `process-spawn.ts`  | Spawn child processes (agents, harnesses)       |
| `harness/`          | Future home for harness SDK registry + adapters |

## Does not belong here

| Kind                                  | Home instead                                                          |
| ------------------------------------- | --------------------------------------------------------------------- |
| Remote agent HTTP/SDK details (today) | `infrastructure/services/remote-agents/` until migrated to `harness/` |
| Convex                                | `infrastructure/convex/`                                              |
| Business rules                        | `domain/usecase/`                                                     |

## Legacy sources

| v2                    | Legacy                                                   |
| --------------------- | -------------------------------------------------------- |
| `machine-config.ts`   | `infrastructure/machine/storage.ts`                      |
| `process-spawn.ts`    | `daemon-start/handlers/process/spawner.ts`               |
| `harness/registry.ts` | `infrastructure/services/remote-agents/init-registry.ts` |
