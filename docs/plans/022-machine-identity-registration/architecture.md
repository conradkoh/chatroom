# 022 - Machine Identity Registration: Architecture

## Changes Overview

This plan introduces:

1. **New CLI infrastructure** for machine config management and daemon process
2. **New backend tables** for machines and machine commands
3. **New backend mutations/queries** for registration, command dispatch, and status
4. **Updates to `wait-for-task`** to auto-register machines and sync agent config

## New Components

### CLI: Machine Config Storage

**Location**: `packages/cli/src/infrastructure/machine/`

Manages the local machine configuration file at `~/.chatroom/machine.json`.

```
packages/cli/src/infrastructure/machine/
├── storage.ts      # Load/save machine config
├── detection.ts    # Agent tool detection (which, execSync)
└── types.ts        # Machine config types
```

### CLI: Daemon Process

**Location**: `packages/cli/src/commands/machine/`

Implements the daemon that listens for remote commands.

```
packages/cli/src/commands/machine/
├── daemon-start.ts   # Start daemon, subscribe to commands
├── daemon-stop.ts    # Stop daemon using PID file
├── daemon-status.ts  # Check if daemon is running
├── spawn.ts          # Agent spawn logic per tool type
└── pid.ts            # PID file management
```

### Backend: Machines Module

**Location**: `services/backend/convex/machines.ts`

New Convex module for machine management.

## Modified Components

### CLI: wait-for-task

**File**: `packages/cli/src/commands/wait-for-task.ts`

**Changes**:

- Call `ensureMachineRegistered()` at startup
- Sync agent config (chatroom, role, workingDir, agentType) to backend
- Detect agent type from environment or CLI flag

### CLI: Command Router

**File**: `packages/cli/src/index.ts`

**Changes**:

- Add `machine` command group with subcommands: `daemon start`, `daemon stop`, `daemon status`

## New Contracts

### Machine Config (Local)

```typescript
// ~/.chatroom/machine.json
interface MachineConfig {
  /** UUID generated once per machine */
  machineId: string;
  /** Machine hostname */
  hostname: string;
  /** Operating system (darwin, linux, win32) */
  os: string;
  /** When machine was first registered */
  registeredAt: string;
  /** Last registration sync */
  lastSyncedAt: string;
  /** Agent tools detected as available */
  availableTools: AgentTool[];
  /** Per-chatroom agent configurations */
  chatroomAgents: Record<string, Record<string, AgentContext>>;
}

type AgentTool = 'opencode' | 'claude' | 'cursor';

interface AgentContext {
  /** Which tool was used for this role */
  agentType: AgentTool;
  /** Working directory when agent was started */
  workingDir: string;
  /** Last time this agent was started */
  lastStartedAt: string;
}
```

### Backend: Machines Table

```typescript
// Convex schema addition
machines: defineTable({
  /** UUID from CLI machine config */
  machineId: v.string(),
  /** Owner user ID (from authenticated session) */
  userId: v.id('users'),
  /** Machine hostname */
  hostname: v.string(),
  /** Operating system */
  os: v.string(),
  /** Available agent tools on this machine */
  availableTools: v.array(
    v.union(v.literal('opencode'), v.literal('claude'), v.literal('cursor'))
  ),
  /** When machine was first registered */
  registeredAt: v.number(),
  /** Last heartbeat/sync from CLI */
  lastSeenAt: v.number(),
  /** Whether daemon is currently connected */
  daemonConnected: v.boolean(),
})
  .index('by_machineId', ['machineId'])
  .index('by_userId', ['userId']);
```

### Backend: Machine Agent Configs Table

```typescript
// Convex schema addition
machineAgentConfigs: defineTable({
  /** Reference to machine */
  machineId: v.string(),
  /** Chatroom this config is for */
  chatroomId: v.id('chatrooms'),
  /** Role this config is for */
  role: v.string(),
  /** Agent tool used */
  agentType: v.union(
    v.literal('opencode'),
    v.literal('claude'),
    v.literal('cursor')
  ),
  /** Working directory */
  workingDir: v.string(),
  /** Last updated */
  updatedAt: v.number(),
})
  .index('by_machine_chatroom_role', ['machineId', 'chatroomId', 'role'])
  .index('by_chatroom', ['chatroomId']);
```

### Backend: Machine Commands Table

```typescript
// Convex schema addition
machineCommands: defineTable({
  /** Target machine ID */
  machineId: v.string(),
  /** Command type */
  type: v.union(
    v.literal('start-agent'),
    v.literal('ping'),
    v.literal('status')
  ),
  /** Command payload */
  payload: v.object({
    chatroomId: v.optional(v.id('chatrooms')),
    role: v.optional(v.string()),
    agentTool: v.optional(
      v.union(v.literal('opencode'), v.literal('claude'), v.literal('cursor'))
    ),
  }),
  /** Command status */
  status: v.union(
    v.literal('pending'),
    v.literal('processing'),
    v.literal('completed'),
    v.literal('failed')
  ),
  /** Result or error message */
  result: v.optional(v.string()),
  /** Who sent the command */
  sentBy: v.id('users'),
  /** Timestamps */
  createdAt: v.number(),
  processedAt: v.optional(v.number()),
})
  .index('by_machineId_status', ['machineId', 'status'])
  .index('by_machineId_createdAt', ['machineId', 'createdAt']);
```

### Backend: Mutations

```typescript
// machines.ts mutations

/** Register or update a machine */
interface RegisterMachineArgs {
  machineId: string;
  hostname: string;
  os: string;
  availableTools: AgentTool[];
}

/** Update agent config for a chatroom+role on a machine */
interface UpdateAgentConfigArgs {
  machineId: string;
  chatroomId: Id<'chatrooms'>;
  role: string;
  agentType: AgentTool;
  workingDir: string;
}

/** Send a command to a machine (from web UI) */
interface SendCommandArgs {
  machineId: string;
  type: 'start-agent' | 'ping' | 'status';
  payload?: {
    chatroomId?: Id<'chatrooms'>;
    role?: string;
  };
}

/** Mark command as processed (from daemon) */
interface AckCommandArgs {
  commandId: Id<'machineCommands'>;
  status: 'completed' | 'failed';
  result?: string;
}

/** Update daemon connection status */
interface UpdateDaemonStatusArgs {
  machineId: string;
  connected: boolean;
}
```

### Backend: Queries

```typescript
// machines.ts queries

/** List machines for current user */
interface ListMachinesResult {
  machines: Array<{
    machineId: string;
    hostname: string;
    os: string;
    availableTools: AgentTool[];
    daemonConnected: boolean;
    lastSeenAt: number;
  }>;
}

/** Get pending commands for a machine (daemon subscribes to this) */
interface GetPendingCommandsArgs {
  machineId: string;
}

/** Get agent configs for a chatroom (for web UI to show start buttons) */
interface GetAgentConfigsArgs {
  chatroomId: Id<'chatrooms'>;
}
```

## Data Flow

### Machine Registration Flow

```
┌─────────────────────────────────────────────────────────────┐
│ CLI: chatroom wait-for-task --chatroom-id=X --role=Y        │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 1. Load ~/.chatroom/machine.json                            │
│    - If not exists: generate UUID, detect tools, create     │
│    - If exists: refresh availableTools detection            │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Call machines.register mutation                          │
│    - machineId, hostname, os, availableTools                │
│    - Backend associates with user from sessionId            │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Call machines.updateAgentConfig mutation                 │
│    - chatroomId, role, agentType, workingDir                │
│    - Enables "Start Agent" button in web UI                 │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Update local machine.json with chatroomAgents entry      │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Continue to normal wait-for-task subscription            │
└─────────────────────────────────────────────────────────────┘
```

### Remote Command Flow

```
┌─────────────────────────────────────────────────────────────┐
│ Web UI: User clicks "Start Agent" for builder role          │
│ - Shows machines with available tools for the chatroom      │
│ - User selects machine and tool                             │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Backend: machines.sendCommand mutation                      │
│ - Verify user owns the machine (userId match)               │
│ - Verify machine has the requested tool (availableTools)    │
│ - Create command record with status="pending"               │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Daemon: Subscription triggers on new pending command        │
│ - machines.getPendingCommands(machineId) returns new cmd    │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Daemon: Process command                                     │
│ - Mark command as "processing"                              │
│ - Look up agentConfig for chatroom+role                     │
│ - Spawn agent in workingDir with init prompt                │
│ - Mark command as "completed" or "failed"                   │
└─────────────────────────────────────────────────────────────┘
```

### Agent Spawn Logic

```typescript
// Daemon spawn implementation (packages/cli/src/commands/machine/spawn.ts)

function spawnAgent(
  tool: AgentTool,
  workingDir: string,
  initPrompt: string
): SpawnResult {
  const opts: SpawnOptions = {
    cwd: workingDir,
    stdio: 'inherit',
    detached: true, // Detach so daemon doesn't wait
  };

  switch (tool) {
    case 'opencode':
      // OpenCode: Start interactive session
      // Init prompt can be piped or typed by user
      return spawn('opencode', [], opts);

    case 'claude':
      // Claude: First argument is the prompt
      return spawn('claude', [initPrompt], opts);

    case 'cursor':
      // Cursor: Use chat subcommand with prompt
      return spawn('agent', ['chat', initPrompt], opts);
  }
}
```

## Security Considerations

1. **Machine-User Binding**: Machines are bound to users at registration time via the authenticated sessionId. The backend stores `userId` on the machine record.

2. **Command Authorization**: The `sendCommand` mutation verifies that `ctx.auth.userId === machine.userId` before creating a command.

3. **Server-Side Command Generation**: The client (web UI) only sends `{ machineId, type, chatroomId, role }`. The server determines which tool to use based on the stored `agentConfig` and machine's `availableTools`.

4. **No Arbitrary Commands**: The daemon only executes predefined command types (`start-agent`, `ping`, `status`). The spawn logic is hardcoded per tool type, preventing command injection.

5. **PID File Validation**: The daemon validates the PID file to prevent multiple instances, ensuring predictable command processing.
