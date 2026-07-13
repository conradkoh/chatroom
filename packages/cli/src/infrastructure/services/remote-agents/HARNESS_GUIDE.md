# Harness Implementation Guide

End-to-end steps for adding a new remote agent harness to the Chatroom CLI.

**Harness kinds**

| Kind          | When to use                                              | Examples                                                       |
| ------------- | -------------------------------------------------------- | -------------------------------------------------------------- |
| **CLI-based** | The runtime is a subprocess with stdout/stderr you parse | `cursor`, `claude`, `pi`, `opencode`, `copilot`, `commandcode` |
| **SDK-based** | The runtime is a Node SDK (in-process API)               | `cursor-sdk`, `opencode-sdk`, `pi-sdk`, `claude-sdk`           |

Both kinds implement the same `RemoteAgentService` contract and register in `init-registry.ts`.

### Native integration (`supportsNativeIntegration`)

Some harnesses use **native integration**: the chatroom daemon injects tasks directly into the harness session context instead of relying on a blocking `get-next-task` listen loop.

| Aspect               | CLI harness (default)                                                                                    | Native integration harness                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Task delivery**    | Agent runs `get-next-task` in a foreground loop; backend claims and delivers via WebSocket               | Backend injects tasks into the in-process session when user messages or handoffs arrive          |
| **Session start**    | System prompt + instructions to run `get-next-task`                                                      | System prompt only — no `get-next-task` loop                                                     |
| **Status lifecycle** | `get-next-task:started` → WAITING; `get-next-task:stopped` → ACKNOWLEDGED; first harness token → WORKING | `native:waiting` → WAITING; `native:task-injected` → ACKNOWLEDGED; first harness token → WORKING |

**Task injection:** Native SDK harnesses use `resumeTurn` only when the daemon injects user work — not for turn-end auto-resume.

**Current native harnesses:** `cursor-sdk`, `opencode-sdk`, `pi-sdk`, `claude-sdk` (`supportsNativeIntegration: true` in `types.ts`).

**Turn-end policy:** Native harnesses idle in-process after each turn; the daemon emits `native:waiting` without calling `resumeTurn` when the agent has no active assigned work (`task.acknowledged` / `task.inProgress`). Task injection uses `resumeTurn` only when delivering user work.

**Participant heartbeat actions** (emitted by the daemon):

- **CLI harnesses:** `get-next-task:started` → WAITING; `get-next-task:stopped` when a task is delivered → ACKNOWLEDGED (`task.acknowledged`)
- **Native harnesses:** `native:waiting` → WAITING; `native:task-injected` when a task is injected → ACKNOWLEDGED (`task.acknowledged`)
- **All harnesses:** first stdout/stderr token via `updateTokenActivity` when the task is `acknowledged` → `readTask()` → `task.inProgress` / UI **WORKING**

CLI and native harnesses both wire `spawnResult.onOutput()` to `participants.updateTokenActivity` in `AgentProcessManager`. The first output fires immediately; subsequent calls are throttled (30s). Agents do **not** need to run `task read` to mark work as in progress — producing harness output is the signal.

`task read` remains available as an optional recovery command (e.g. backlog attachments not shown in delivery).

**Daemon task injection** (`packages/cli/src/commands/machine/daemon-start/`):

**Delivery paths (native SDK harnesses):**

| Path         | Trigger                                                                                                   | Log prefix                  |
| ------------ | --------------------------------------------------------------------------------------------------------- | --------------------------- |
| **Primary**  | Harness `agent_end` → slot idle → `notifyNativeTurnIdle`                                                  | `[NativeDelivery:primary]`  |
| **Fallback** | Signal/presence feed reconcile, subscribed snapshot store + 10s local reconcile timer, native light nudge | `[NativeDelivery:fallback]` |

Eligibility is gated by local `slot.nativeTurnPhase === 'idle'` (not backend participant snapshots). Fallback paths exist for daemon restart mid-turn or missed events — monitor logs to measure how often they fire before removing.

Injection wiring:

1. `native-task-injector-logic.ts` — pure inject decisions (`shouldDeliverNativeTask`)
2. `native-task-injector.ts` — Effect wiring: `claimTask` → `getTaskDeliveryPrompt` → `resumeTurnForSlot` → `participants.join` (`native:task-injected`)
3. `AgentProcessManager.emitNativeWaiting` — emits `native:waiting` after native spawn only; turn-end unlocks delivery via `agent_end` → nativeTurnPhase idle → coordinator, not via `lastSeenAction` predicates

CLI harnesses keep the existing `get-next-task` loop and stop→cold-start nudge path. Native harnesses still cold-start via revive when the backend PID is stale locally.

### Native multi-turn invariant

For harnesses with `supportsNativeIntegration` + `resumeTurn`:

1. `resumeTurn(pid, prompt)` starts or queues **one** turn.
2. When that turn completes, emit `lifecycle.turn.completed` via `SpawnResult.onAgentEnd` **once**.
3. A later `resumeTurn` must enable a later `onAgentEnd` (no sticky process-lifetime latch).
4. `AgentProcessManager` is the sole post-end owner: `onAgentEnd` → `nativeTurnPhase = idle` → delivery coordinator. Do not unlock delivery from provider status inside the coordinator.

How current native SDKs satisfy (3):

- `cursor-sdk` / `pi-sdk` / `claude-sdk`: new per-turn run; `finish()` emits end.
- `opencode-sdk`: long-lived session event forwarder; `resumeTurn` calls private `armTurnEnd()` before prompting.

Do **not** add `armTurnEnd` to `RemoteAgentService`.

Regression coverage: unit tests titled `native multi-turn invariant: two resumeTurns each emit onAgentEnd` in `cursor-sdk` and `claude-sdk` agent-service tests; OpenCode covered by `session-event-forwarder` multi-turn `armTurnEnd` tests.

### Context compaction vs hard restart vs new session

| Mode          | Native (`cursor-sdk`, `opencode-sdk`, `claude-sdk`)             | CLI harnesses                                      |
| ------------- | --------------------------------------------------------------- | -------------------------------------------------- |
| `none`        | Continue prior session; plain task injection                    | Resume prior session (`wantResume=true`)           |
| `compact`     | In-session compaction via SDK; compaction preamble on injection | Not supported — treat like `none` at runtime       |
| `new_session` | New session in-process; new-session preamble (not compaction)   | Hard restart (`wantResume=false`); `get-next-task` |

**Rule:** `compact` triggers in-session compaction and `agent.sessionCompacted` on native harnesses only. `new_session` starts a fresh session — it is not compaction. CLI harnesses cannot compact in-process; use `new_session` for a cold restart.

---

## 1. The `RemoteAgentService` contract

Defined in `remote-agent-service.ts`. Every harness must provide:

| Member                                   | Purpose                                                                           |
| ---------------------------------------- | --------------------------------------------------------------------------------- |
| `id`                                     | Stable identifier stored in DB/config (e.g. `'cursor'`)                           |
| `displayName`                            | Human label for the UI                                                            |
| `command`                                | CLI binary used for install detection (even SDK harnesses often gate on a binary) |
| `isInstalled()`                          | Async check — hide harness from picker when false                                 |
| `getVersion()`                           | Semver or null                                                                    |
| `listModels()`                           | Available model IDs                                                               |
| `spawn(options)`                         | Start a turn; return PID + lifecycle callbacks                                    |
| `stop(pid)`                              | SIGTERM → wait → SIGKILL (override when SDK cleanup is needed)                    |
| `isAlive(pid)`                           | Process still running?                                                            |
| `getTrackedProcesses()` / `untrack(pid)` | Registry for daemon idle detection                                                |

### `SpawnOptions` inputs

- `workingDir` — agent cwd
- `prompt` — non-empty user message (`SpawnPrompt`, validated upstream)
- `systemPrompt` — role/system instructions (always provided)
- `model?` — optional model override
- `context` — `{ machineId, chatroomId, role }` echoed on exit

### `SpawnResult` outputs

- `pid` — tracked by the daemon for stop/idle/restart
- `onExit(cb)` — fires when the harness turn ends
- `onOutput(cb)` — fires on new stdout/stderr activity (updates `lastOutputAt`)
- `onAgentEnd?(cb)` — optional; fires when the agent completes a turn (see capabilities)
- `onLogLine?(cb)` — human-readable log lines for resume-storm reason classification on native SDK harnesses (see §3.5)

### Lifecycle vs wire events

Canonical vocabulary lives in `services/backend/src/domain/entities/harness/lifecycle-events.ts` and per-harness `HarnessCapabilities` in `types.ts`.

| Layer                           | Meaning                                    | Examples                                                                         |
| ------------------------------- | ------------------------------------------ | -------------------------------------------------------------------------------- |
| **Lifecycle** (daemon boundary) | Stable semantics for `AgentProcessManager` | `lifecycle.turn.completed` → `onAgentEnd`, `lifecycle.process.exited` → `onExit` |
| **Wire** (harness-specific)     | Protocol/SDK signals before adaptation     | Pi NDJSON `wire.ndjson.agent_end`, Cursor `sdk.cursor.run.completed`             |

**CLI-only wire events:** kinds with `cliOnly: true` (all `wire.ndjson.*`) are **never** emitted by SDK harnesses. SDK harnesses synthesize `lifecycle.turn.completed` from SDK APIs (e.g. after `run.wait()`), not from NDJSON on child stdout.

Declare `runtimeKind`, `lifecycle`, and `wireEvents` in each `*.config.ts` under `services/backend/src/domain/entities/harness/`.

---

## 2. Shared base: `BaseCLIAgentService`

All current harnesses extend `base-cli-agent-service.ts`, which provides:

- DI for `execSync`, `spawn`, `kill` (testable without real processes)
- Process registry (`registerProcess`, `deleteProcess`, `getTrackedProcesses`)
- `checkInstalled(command)` / `checkVersion(command)` / `runListCommand(...)`
- Default `stop` / `isAlive` / `untrack` (SIGTERM process group → poll → SIGKILL)

**Subclass responsibilities:** implement `id`, `displayName`, `command`, `isInstalled`, `getVersion`, `listModels`, and `spawn`.

---

## 3. CLI-based harness pattern

Use when the agent runtime is an external CLI binary.

### 3.1 File layout

```
remote-agents/
  my-agent/
    my-agent-service.ts       ← main harness class
    my-stream-reader.ts       ← optional: parse NDJSON/stream output
    my-agent-service.test.ts
    index.ts                  ← re-export service class
```

Reference implementations: `cursor/`, `claude/`, `pi/`.

### 3.2 Implementation checklist

1. **Extend `BaseCLIAgentService`** and set `id`, `displayName`, `command`.
2. **`isInstalled` / `getVersion`** — delegate to `this.checkInstalled(COMMAND)` and `this.checkVersion(COMMAND)`.
3. **`listModels`** — run a CLI subcommand via `runListCommand`, or return a static list if the CLI has no list command (see `claude`).
4. **`spawn`** — core loop:
   - Build CLI args (model flags, output format, etc.)
   - Combine prompts: `systemPrompt + '\n\n' + prompt` when the CLI has no separate system flag
   - `this.deps.spawn(COMMAND, args, { cwd, stdio, detached: true, ... })`
   - Write prompt to stdin if needed; call `stdin.end()`
   - Guard against immediate exit / missing PID
   - `this.registerProcess(pid, context)` and wire stdout/stderr
   - Attach a **stream reader** to parse NDJSON events, update `entry.lastOutputAt`, and fire `onOutput` / `onAgentEnd`
   - Return `{ pid, onExit, onOutput, onAgentEnd? }` — `onExit` must call `this.deleteProcess(pid)`

### 3.3 Stream readers

CLI harnesses that emit structured output (NDJSON, RPC) use a dedicated reader class:

- `CursorStreamReader` — stream-json events from `agent -p`
- `ClaudeStreamReader` — stream-json from `claude -p`
- `PiRpcReader` — newline-delimited JSON over RPC stdin/stdout
- `CopilotStreamReader`, `CommandCodeStreamReader` — plain-text or custom formats

Readers typically expose `onText`, `onAgentEnd`, `onToolCall`, etc., and write prefixed lines to `process.stdout` so PM2/daemon logs stay parseable.

### 3.4 Single-shot vs long-lived CLIs

| Mode            | Behaviour                                                      | Examples                          |
| --------------- | -------------------------------------------------------------- | --------------------------------- |
| **Single-shot** | Process exits after one turn; daemon respawns for next message | `cursor`, `claude`, `commandcode` |
| **Long-lived**  | Process stays up; future prompts sent over stdin               | `pi` (RPC mode)                   |

Implement `onAgentEnd` when the daemon should restart the process between turns.

### 3.5 Log lines for resume-storm classification (`onLogLine`)

Native SDK harnesses (`cursor-sdk`, `opencode-sdk`, `pi-sdk`, `claude-sdk`) idle in-process between turns. When the agent hits API/auth/config errors, it may end turns in rapid succession and trigger a **resume storm** abort.

`AgentProcessManager` registers `spawnResult.onLogLine` and keeps the last ~100 lines per agent slot. On storm abort, `classifyResumeStormReason()` scans those lines for rate-limit, auth, and config patterns.

**Requirements for harnesses that emit `onLogLine`:**

1. Return `onLogLine` from `spawn()` (and `resumeFromDaemonMemory()` when applicable).
2. Emit the **same formatted strings** you write to stdout/stderr (prefix + kind + payload), one line per callback — include error paths (`spawn-error`, `session.error`, stderr chunks).

Reference implementations:

| Harness        | Where log lines are emitted                                                                                    |
| -------------- | -------------------------------------------------------------------------------------------------------------- |
| `opencode-sdk` | `session-event-forwarder.ts` — `writeLogLine`; serve stderr in `registerRunningSession`                        |
| `cursor-sdk`   | `cursor-sdk-stream-adapter.ts` — `writeLine`; `writeSpawnError` / `run-error` in `cursor-sdk-agent-service.ts` |
| `pi-sdk`       | `pi-sdk-stream-adapter.ts` — formatted log lines from session events                                           |
| `claude-sdk`   | `claude-sdk-stream-adapter.ts` — formatted log lines from SDK messages                                         |

Single-shot CLI harnesses (kill-and-respawn per turn) do **not** need `onLogLine`.

---

## 4. SDK-based harness pattern

Use when integration happens through a Node SDK rather than parsing CLI stdout.

Reference implementations: `cursor-sdk/` (in-process SDK + keeper PID), `opencode-sdk/` (spawn server + SDK client), `claude-sdk/` (Claude Agent SDK `query()` + keeper PID).

Both still extend `BaseCLIAgentService` for registry and default lifecycle helpers.

### 4.1 Lazy SDK loading (when native deps exist)

If the SDK pulls in native addons (e.g. `@cursor/sdk` → sqlite3), **do not top-level import**. Defer with a cached dynamic import:

```ts
let _sdkCache: typeof import('@cursor/sdk') | undefined;

async function loadSdk() {
  if (_sdkCache) return _sdkCache;
  _sdkCache = await import('@cursor/sdk');
  return _sdkCache;
}
```

Use type-only imports at the top (`import type { ... }`) so module load never crashes the daemon. Gate `isInstalled()` on a successful `loadSdk()` call.

See `cursor-sdk-agent-service.ts` and `claude-sdk-package.ts` (lazy load + `extractFromBunfs` for compiled CLI).

For `@anthropic-ai/claude-agent-sdk`, defer import via `importBundledClaudeSdk()` in `claude-sdk-package.ts` (same pin-check pattern as pi-sdk/cursor-sdk). Resolve the bundled Claude Code binary with `resolveClaudeCodeExecutable()` from the platform optional package (`@anthropic-ai/claude-agent-sdk-darwin-arm64`, etc.) and pass `pathToClaudeCodeExecutable` when auto-resolution fails. For `bun build --compile` single-file executables, use `extractFromBunfs()` from `@anthropic-ai/claude-agent-sdk/extract` per the [Agent SDK docs](https://code.claude.com/docs/en/agent-sdk/typescript).

### 4.2 Keeper process (PID compatibility)

The daemon tracks agents by OS PID. Pure in-process SDK work has no natural PID, so SDK harnesses spawn a lightweight **keeper** child:

```ts
const keeper = this.deps.spawn(process.execPath, ['-e', 'setInterval(()=>{},2147483647)'], {
  cwd: options.workingDir,
  stdio: 'ignore',
  detached: true,
});
const pid = keeper.pid!;
this.registerProcess(pid, context);
```

The real SDK session runs in an async IIFE; the keeper stays alive until the turn finishes, then is killed.

### 4.3 Async IIFE spawn pattern

`spawn` returns immediately with callbacks; SDK work runs in the background:

```ts
void (async () => {
  try {
    // Agent.create, agent.send, stream messages...
  } catch (err) {
    // log spawn-error to stderr
  } finally {
    agent.close();
    keeper.kill();
    finishExit(exitCode, exitSignal); // fire onExit callbacks, deleteProcess
  }
})();

return { pid, onExit, onOutput, onAgentEnd, onLogLine };
```

Collect callbacks in arrays (`exitCallbacks`, `outputCallbacks`, `logLineCallbacks`) and invoke them from the IIFE when events occur. Wire `onLogLine` for native SDK harnesses per §3.5.

### 4.4 Stream adapter

Map SDK message types to the same log format CLI harnesses use. Example: `CursorSdkStreamAdapter` handles `SDKMessage` events, writes `[cursor-sdk:role@chatroom text]` lines, and forwards each formatted line to `onLogLine` when provided.

### 4.5 Override `stop`

SDK harnesses must clean up in-process state before killing the keeper:

```ts
override async stop(pid: number): Promise<void> {
  const session = this.sessions.get(pid);
  if (session) {
    session.aborted = true;
    await session.run?.cancel(); // if supported
    session.agent.close();
    this.sessions.delete(pid);
  }
  await super.stop(pid); // SIGTERM keeper process group
}
```

See `cursor-sdk-agent-service.ts` and `opencode-sdk-agent-service.ts` (session abort + forwarder stop).

### 4.6 Server + client variant (`opencode-sdk`)

Some SDKs expect a local server:

1. Spawn CLI server subprocess (`opencode serve`)
2. Parse listening URL from stdout (`waitForListeningUrl`)
3. Create SDK client pointed at that URL
4. Create session, send prompt, forward events via `SessionEventForwarder`
5. Track session metadata by PID for `stop()` to call `session.abort`

The spawned server PID is the tracked PID (no separate keeper needed).

---

## 5. Register the harness

1. Create `my-agent/index.ts` exporting the service class.
2. Add to `init-registry.ts`:

```ts
import { MyAgentService } from './my-agent/index.js';

export function initHarnessRegistry(): void {
  // ...
  registerHarness(new MyAgentService());
}
```

3. Export from `remote-agents/index.ts` if needed by tests or callers.
4. Update `init-registry.test.ts` — add your `id` to the expected sorted list.

Registry API (`registry.ts`): `registerHarness`, `getHarness`, `getAllHarnesses`.

---

## 6. Testing

### 6.1 CLI harness tests

Pattern (see `cursor-agent-service.test.ts`, `claude-code-agent-service.test.ts`):

```ts
function createMockDeps(): CLIAgentServiceDeps {
  return { execSync: vi.fn(), spawn: vi.fn(), kill: vi.fn() };
}
```

- **`isInstalled` / `getVersion`** — mock `execSync` success/failure (`which` exit code 1 = not installed).
- **`spawn`** — mock `spawn` to return a fake `ChildProcess` (`EventEmitter` + `Readable` stdout); assert args, env, stdin writes, and callback wiring.
- **Stream reader** — unit-test separately with fixture NDJSON lines.

Use `createSpawnPrompt('test prompt')` from `spawn-prompt.ts` for valid spawn inputs.

### 6.2 SDK harness tests

Pattern (see `cursor-sdk-agent-service.test.ts`, `opencode-sdk-agent-service.test.ts`, `claude-sdk-agent-service.test.ts`):

```ts
vi.mock('@cursor/sdk', () => ({ Agent: { create: vi.fn() }, ... }));
```

- Mock the SDK module; stub `Agent.create`, `agent.send`, `run.stream`, `run.wait`.
- Mock `deps.spawn` to return a fake keeper child with a PID.
- Test `isInstalled` gates (API keys, SDK load failures).
- Test `stop` cancels run and closes agent.
- Test async IIFE fires `onExit` / `onAgentEnd` after stream completes.

Inject optional deps (`sessionMetadataStore`, etc.) for opencode-sdk isolation tests.

### 6.3 Registry test

`init-registry.test.ts` asserts all harness IDs are registered after `initHarnessRegistry()`. **Add your new `id` here** whenever you register a harness.

---

## 7. New harness checklist

- [ ] `RemoteAgentService` fully implemented
- [ ] Extends `BaseCLIAgentService` (or documents why not)
- [ ] CLI: stream reader + prefixed log lines, **or** SDK: lazy load + keeper/async IIFE/stop override
- [ ] `spawn` registers PID, updates `lastOutputAt` on output, cleans up on exit
- [ ] `index.ts` barrel export
- [ ] Registered in `init-registry.ts`
- [ ] `init-registry.test.ts` updated
- [ ] Unit tests with mocked `deps` (and mocked SDK if applicable)
- [ ] No changes to daemon/use-case layers unless the contract requires it

---

## 8. Existing harness reference

| ID             | Kind         | Key files                                                                  |
| -------------- | ------------ | -------------------------------------------------------------------------- |
| `claude`       | CLI          | `claude/claude-code-agent-service.ts`, `claude-stream-reader.ts`           |
| `claude-sdk`   | SDK          | `claude-sdk/claude-sdk-agent-service.ts`, `claude-sdk-stream-adapter.ts`   |
| `commandcode`  | CLI          | `commandcode/command-code-agent-service.ts`                                |
| `copilot`      | CLI          | `copilot/copilot-agent-service.ts`                                         |
| `cursor`       | CLI          | `cursor/cursor-agent-service.ts`, `cursor-stream-reader.ts`                |
| `opencode`     | CLI          | `opencode/opencode-agent-service.ts`                                       |
| `pi`           | CLI (RPC)    | `pi/pi-agent-service.ts`, `pi-rpc-reader.ts`                               |
| `pi-sdk`       | SDK          | `pi-sdk/pi-sdk-agent-service.ts`, `pi-sdk-stream-adapter.ts`               |
| `cursor-sdk`   | SDK          | `cursor-sdk/cursor-sdk-agent-service.ts`, `cursor-sdk-stream-adapter.ts`   |
| `opencode-sdk` | SDK (server) | `opencode-sdk/opencode-sdk-agent-service.ts`, `session-event-forwarder.ts` |

---

## 9. Kill / replace matrix (requestStart & daemon recovery)

When a new `agent.requestStart` arrives for the same chatroom+role, `AgentProcessManager.killExistingBeforeSpawn` tears down any live agent before spawning. In-memory slots use `doStop` → harness `stop(pid)`; persisted orphans (daemon restart) use `stopPersistedProcess` → harness `stop(pid)` when the harness is known.

| Harness        | Tracked PID              | Process model                       | `stop()` behavior                                                                                         | requestStart replace           | Persisted orphan                       |
| -------------- | ------------------------ | ----------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------ | -------------------------------------- |
| `opencode`     | Direct `opencode` child  | Single-shot CLI, detached PG        | Base: SIGTERM/SIGKILL group                                                                               | `doStop` → base stop           | `stopPersistedProcess` → base stop     |
| `opencode-sdk` | `opencode serve` server  | SDK client in-process + server PG   | Override: forwarder stop → `session.abort` → base stop; removes session metadata                          | `doStop` → override stop       | `stopPersistedProcess` → override stop |
| `pi`           | Direct `pi` child        | Long-lived RPC, stdin resume        | Base group kill; `untrack` clears `childProcesses`                                                        | `doStop` → base stop + untrack | `stopPersistedProcess` → base stop     |
| `cursor`       | Direct `agent` child     | Single-shot CLI                     | Base group kill                                                                                           | `doStop` → base stop           | `stopPersistedProcess` → base stop     |
| `cursor-sdk`   | Keeper `node -e …` child | SDK in-process + keeper PG          | Override: abort resume wait → `run.cancel` → `agent.close` (skipped when `preserveForResume`) → base stop | `doStop` → override stop       | `stopPersistedProcess` → override stop |
| `claude`       | Direct `claude` child    | Single-shot CLI (agentic turns)     | Base group kill                                                                                           | `doStop` → base stop           | `stopPersistedProcess` → base stop     |
| `claude-sdk`   | Keeper `node -e …` child | SDK in-process + keeper PG          | Override: abort resume wait → `query.interrupt()` → base stop                                             | `doStop` → override stop       | `stopPersistedProcess` → override stop |
| `commandcode`  | Direct `cmd` child       | Long-lived headless (`--max-turns`) | Base group kill                                                                                           | `doStop` → base stop           | `stopPersistedProcess` → base stop     |
| `copilot`      | Direct `copilot` child   | Single-shot CLI                     | Base group kill                                                                                           | `doStop` → base stop           | `stopPersistedProcess` → base stop     |

**Daemon-memory reconnect on stop→start** (`supportsDaemonMemoryResume: true` for `opencode-sdk` and `cursor-sdk`): `wantResume` on `agent.requestStart` controls whether the daemon tries `resumeFromDaemonMemory` when session metadata was preserved:

- **opencode-sdk**: `user.stop` with an active harness session uses `preserveForResume` (skips `session.abort`). `AgentProcessManager.lastHarnessSessions` stores reconnect metadata in daemon memory on spawn and on preserve-for-resume stop; non-preserve stop clears the entry. The next start with `wantResume` calls `OpenCodeSdkAgentService.resumeFromDaemonMemory` (new `opencode serve`, `session.get`, `session.promptAsync` on the same `sessionId`). The daemon emits `agent.sessionResumeRequested` before the reconnect attempt, then `agent.sessionResumed` on success or `agent.sessionResumeFailed` and cold `spawn` on failure. Daemon restart loses memory → fresh spawn (no events). A different `workingDir` clears memory, emits `working directory changed` via `agent.sessionResumeFailed`, then fresh spawn.
- **cursor-sdk**: Same daemon-memory model as opencode-sdk. `spawn` returns `harnessSessionId` (`agent.agentId`) and `harnessReconnect` metadata. `user.stop` with `preserveForResume` skips `agent.close()` so the Cursor agent stays resumable. The next start with `wantResume` calls `CursorSdkAgentService.resumeFromDaemonMemory` (`Agent.resume(agentId)`, then `agent.send` with the spawn prompt). The daemon emits `agent.sessionResumeRequested` before the reconnect attempt, then `agent.sessionResumed` on success or `agent.sessionResumeFailed` and cold `spawn` on failure. Daemon restart loses memory → fresh spawn (no events).

Native harnesses (`cursor-sdk`, `opencode-sdk`, `pi-sdk`, `claude-sdk`) idle in-process after each turn; the daemon injects tasks via `resumeTurnForSlot` instead of turn-end auto-resume.

A **requestStart replace** always kills via `doStop` regardless of resume state.

**Residual risk (all CLI harnesses):** tool subprocesses that call `setsid` and leave the agent PG may survive group kill — upstream CLI behavior, not fixable in Chatroom alone.
