# Harness adapters (v2 local)

Direct-harness SDK adapters — bound harness implementations for native direct harness names (`claude-sdk`, `cursor-sdk`, `opencode-sdk`, `pi-sdk`).

## Layout

| Subfolder       | Provider   | Legacy shim (U14 deletes)                |
| --------------- | ---------- | ---------------------------------------- |
| `claude-sdk/`   | Claude SDK | `infrastructure/harnesses/claude-sdk/`   |
| `cursor-sdk/`   | Cursor SDK | `infrastructure/harnesses/cursor-sdk/`   |
| `opencode-sdk/` | OpenCode   | `infrastructure/harnesses/opencode-sdk/` |
| `pi-sdk/`       | Pi SDK     | `infrastructure/harnesses/pi-sdk/`       |

`shared-chunk-extractor.ts` — default chunk extractor for normalized `message.part.delta` events.

## Registry

- **Agent services** — `../registry.ts` (`initHarnessRegistry`) registers `RemoteAgentService` instances.
- **Bound direct harness** — `../bound-harness-registry.ts` (`startBoundHarness`, `createChunkExtractor`, `listInstalledNativeDirectHarnesses`).

Agent service implementations remain in `infrastructure/services/remote-agents/` until a future migration.
