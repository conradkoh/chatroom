# 023 - Unified Agent Tool Interface — Architecture

## Changes Overview

Replace the monolithic `spawnAgent()` function and its switch statement with a driver-based architecture. Each AI tool gets its own driver class that implements a shared interface. The daemon resolves drivers from a registry and interacts with them through the common contract.

## New Components

### Driver Interface & Capabilities

```
packages/cli/src/infrastructure/agent-drivers/
├── types.ts              # AgentToolDriver interface + AgentCapabilities
├── registry.ts           # Driver registry: AgentTool → driver instance
├── process-driver.ts     # Base class for process-based drivers (Claude, Cursor)
├── opencode-driver.ts    # OpenCode SDK-based driver
├── claude-driver.ts      # Claude Code process-based driver
├── cursor-driver.ts      # Cursor CLI process-based driver
└── index.ts              # Public API exports
```

## New Contracts

### AgentCapabilities — What a tool supports

```typescript
interface AgentCapabilities {
  /** Can persist and resume sessions across restarts */
  sessionPersistence: boolean;
  /** Can abort a running agent without killing the process */
  abort: boolean;
  /** Supports selecting a specific AI model */
  modelSelection: boolean;
  /** Can compact/summarize conversation context */
  compaction: boolean;
  /** Can stream real-time events (tool calls, messages) */
  eventStreaming: boolean;
  /** Can inject messages into an existing session */
  messageInjection: boolean;
  /** Can list available models dynamically */
  dynamicModelDiscovery: boolean;
}
```

### AgentToolDriver — Common interface for all tools

```typescript
interface AgentToolDriver {
  /** Tool identifier */
  readonly tool: AgentTool;

  /** Static capability declaration */
  readonly capabilities: AgentCapabilities;

  /**
   * Start an agent session/process.
   * Returns a handle for further interaction.
   */
  start(options: AgentStartOptions): Promise<AgentHandle>;

  /**
   * Stop/abort an agent by its handle.
   * For process-based: sends SIGTERM.
   * For session-based: calls abort API.
   */
  stop(handle: AgentHandle): Promise<void>;

  /**
   * Check if an agent is still running/active.
   * For process-based: checks PID liveness.
   * For session-based: queries session status.
   */
  isAlive(handle: AgentHandle): Promise<boolean>;

  /**
   * Recover handles for agents that survived a daemon restart.
   * Returns handles for all recoverable agents managed by this driver.
   */
  recover(workingDir: string): Promise<AgentHandle[]>;

  /**
   * List available models (if dynamicModelDiscovery is true).
   * Returns empty array if not supported.
   */
  listModels(): Promise<string[]>;
}
```

### AgentStartOptions — Input for starting an agent

```typescript
interface AgentStartOptions {
  /** Working directory to run in */
  workingDir: string;
  /** Role prompt (system-level instructions) */
  rolePrompt: string;
  /** Initial message (first user message) */
  initialMessage: string;
  /** AI model to use (if modelSelection capability is true) */
  model?: string;
  /** Tool version for version-specific logic */
  toolVersion?: ToolVersionInfo;
}
```

### AgentHandle — Opaque reference to a running agent

```typescript
interface AgentHandle {
  /** Tool that owns this handle */
  tool: AgentTool;
  /** Handle type determines how to interact with the agent */
  type: 'process' | 'session';
  /** Process-based: OS PID */
  pid?: number;
  /** Session-based: SDK session ID */
  sessionId?: string;
  /** Session-based: server URL for reconnection */
  serverUrl?: string;
  /** Working directory the agent is running in */
  workingDir: string;
}
```

### DriverRegistry — Resolving drivers by tool name

```typescript
interface DriverRegistry {
  /** Get the driver for a specific tool */
  get(tool: AgentTool): AgentToolDriver;

  /** Get all registered drivers */
  all(): AgentToolDriver[];

  /** Get capabilities for a tool */
  capabilities(tool: AgentTool): AgentCapabilities;
}
```

## Modified Components

### `daemon-start.ts`
- **Before**: Switch on `command.payload.agentTool` → call `spawnAgent()`
- **After**: Resolve driver from registry → call `driver.start(options)`
- **Recovery**: On daemon start, iterate all drivers → call `driver.recover()` → reconcile with Convex state

### `spawn.ts`
- **Before**: Monolithic `spawnAgent()` with tool-specific switch cases
- **After**: Deprecated. Logic migrated into individual driver implementations.

### Machine registration (`storage.ts`)
- **Before**: Stores `availableTools: AgentTool[]`
- **After**: Also stores `toolCapabilities: Record<AgentTool, AgentCapabilities>`
- Detection logic queries each driver's capabilities

### Backend schema (`schema.ts`)
- Add `capabilities` field to `chatroom_machines` for reporting driver capabilities to the UI
- Add `sessionId` and `serverUrl` to `chatroom_machineAgentConfigs` for session-based drivers

### Frontend (`AgentPanel.tsx`, `ChatroomAgentDetailsModal.tsx`)
- Query per-tool capabilities from machine data
- Conditionally render model selector, abort button, etc. based on capabilities
- For session-based tools, show session status instead of PID

## Data Flow Changes

### Current flow (process-based):
```
UI → sendCommand → Convex → Daemon → spawn.ts → child_process.spawn → PID stored in Convex
```

### New flow (unified):
```
UI → sendCommand → Convex → Daemon → registry.get(tool) → driver.start() → AgentHandle → stored in Convex
```

### Recovery flow (daemon restart):
```
Daemon starts → for each driver: driver.recover(workingDir) → AgentHandle[] → reconcile with Convex state
```

## Integration Changes

### New dependency: `@opencode-ai/sdk`
- Added to `packages/cli/package.json`
- Used only in `opencode-driver.ts`
- Other drivers have no new dependencies

### OpenCode server management
- The OpenCode driver manages one `opencode serve` instance per working directory
- Server URLs and session IDs are persisted in the local machine config file
- On daemon start, existing servers are rediscovered via stored URLs
