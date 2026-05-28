# Cursor SDK Harness — Gap Analysis & Implementation Plan

Backlog: **Cursor SDK based harness (multi-agent chatroom)** (`ps78zy4r890k7tkxy4xwx6a9q187k79x`)

Related: **Cursor SDK based direct harness** (`ps71e1zb1p8b313qsx0w57dv2187jp8s`)

---

## 1. Cursor TypeScript SDK (`@cursor/sdk`)

Docs: https://cursor.com/docs/sdk/typescript

### Core model

| Concept | Description |
|--------|-------------|
| **Agent** | Durable container: conversation state, workspace config, settings. Survives multiple prompts. Local IDs: `agent-*`; cloud IDs: `bc-*`. |
| **Run** | One prompt submission. Owns stream, status, result, cancellation. |
| **SDKMessage** | Normalized stream events (`assistant`, `tool_call`, `thinking`, `status`, …). |

### Runtime (always set explicitly)

| Runtime | Use case |
|---------|----------|
| **Local** | Agent loop on caller machine against `cwd`. Dev scripts, CI on working tree. |
| **Cloud** | Isolated VM with cloned repo. Parallel agents, survives disconnect, PR creation. |

Inference uses Cursor-hosted models in both modes.

### Primary APIs

```typescript
// One-shot (auto-dispose)
const result = await Agent.prompt(message, { apiKey, model: { id: "composer-2.5" }, local: { cwd } });

// Durable multi-turn
await using agent = await Agent.create({ apiKey, model, local: { cwd } });
const run = await agent.send(prompt);
for await (const event of run.stream()) { /* handle SDKMessage */ }
const result = await run.wait(); // status: finished | error | cancelled

// Resume across process restarts
await using agent = await Agent.resume(agentId, { apiKey });
```

### Operational requirements

- **Auth:** `CURSOR_API_KEY` (user or service-account key).
- **Disposal:** `await using` or explicit `close()` — leaks child processes / DB handles if skipped.
- **Errors:** `CursorAgentError` = run never started; `result.status === "error"` = run executed and failed.
- **Models:** Prefer `Cursor.models.list()` over hard-coded IDs; `composer-2.5` is typical default.
- **MCP:** Inline `mcpServers` on create/send; **not persisted on resume** — pass again.
- **Headless local:** Tool calls run without approval unless hooks/sandbox configured.

### Fit for chatroom

The SDK replaces **process-per-turn CLI spawning** with a **durable Agent** that can:

- Hold conversation across `get-next-task` / `handoff` cycles within one harness session (Level A).
- Stream normalized events into existing journal/chunk replication paths.
- Resume via `Agent.resume(agentId)` after daemon restart (pairs with backlog: role session persistence).

---

## 2. Harness inventory in this repo

Chatroom has **two distinct harness subsystems**.

### A. RemoteAgentService — multi-agent chatroom (daemon)

**Location:** `packages/cli/src/infrastructure/services/remote-agents/`

| Harness ID | Implementation | Spawn mechanism |
|------------|----------------|-----------------|
| `cursor` | `CursorAgentService` | `agent -p --force --output-format stream-json` (stdin = system+user prompt) |
| `opencode` | `OpenCodeAgentService` | OpenCode CLI |
| `opencode-sdk` | (registry) | SDK path for capabilities |
| `pi` | `PiAgentService` | Pi CLI with `--system-prompt` |
| `copilot` | `CopilotAgentService` | Copilot CLI |

**Contract:** `RemoteAgentService` in `remote-agent-service.ts` — `spawn`, `stop`, `isAlive`, `listModels`, `onAgentEnd` (optional).

**Orchestration:**

- `packages/cli/src/commands/machine/daemon-start/` — `AgentProcessManager`, command loop, `HarnessSpawningService` rate limits.
- `get-next-task` / `handoff` / `register-agent` CLI commands drive the listen loop.
- Backend: `services/backend/convex/machines.ts`, agent events, participant status.

**Current Cursor behavior:**

- **Single-shot per spawn:** combined system+user prompt on stdin; process exits after one response.
- **Multi-turn:** daemon kills and respawns on `onAgentEnd` → new process each chatroom task turn.
- **No SDK agent ID persistence** in Convex agent config today.

### B. BoundHarness — direct harness UI

**Location:** `packages/cli/src/infrastructure/harnesses/opencode-sdk/`

| Type | Implementation |
|------|----------------|
| `opencode-sdk` | `OpencodeSdkHarness` implements `BoundHarness` |

**Contract:** `packages/cli/src/domain/direct-harness/entities/bound-harness.ts` — `newSession`, `resumeSession`, `models`, `close`.

**Orchestration:**

- `HarnessLifecycleManager` (`daemon-start/direct-harness/`) auto-starts per workspace, 15m idle TTL.
- Backend: `services/backend/convex/web/directHarness/` and `daemon/directHarness/` (sessions, turns, messages, queue).
- Frontend: `apps/webapp/src/modules/chatroom/direct-harness/`, `DirectHarnessPanel.tsx`.

**Note:** Only OpenCode SDK is implemented as `BoundHarness`. Cursor is **not** a direct-harness backend yet (separate backlog item `ps71e1zb1p8b313qsx0w57dv2187jp8s`).

---

## 3. Gap analysis: CLI Cursor vs Cursor SDK

| Area | Today (CLI `CursorAgentService`) | Target (SDK) |
|------|----------------------------------|--------------|
| Process model | New OS process per turn | One `Agent` per role/chatroom (or per machine binding) |
| Conversation | Re-prompt full system+user each spawn | `agent.send()` with retained context |
| Stream format | `stream-json` via Cursor CLI | `run.stream()` → `SDKMessage` |
| Session resume | None (daemon respawns) | `Agent.resume(agentId)` + store `agentId` in backend |
| Model list | Static `CURSOR_MODELS` array | `Cursor.models.list()` with cache |
| Direct harness | N/A | Optional `CursorSdkBoundHarness` (backlog ps71…) |
| Auth | Inherited from local Cursor install | `CURSOR_API_KEY` explicit in daemon config |
| Testing | Unit tests on stream reader | Integration tests with mocked SDK or recorded streams |

### Architectural decision (recommended)

**Phase 1 (this backlog):** Add `cursor-sdk` as a **RemoteAgentService** implementation alongside existing `cursor` CLI harness.

- Minimal UI change: agent config `agentType: "cursor-sdk"` (or feature-flagged swap).
- Map `SpawnOptions` → `Agent.create` + `agent.send`.
- Map `SDKMessage` stream → existing output/journal pipeline (similar to `CursorStreamReader`).
- Persist `cursorAgentId` on participant/agent config for `Agent.resume`.

**Phase 2:** Direct harness `BoundHarness` wrapper (backlog ps71…) sharing the same SDK adapter core.

---

## 4. Proposed implementation phases

### Phase 1 — Foundation (multi-agent)

1. Add `@cursor/sdk` dependency to `packages/cli`.
2. Create `packages/cli/src/infrastructure/services/remote-agents/cursor-sdk/`:
   - `cursor-sdk-agent-service.ts` implementing `RemoteAgentService`
   - `cursor-sdk-stream-adapter.ts` mapping `SDKMessage` → internal chunk format
3. Register in `init-registry.ts` as `cursor-sdk` (keep `cursor` CLI for fallback).
4. Env: document `CURSOR_API_KEY` in daemon/machine setup.
5. Backend: extend agent config schema with optional `cursorSdkAgentId` for resume.
6. Unit tests for stream adapter; integration test with mocked SDK.

### Phase 2 — Session persistence

1. On first spawn: `Agent.create`, store `agent.agentId` via backend mutation.
2. On respawn/restart: `Agent.resume(agentId)` when ID present.
3. Align with backlog **role session persistence on restart**.

### Phase 3 — Model discovery

1. Replace static model list with `Cursor.models.list()` + cache in capabilities push.
2. Webapp model filter: consume dynamic list from machine capabilities.

### Phase 4 — Direct harness (separate backlog)

1. `CursorSdkBoundHarness` implementing `BoundHarness` (mirror `OpencodeSdkHarness`).
2. Wire `HarnessLifecycleManager` factory for `type: 'cursor-sdk'`.
3. Convex directHarness replication for Cursor run events.

### Phase 5 — Hardening

1. Error taxonomy: startup vs run failure exit codes in daemon.
2. `run.cancel()` on `stop-agent` command.
3. Feature flag: `cursorSdkHarness` in `services/backend/config/featureFlags.ts`.
4. Deprecate CLI `cursor` harness once SDK path is stable.

---

## 5. Key files to touch (Phase 1)

| File | Change |
|------|--------|
| `packages/cli/package.json` | Add `@cursor/sdk` |
| `packages/cli/src/infrastructure/services/remote-agents/cursor-sdk/*` | New service |
| `packages/cli/src/infrastructure/services/remote-agents/init-registry.ts` | Register harness |
| `packages/cli/src/commands/machine/daemon-start/init.ts` | Discovery / capabilities |
| `services/backend/convex/schema.ts` | Optional `cursorSdkAgentId` on agent config |
| `services/backend/src/domain/entities/agent.ts` | Type updates |
| `apps/webapp/.../modelSelection.ts` | Support `cursor-sdk` harness key |

---

## 6. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| SDK native deps (`sqlite3`, platform binaries) | Pin version; CI matrix for darwin/linux |
| Headless tool execution | Document hooks/sandbox; match CLI `--force` policy explicitly |
| API beta drift | Pin SDK version; thin adapter layer |
| Duplicate listeners (`get-next-task`) | Unchanged — harness session rules still apply |
| Cloud vs local choice | Default **local** with `cwd = workingDir`; cloud only for explicit config |

---

## 7. Success criteria

- [ ] Daemon can start a chatroom agent with `cursor-sdk` harness type
- [ ] `get-next-task` → work → `handoff` reuses same SDK Agent (no full context loss within session)
- [ ] Daemon restart resumes via stored `agentId` when configured
- [ ] Stream output visible in chatroom message/journal pipeline
- [ ] `pnpm typecheck && pnpm test` green
- [ ] Feature PR merged into `release/v1.47.0`, then release merged to master when ready
