# machine-config feature

Client-side state and hooks for machine harness/model favorites and usage-based recommendations.

## Layout

| Path                                 | Role                                          |
| ------------------------------------ | --------------------------------------------- |
| `stores/machineConfigUsageStore.ts`  | Device-local frécency (localStorage)          |
| `hooks/useMachineConfigUsage.ts`     | React binding for usage store                 |
| `hooks/useMachineConfigFavorites.ts` | Convex-backed favorites + composes usage hook |

Server favorites API: `services/backend/convex/machineConfigFavorites.ts`

Shared types: `types/machineConfig.ts` (to move here in a future refactor)

Ranking logic: `lib/computeRecommendedMachineConfigs.ts` (to move here in a future refactor)

See [chatroom-store-conventions.md](../../../../../../docs/developer/chatroom-store-conventions.md) for the full convention.
