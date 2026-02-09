# 023 - Unified Agent Tool Interface — Phases

## Phase Breakdown

### Phase 1: Core interface & process-based drivers (foundation)

**Goal**: Define the `AgentToolDriver` interface and migrate existing spawn logic into driver implementations without changing any behavior.

**Tasks**:
1. Create `packages/cli/src/infrastructure/agent-drivers/types.ts` with `AgentToolDriver`, `AgentCapabilities`, `AgentHandle`, `AgentStartOptions`, `DriverRegistry` interfaces
2. Create `process-driver.ts` — base class that wraps the existing `child_process.spawn` pattern
3. Create `claude-driver.ts` — extends process driver with Claude-specific args (`--print`, stdin prompt)
4. Create `cursor-driver.ts` — extends process driver with Cursor-specific args (`chat --file`, temp file)
5. Create `opencode-process-driver.ts` — wraps existing `opencode run` spawn logic (SDK integration comes in Phase 2)
6. Create `registry.ts` — maps `AgentTool` → driver instance
7. Create `index.ts` — public API exports

**Verification**:
- All existing tests pass (no behavior changes)
- Typecheck passes
- `spawnAgent()` can be reimplemented as a thin wrapper around the registry

### Phase 2: Daemon integration

**Goal**: Replace the switch statement in `daemon-start.ts` with driver-based dispatch.

**Tasks**:
1. Update `daemon-start.ts` to resolve driver from registry instead of calling `spawnAgent()` directly
2. Store `AgentHandle` data in Convex (update `chatroom_machineAgentConfigs` schema)
3. Update stop-agent handler to use `driver.stop(handle)` instead of direct PID kill
4. Deprecate `spawn.ts` (keep as re-export wrapper for backward compatibility)

**Verification**:
- Starting/stopping agents works identically to before
- All existing tests pass
- `AgentHandle` data round-trips through Convex correctly

### Phase 3: Capability discovery & UI adaptation

**Goal**: Report driver capabilities to the backend and adapt the UI based on what each tool supports.

**Tasks**:
1. Add `toolCapabilities` field to machine registration in `storage.ts` and `machines.ts`
2. Update machine registration to include capabilities alongside `availableTools`
3. Update frontend types (`machine.ts`) to include capabilities
4. Update `AgentPanel.tsx` and `ChatroomAgentDetailsModal.tsx` to conditionally render controls based on capabilities
5. Remove hardcoded `TOOL_MODELS` — use `dynamicModelDiscovery` capability + `driver.listModels()` instead

**Verification**:
- UI shows correct controls per tool
- Model dropdown only appears for tools that support it
- Capabilities are visible in machine info

### Phase 4: OpenCode SDK driver

**Goal**: Replace the process-based OpenCode driver with an SDK-based driver that supports session persistence.

**Tasks**:
1. Add `@opencode-ai/sdk` dependency to `packages/cli`
2. Create `opencode-sdk-driver.ts` implementing `AgentToolDriver` with full capabilities
3. Implement `start()` — uses `createOpencode()` or connects to existing server, creates session, sends prompt
4. Implement `stop()` — uses `session.abort()`
5. Implement `isAlive()` — queries session status
6. Implement `recover()` — queries `session.list()` to find active sessions
7. Implement `listModels()` — queries OpenCode's provider/model API
8. Persist server URLs and session IDs in local machine config
9. Register the SDK driver in the registry (replacing the process-based one)

**Verification**:
- OpenCode agents start via SDK and run headlessly
- Sessions persist across daemon restarts
- `recover()` correctly reconnects to orphaned sessions
- Model listing works dynamically

### Phase 5: Daemon state recovery

**Goal**: Implement robust daemon restart recovery for all driver types.

**Tasks**:
1. On daemon start, call `driver.recover(workingDir)` for each registered tool
2. Reconcile recovered handles with Convex `chatroom_machineAgentConfigs` state
3. For process drivers: verify PIDs with `kill -0` + ownership check
4. For SDK drivers: verify sessions via SDK API
5. Clear stale entries from Convex where agents are no longer running
6. Update UI to reflect recovered state

**Verification**:
- Kill and restart daemon → running agents are rediscovered
- Stale PIDs/sessions are cleaned up
- Convex state is consistent after recovery

## Phase Dependencies

```
Phase 1 (interface + process drivers)
  └── Phase 2 (daemon integration)
        ├── Phase 3 (capability discovery + UI)
        └── Phase 4 (OpenCode SDK driver)
              └── Phase 5 (state recovery)
```

Phase 3 and Phase 4 can be developed in parallel after Phase 2.

## Success Criteria

| Phase | Criterion |
| --- | --- |
| Phase 1 | All existing tests pass. No behavioral changes. Drivers are testable in isolation. |
| Phase 2 | Agent start/stop works through unified interface. Old `spawn.ts` is deprecated. |
| Phase 3 | UI adapts controls based on tool capabilities. No hardcoded model lists. |
| Phase 4 | OpenCode sessions persist and can be recovered. SDK replaces process spawn. |
| Phase 5 | Daemon restart recovers all running agents. Convex state is consistent. |
