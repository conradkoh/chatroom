# Harness adapters (daemon local)

Direct-harness SDK adapters — bound harness implementations for native direct harness names (`claude-sdk`, `cursor-sdk`, `opencode-sdk`, `pi-sdk`).

## Layout

| Subfolder       | Provider   |
| --------------- | ---------- |
| `claude-sdk/`   | Claude SDK |
| `cursor-sdk/`   | Cursor SDK |
| `opencode-sdk/` | OpenCode   |
| `pi-sdk/`       | Pi SDK     |

`shared-chunk-extractor.ts` — default chunk extractor for normalized `message.part.delta` events.

## Registry

- **Agent services** — `../registry.ts` (`initHarnessRegistry`) registers `RemoteAgentService` instances from `infrastructure/services/remote-agents/`.
- **Bound direct harness** — `../bound-harness-registry.ts` (`startBoundHarness`, `createChunkExtractor`, `listInstalledNativeDirectHarnesses`).
