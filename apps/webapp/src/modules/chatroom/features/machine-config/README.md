# machine-config feature

Client-side state and hooks for machine harness/model favorites and usage-based recommendations.

## Layout

| Path                                      | Role                                          |
| ----------------------------------------- | --------------------------------------------- |
| `stores/machineConfigUsageStore.ts`       | Device-local frécency (localStorage)          |
| `hooks/useMachineConfigUsage.ts`          | React binding for usage store                 |
| `hooks/useMachineConfigFavorites.ts`      | Convex-backed favorites + composes usage hook |
| `types/machineConfig.ts`                  | MachineConfigEntry type + helpers             |
| `lib/computeRecommendedMachineConfigs.ts` | Ranking logic for config recommendations      |
| `lib/machineConfigScopeKey.ts`            | Machine-scoped scope key helpers              |

Server favorites API: `services/backend/convex/machineConfigFavorites.ts`

Shared types: `types/machine.ts` (AgentHarness stays shared).

See [chatroom-store-conventions.md](../../../../../../docs/developer/chatroom-store-conventions.md) for the full convention and remaining migration checklist.
