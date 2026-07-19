# machine-config feature

Client-side state and hooks for machine harness/model favorites and usage-based recommendations.

## Layout

| Path                                 | Role                                          |
| ------------------------------------ | --------------------------------------------- |
| `stores/machineConfigUsageStore.ts`  | Device-local frécency (localStorage)          |
| `hooks/useMachineConfigUsage.ts`     | React binding for usage store                 |
| `hooks/useMachineConfigFavorites.ts` | Convex-backed favorites + composes usage hook |

Server favorites API: `services/backend/convex/machineConfigFavorites.ts`

Shared types: top-level `types/machineConfig.ts` (still to move into `features/machine-config/types/`)

Ranking logic: top-level `lib/computeRecommendedMachineConfigs.ts` (still to move into `features/machine-config/lib/`)

Machine scope keys: `buildMachineFavoriteScopeKey` / `buildMachineConfigScopeKey` live in shared `lib/teamRoleKey.ts` today; only those helpers should move here later — keep `buildTeamRoleKey` shared.

See [chatroom-store-conventions.md](../../../../../../docs/developer/chatroom-store-conventions.md) for the full convention and remaining migration checklist.
