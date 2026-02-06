# 023 - Unified Agent Tool Interface — PRD

## Glossary

| Term | Definition |
| --- | --- |
| **AgentToolDriver** | A standardized interface that encapsulates all interactions with a specific AI coding agent tool |
| **Capability** | A discrete feature that a driver may or may not support (e.g., session persistence, abort, compaction) |
| **Session-based driver** | A driver that manages agent interactions through persistent sessions (e.g., OpenCode SDK) |
| **Process-based driver** | A driver that manages agent interactions by spawning and tracking OS processes (e.g., Claude, Cursor) |
| **Driver Registry** | A mapping from `AgentTool` identifiers to their `AgentToolDriver` implementations |
| **Capability Discovery** | The mechanism by which consumers query what features a specific driver supports |

## User Stories

### US-1: Daemon uses unified interface to start agents
As a daemon process, I want to start any agent tool through the same interface so that I don't need tool-specific branching logic in my command handler.

**Acceptance Criteria:**
- Daemon resolves the driver from the registry using the tool name
- Calls `driver.start(options)` regardless of which tool it is
- Each tool's driver handles its own spawn/session logic internally

### US-2: UI shows available capabilities per tool
As a user viewing the agent panel, I want to see which features are available for each tool (e.g., "supports model selection", "supports abort") so that the UI only shows relevant controls.

**Acceptance Criteria:**
- Each driver exposes a `capabilities` object
- The UI queries capabilities to conditionally render controls (model dropdown, abort button, etc.)
- Capabilities are reported to the backend during machine registration

### US-3: OpenCode uses SDK for session-based control
As a daemon operator, I want OpenCode agents to be managed via the SDK so that sessions persist across daemon restarts, and I can abort/restart agents without killing processes.

**Acceptance Criteria:**
- OpenCode driver uses `@opencode-ai/sdk` to create and manage sessions
- Sessions are identified by ID and can be resumed
- Session IDs are persisted locally and in Convex for recovery

### US-4: Claude and Cursor continue working via process spawn
As a daemon operator, I want Claude Code and Cursor to continue working via the existing process-based approach so that no existing functionality breaks.

**Acceptance Criteria:**
- Claude and Cursor drivers implement the same `AgentToolDriver` interface
- Internally they use `child_process.spawn` with `shell: false`
- Stop/abort sends SIGTERM to the tracked PID

### US-5: Daemon recovers agent state after restart
As a daemon operator, I want the daemon to detect which agents are still running after a restart so that I can reconnect to them without user intervention.

**Acceptance Criteria:**
- For session-based drivers: query the SDK for active sessions and reconcile with Convex state
- For process-based drivers: check if tracked PIDs are still alive via `kill -0`
- Update Convex `spawnedAgentPid` / session state accordingly
