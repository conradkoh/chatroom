# 022 - Machine Identity Registration: Implementation Phases

## Phase Breakdown

### Phase 1: Machine Config Infrastructure (CLI)

**Goal**: Create the local machine config storage and tool detection utilities.

**Tasks**:

1. Create `packages/cli/src/infrastructure/machine/types.ts` - Type definitions
2. Create `packages/cli/src/infrastructure/machine/storage.ts` - Load/save machine.json
3. Create `packages/cli/src/infrastructure/machine/detection.ts` - Agent tool detection
4. Add unit tests for detection and storage

**Files**:

- `packages/cli/src/infrastructure/machine/types.ts` (new)
- `packages/cli/src/infrastructure/machine/storage.ts` (new)
- `packages/cli/src/infrastructure/machine/detection.ts` (new)
- `packages/cli/src/infrastructure/machine/index.ts` (new)

**Success Criteria**:

- Can create/load machine.json with generated UUID
- Can detect installed agent tools (opencode, claude, cursor)
- Machine config persists across CLI invocations

---

### Phase 2: Backend Schema & Mutations

**Goal**: Add backend tables and mutations for machine registration.

**Tasks**:

1. Add `machines` table to schema.ts
2. Add `machineAgentConfigs` table to schema.ts
3. Add `machineCommands` table to schema.ts
4. Create `machines.ts` with register, updateAgentConfig mutations
5. Create queries: listMachines, getAgentConfigs

**Files**:

- `services/backend/convex/schema.ts` (modify)
- `services/backend/convex/machines.ts` (new)

**Success Criteria**:

- Tables created and indexed properly
- Can register a machine via mutation
- Can update agent config for chatroom+role
- User ownership is enforced

---

### Phase 3: Auto-Registration in wait-for-task

**Goal**: Automatically register machine and sync config when running wait-for-task.

**Tasks**:

1. Import machine storage utilities in wait-for-task
2. Call `ensureMachineRegistered()` at startup (idempotent)
3. Call `machines.register` mutation with detected tools
4. Call `machines.updateAgentConfig` with chatroom, role, cwd
5. Add `--agent-type` flag for explicit tool specification (optional)

**Files**:

- `packages/cli/src/commands/wait-for-task.ts` (modify)

**Success Criteria**:

- First run creates ~/.chatroom/machine.json
- Machine appears in backend after wait-for-task
- Agent config synced with correct working directory
- Subsequent runs update lastSeenAt, re-detect tools

---

### Phase 4: Daemon Infrastructure

**Goal**: Implement the daemon process with PID file management.

**Tasks**:

1. Create `packages/cli/src/commands/machine/pid.ts` - PID file utilities
2. Create `packages/cli/src/commands/machine/daemon-start.ts` - Start command
3. Create `packages/cli/src/commands/machine/daemon-stop.ts` - Stop command
4. Create `packages/cli/src/commands/machine/daemon-status.ts` - Status command
5. Register commands in CLI router

**Files**:

- `packages/cli/src/commands/machine/pid.ts` (new)
- `packages/cli/src/commands/machine/daemon-start.ts` (new)
- `packages/cli/src/commands/machine/daemon-stop.ts` (new)
- `packages/cli/src/commands/machine/daemon-status.ts` (new)
- `packages/cli/src/commands/machine/index.ts` (new)
- `packages/cli/src/index.ts` (modify)

**Success Criteria**:

- `chatroom machine daemon start` starts daemon and writes PID file
- Second `daemon start` fails with "already running" message
- `daemon status` shows running/not running state
- `daemon stop` cleanly terminates daemon

---

### Phase 5: Command Subscription & Processing

**Goal**: Daemon subscribes to pending commands and processes them.

**Tasks**:

1. Add `getPendingCommands` query to machines.ts
2. Add `ackCommand` mutation to machines.ts
3. Implement command subscription in daemon-start.ts
4. Create `packages/cli/src/commands/machine/spawn.ts` - Agent spawn logic
5. Handle start-agent command type

**Files**:

- `services/backend/convex/machines.ts` (modify)
- `packages/cli/src/commands/machine/daemon-start.ts` (modify)
- `packages/cli/src/commands/machine/spawn.ts` (new)

**Success Criteria**:

- Daemon subscribes to command channel
- Commands transition: pending → processing → completed/failed
- Agents spawn in correct directory with init prompt
- Spawn errors are captured and reported

---

### Phase 6: Send Command Mutation & Authorization

**Goal**: Web UI can send commands to machines with proper authorization.

**Tasks**:

1. Add `sendCommand` mutation with user ownership check
2. Add `updateDaemonStatus` mutation for heartbeat
3. Verify tool availability before creating command
4. Generate init prompt server-side

**Files**:

- `services/backend/convex/machines.ts` (modify)

**Success Criteria**:

- Only machine owner can send commands
- Commands rejected if tool not in availableTools
- Daemon heartbeat updates connection status
- Init prompt generated from team config

---

## Phase Dependencies

```
Phase 1 (CLI Config) ──┬──▶ Phase 3 (Auto-Registration)
                       │
Phase 2 (Backend) ─────┴──▶ Phase 3 (Auto-Registration)
                       │
                       └──▶ Phase 4 (Daemon) ──▶ Phase 5 (Commands)
                                                      │
                                                      ▼
                                              Phase 6 (Authorization)
```

**Parallel work possible**:

- Phase 1 and Phase 2 can be done in parallel
- Phase 4 can start after Phase 2 (needs backend types)

---

## Success Criteria Summary

| Phase | Key Verification                                                |
| ----- | --------------------------------------------------------------- |
| 1     | `~/.chatroom/machine.json` created with UUID and detected tools |
| 2     | Backend tables exist, mutations work in Convex dashboard        |
| 3     | `wait-for-task` registers machine, visible in backend           |
| 4     | Daemon lifecycle commands work (start/stop/status)              |
| 5     | Remote command processed, agent spawned                         |
| 6     | Unauthorized users cannot send commands                         |

---

## Testing Notes

### Manual Testing

1. **Phase 1**: Run detection utility manually, verify correct tools detected
2. **Phase 2**: Use Convex dashboard to call mutations directly
3. **Phase 3**: Run `wait-for-task`, check backend for machine record
4. **Phase 4**: Start/stop daemon, verify PID file behavior
5. **Phase 5**: Create command in Convex dashboard, watch daemon process it
6. **Phase 6**: Attempt command from different user session (should fail)

### Integration Testing

- Test machine registration survives CLI restarts
- Test daemon handles subscription reconnection
- Test spawn handles missing tool gracefully (e.g., tool uninstalled)
