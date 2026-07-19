# search-config feature

Client-side state and hooks for agentic search harness+model preferences.

Second adopter of the [chatroom store conventions](../../../../../../docs/developer/chatroom-store-conventions.md) (after machine-config).

| Path                                   | Role                                 |
| -------------------------------------- | ------------------------------------ |
| `types/searchConfig.ts`                | SearchConfigEntry type               |
| `stores/searchConfigUsageStore.ts`     | Device-local frécency (localStorage) |
| `hooks/useSearchConfigUsage.ts`        | Last-used tracking                   |
| `hooks/useSearchConfigFavorites.ts`    | Convex-backed ordered favorites      |
| `components/SearchConfigQuickPick.tsx` | Favorites quick-pick UI              |
| `utils/formatSearchConfigLabel.ts`     | Display label formatting             |

Server API: `services/backend/convex/searchConfigFavorites.ts`
