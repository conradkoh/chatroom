# Domain entities (daemon module)

Pure data types and event registries. No side effects.

## Belongs here

- One primary type per file (`kebab-case.ts`)
- Discriminated union event registries: `inbound-event.ts`, `outbound-event.ts`
- Small pure functions (narrowing helpers, validators)

## Does not belong here

| Kind                 | Home instead                                          |
| -------------------- | ----------------------------------------------------- |
| Orchestration, ports | `domain/usecase/`                                     |
| Convex DTO mapping   | `infrastructure/convex/subscribers/` or `publishers/` |
| Persistence schemas  | `infrastructure/persistence/`                         |

## Naming conventions

| Artifact           | Convention         | Example                  |
| ------------------ | ------------------ | ------------------------ |
| File               | `kebab-case.ts`    | `assigned-task.ts`       |
| Type               | `PascalCase`       | `AssignedTask`           |
| Event union member | `namespace.action` | `'assigned-task.signal'` |

## Event registries

- **`inbound-event.ts`** — facts from Convex subscribers (normalized before `event-router`)
  - `direct-harness.command` uses `commandId` (Convex command `_id`), not `harnessSessionId`
  - `agentic-query.session-opened` and `agentic-query.prompt` use `sessionId` (Convex `runId`)
- **`outbound-event.ts`** — facts use cases assert (routed by `publisher-registry`)

Include `harness.stream` on the outbound side for full-granularity stdout/stderr lines (local-web sink).

## Single source of truth

Daemon domain entities are the SSOT for CLI daemon types. They must not import from
`@workspace/backend`, `infrastructure/`, `entry/`, or `convex`. Legacy
`domain/**/entities/` paths are thin re-exports — update new code to import from
`daemon/domain/entities/` directly.
