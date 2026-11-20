# machine-config feature

Client-side state and hooks for machine harness/model favorites and usage-based recommendations.

## Layout

| Path                                          | Role                                                                                                          |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `stores/machineConfigUsageStore.ts`           | Device-local frécency (localStorage)                                                                          |
| `hooks/useMachineConfigUsage.ts`              | React binding for usage store                                                                                 |
| `hooks/useMachineConfigFavorites.ts`          | Convex-backed favorites + composes usage hook                                                                 |
| `types/machineConfig.ts`                      | MachineConfigEntry type + helpers                                                                             |
| `lib/computeRecommendedMachineConfigs.ts`     | Ranking logic for config recommendations                                                                      |
| `lib/favoriteDefaults.ts`                     | Favourite default rule: harness, model, blocked check                                                         |
| `lib/machineConfigScopeKey.ts`                | Machine-scoped scope key helpers                                                                              |
| `hooks/useApplyTopFavoriteModels.ts`          | Loads each role's favourites and applies each role's top favourite (`agents.saveConfig`)                      |
| `lib/topFavoriteModels.ts`                    | Top favourite per role + apply-result feedback copy                                                           |
| `components/ApplyTopFavoriteModelsButton.tsx` | Context-driven "apply top favourites" button (icon / labelled variants)                                       |
| `lib/favoriteStartMismatches.ts`              | Pure detection of (workspace, role) pairs whose start config differs from the top favourite                   |
| `lib/applyFavoriteConfigs.ts`                 | Shared `agents.saveConfig` loop for applying favourites (used by `useApplyTopFavoriteModels`)                 |
| `hooks/useStartAgentsWithFavorites.ts`        | Start-flow controller: checks favourites on demand when a start is requested, then prompts, applies or starts |
| `components/StartWithFavoritesDialog.tsx`     | Confirmation dialog for the start prompt (presentational; the controller owns its state)                      |

Favourites are checked on demand, when a start is requested, not on render. Choosing `Use favourites & start` persists each favourite via `agents.saveConfig`, so later starts use it too.

Server favorites API: `services/backend/convex/machineConfigFavorites.ts`

Shared types: `types/machine.ts` (AgentHarness stays shared).

See [chatroom-store-conventions.md](../../../../../../docs/developer/chatroom-store-conventions.md) for the full convention and remaining migration checklist.
