# Harness Implementation Guide

End-to-end steps for adding a new remote agent harness to the Chatroom CLI.

**Harness kinds**

| Kind | When to use | Examples |
|------|-------------|----------|
| **CLI-based** | The runtime is a subprocess with stdout/stderr you parse | `cursor`, `claude`, `pi`, `opencode`, `copilot`, `commandcode` |
| **SDK-based** | The runtime is a Node SDK (in-process API) | `cursor-sdk`, `opencode-sdk` |

Both kinds implement the same `RemoteAgentService` contract and register in `init-registry.ts`.

---

## 1. The `RemoteAgentService` contract

Defined in `remote-agent-service.ts`. Every harness must provide:

| Member | Purpose |
|--------|---------|
| `id` | Stable identifier stored in DB/config (e.g. `'cursor'`) |
| `displayName` | Human label for the UI |
| `command` | CLI binary used for install detection (even SDK harnesses often gate on a binary) |
| `isInstalled()` | Async check — hide harness from picker when false |
| `getVersion()` | Semver or null |
| `listModels()` | Available model IDs |
| `spawn(options)` | Start a turn; return PID + lifecycle callbacks |
| `stop(pid)` | SIGTERM → wait → SIGKILL (override when SDK cleanup is needed) |
| `isAlive(pid)` | Process still running? |
| `getTrackedProcesses()` / `untrack(pid)` | Registry for daemon idle detection |

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
- `onAgentEnd?(cb)` — optional; fires when the agent completes a turn (Pi, Cursor, SDK harnesses)

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

| Mode | Behaviour | Examples |
|------|-----------|----------|
| **Single-shot** | Process exits after one turn; daemon respawns for next message | `cursor`, `claude`, `commandcode` |
| **Long-lived** | Process stays up; future prompts sent over stdin | `pi` (RPC mode) |

Implement `onAgentEnd` when the daemon should restart the process between turns.

---

## 4. SDK-based harness pattern

Use when integration happens through a Node SDK rather than parsing CLI stdout.

Reference implementations: `cursor-sdk/` (in-process SDK + keeper PID), `opencode-sdk/` (spawn server + SDK client).

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

See `cursor-sdk-agent-service.ts`.

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

return { pid, onExit, onOutput, onAgentEnd };
```

Collect callbacks in arrays (`exitCallbacks`, `outputCallbacks`) and invoke them from the IIFE when events occur.

### 4.4 Stream adapter

Map SDK message types to the same log format CLI harnesses use. Example: `CursorSdkStreamAdapter` handles `SDKMessage` events and writes `[cursor-sdk:role@chatroom text]` lines.

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

Pattern (see `cursor-sdk-agent-service.test.ts`, `opencode-sdk-agent-service.test.ts`):

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

| ID | Kind | Key files |
|----|------|-----------|
| `claude` | CLI | `claude/claude-code-agent-service.ts`, `claude-stream-reader.ts` |
| `commandcode` | CLI | `commandcode/command-code-agent-service.ts` |
| `copilot` | CLI | `copilot/copilot-agent-service.ts` |
| `cursor` | CLI | `cursor/cursor-agent-service.ts`, `cursor-stream-reader.ts` |
| `opencode` | CLI | `opencode/opencode-agent-service.ts` |
| `pi` | CLI (RPC) | `pi/pi-agent-service.ts`, `pi-rpc-reader.ts` |
| `cursor-sdk` | SDK | `cursor-sdk/cursor-sdk-agent-service.ts`, `cursor-sdk-stream-adapter.ts` |
| `opencode-sdk` | SDK (server) | `opencode-sdk/opencode-sdk-agent-service.ts`, `session-event-forwarder.ts` |

---

## 9. Kill / replace matrix (requestStart & daemon recovery)

When a new `agent.requestStart` arrives for the same chatroom+role, `AgentProcessManager.killExistingBeforeSpawn` tears down any live agent before spawning. In-memory slots use `doStop` → harness `stop(pid)`; persisted orphans (daemon restart) use `stopPersistedProcess` → harness `stop(pid)` when the harness is known.

| Harness | Tracked PID | Process model | `stop()` behavior | requestStart replace | Persisted orphan |
|---------|-------------|---------------|-------------------|----------------------|------------------|
| `opencode` | Direct `opencode` child | Single-shot CLI, detached PG | Base: SIGTERM/SIGKILL group | `doStop` → base stop | `stopPersistedProcess` → base stop |
| `opencode-sdk` | `opencode serve` server | SDK client in-process + server PG | Override: forwarder stop → `session.abort` → base stop; removes session metadata | `doStop` → override stop | `stopPersistedProcess` → override stop |
| `pi` | Direct `pi` child | Long-lived RPC, stdin resume | Base group kill; `untrack` clears `childProcesses` | `doStop` → base stop + untrack | `stopPersistedProcess` → base stop |
| `cursor` | Direct `agent` child | Single-shot CLI | Base group kill | `doStop` → base stop | `stopPersistedProcess` → base stop |
| `cursor-sdk` | Keeper `node -e …` child | SDK in-process + keeper PG | Override: abort resume wait → `run.cancel` → `agent.close` → base stop | `doStop` → override stop | `stopPersistedProcess` → override stop |
| `claude` | Direct `claude` child | Single-shot CLI (agentic turns) | Base group kill | `doStop` → base stop | `stopPersistedProcess` → base stop |
| `commandcode` | Direct `cmd` child | Long-lived headless (`--max-turns`) | Base group kill | `doStop` → base stop | `stopPersistedProcess` → base stop |
| `copilot` | Direct `copilot` child | Single-shot CLI | Base group kill | `doStop` → base stop | `stopPersistedProcess` → base stop |

**Resumable harnesses** (`pi`, `opencode-sdk`, `cursor-sdk`): after a normal turn, `handleAgentEnd` always calls `resumeTurn` instead of kill. On first launch, `wantResume` on `agent.requestStart` controls whether the daemon tries to reconnect to its in-memory last session (emitting `agent.sessionResumed` or `agent.sessionResumeFailed` for observability). A **requestStart replace** always kills via `doStop` regardless of resume state.

**Residual risk (all CLI harnesses):** tool subprocesses that call `setsid` and leave the agent PG may survive group kill — upstream CLI behavior, not fixable in Chatroom alone.
