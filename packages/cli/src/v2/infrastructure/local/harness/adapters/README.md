# Harness adapters (planned)

One subfolder per harness provider will be created during SDK migration.

## Planned providers

| Subfolder (future) | Legacy source                                       |
| ------------------ | --------------------------------------------------- |
| `cursor-sdk/`      | `infrastructure/services/remote-agents/cursor-sdk/` |
| `claude-sdk/`      | `infrastructure/harnesses/claude-sdk/`              |
| `pi-sdk/`          | `infrastructure/harnesses/pi-sdk/`                  |
| `opencode-sdk/`    | `infrastructure/harnesses/opencode-sdk/`            |

## Scaffold status

**README only** — no adapter implementation files in the scaffold slice.

Each adapter should:

1. Implement a narrow port interface defined in `domain/usecase/` (co-located)
2. Emit `OutboundEvent` `harness.stream` for stdout/stderr lines
3. Avoid importing Convex or entry-layer code
