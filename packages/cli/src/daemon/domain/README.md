# Domain layer (v2 daemon)

Pure business logic — no I/O, no Convex, no filesystem.

## Belongs here

| Subfolder   | Contents                                                                    |
| ----------- | --------------------------------------------------------------------------- |
| `entities/` | Data types, small pure helpers, `InboundEvent` / `OutboundEvent` registries |
| `usecase/`  | One orchestration per file; co-located `export interface XxxPort`           |

## Does not belong here

| Kind                                     | Home instead                                            |
| ---------------------------------------- | ------------------------------------------------------- |
| `ports/`, `policies/`, `shared/` folders | Co-locate ports in usecase files; inline policy helpers |
| Convex clients, WS, HTTP                 | `infrastructure/convex/`                                |
| `machine.json`, process spawn            | `infrastructure/local/`                                 |
| SQLite, outbox                           | `infrastructure/persistence/`                           |
| Wiring, registries                       | `entry/`                                                |

## Dependency rules

- `entities/` imports only other `entities/`
- `usecase/` imports only `entities/`
- No imports from `infrastructure/`, `entry/`, or `local-web/`
- **No legacy `domain/` shims** — runtime code imports `v2/domain/*` directly (`domain/native-integration/` remains separate)

## Naming

- Files: `kebab-case.ts`
- Types: `PascalCase`
- Use case functions: `camelCase` verb phrases (`deliverAssignedTask`, `openHarnessSession`)
