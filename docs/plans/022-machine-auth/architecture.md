# Machine Authentication - Architecture

## Changes Overview

This plan introduces a new subsystem for machine registration and command delivery. It spans the backend (Convex), CLI, and webapp with a focus on security and real-time communication.

## New Components

### Backend (Convex)

**Schema Additions** (`convex/schema.ts`):
- `machines` table for registered machine records
- `machine_commands` table for command queue/history

**New Module** (`convex/machine/`):

All machine-related functions are consolidated under a single `machine` module for a clean, consistent API:

```
convex/machine/
├── index.ts      # Machine CRUD: register, list, get, updateActivity
├── commands.ts   # Command operations: send, acknowledge, report
└── config.ts     # Whitelist configuration and sanitizers
```

**Consumer API** (from `api.machine.*`):
- `api.machine.register` - Register a new machine
- `api.machine.list` - List user's machines
- `api.machine.get` - Get a single machine
- `api.machine.updateActivity` - Update lastActiveAt timestamp
- `api.machine.commands.send` - Send a command to a machine
- `api.machine.commands.getNext` - Get next pending command (for CLI subscription)
- `api.machine.commands.acknowledge` - Mark command as delivered
- `api.machine.commands.reportResult` - Report command execution result

### CLI

**New Commands** (`packages/cli/src/commands/`):
- `machine-register.ts` - Register the current machine
- `machine-start.ts` - Start listening for commands
- `machine-list.ts` - List registered machines

### Webapp

**New Components** (`apps/webapp/src/modules/`):
- `machines/` - Machine management module
  - `MachineList.tsx` - Display registered machines
  - `MachineCard.tsx` - Individual machine display
  - `MachineCommandPanel.tsx` - Send commands to a machine

## Modified Components

### Backend

- `convex/auth.ts` - Add machine token validation helpers

### CLI

- `packages/cli/src/index.ts` - Register new machine commands

### Webapp

- Navigation/sidebar - Add link to machine management

## New Contracts

### Machine Entity

```typescript
interface Machine {
  _id: Id<"machines">;
  _creationTime: number;
  userId: Id<"users">;
  name: string;
  machineToken: string; // Hashed, never exposed
  lastActiveAt?: number;
  registeredAt: number;
  metadata?: {
    hostname?: string;
    os?: string;
    arch?: string;
  };
}
```

### Machine Command Entity

```typescript
interface MachineCommand {
  _id: Id<"machine_commands">;
  _creationTime: number;
  machineId: Id<"machines">;
  senderId: Id<"users">;
  commandType: WhitelistedCommandType;
  payload: Record<string, unknown>;
  status: "pending" | "delivered" | "executed" | "failed";
  deliveredAt?: number;
  executedAt?: number;
  result?: string;
}

type WhitelistedCommandType = "test" | "ping"; // Extensible enum
```

### Command Whitelist Configuration

```typescript
interface CommandWhitelist {
  [commandType: string]: {
    description: string;
    allowedPayloadKeys: string[];
    sanitizers: Record<string, (value: unknown) => unknown>;
  };
}
```

### Machine Registration Args

```typescript
interface RegisterMachineArgs {
  name: string;
  metadata?: {
    hostname?: string;
    os?: string;
    arch?: string;
  };
}

interface RegisterMachineResult {
  machineId: Id<"machines">;
  machineToken: string; // Only returned once, at registration
}
```

### Send Command Args

```typescript
interface SendCommandArgs {
  machineId: Id<"machines">;
  commandType: WhitelistedCommandType;
  payload?: Record<string, unknown>;
}
```

### Wait for Command Response

```typescript
interface WaitForCommandResult {
  command: MachineCommand | null;
  shouldRetry: boolean;
}
```

## Data Flow

### Machine Registration Flow

```
┌──────────┐   1. chatroom machine register   ┌──────────┐
│   CLI    │ ────────────────────────────────>│  Backend │
│          │                                   │ (Convex) │
│          │   2. Return machineId + token    │          │
│          │ <────────────────────────────────│          │
└──────────┘                                   └──────────┘
     │
     │ 3. Store token locally (~/.chatroom/machine.json)
     ▼
┌──────────┐
│  Local   │
│  Config  │
└──────────┘
```

### Command Execution Flow

```
┌──────────┐   1. Click "Send test command"   ┌──────────┐
│  Webapp  │ ────────────────────────────────>│  Backend │
│   (UI)   │                                   │ (Convex) │
└──────────┘                                   │          │
                                               │          │
                2. Validate:                   │          │
                - User is machine owner        │          │
                - Command is whitelisted       │          │
                - Payload is sanitized         │          │
                                               │          │
                3. Insert into machine_commands│          │
                                               │          │
┌──────────┐   4. Subscription update          │          │
│   CLI    │ <────────────────────────────────│          │
│ (machine │                                   │          │
│  start)  │   5. Execute command              │          │
│          │                                   │          │
│          │   6. Report result                │          │
│          │ ────────────────────────────────>│          │
└──────────┘                                   └──────────┘
```

## Security Architecture

### Command Whitelisting

All commands must be defined in a backend whitelist:

```typescript
// convex/machine/config.ts
export const COMMAND_WHITELIST: CommandWhitelist = {
  test: {
    description: "A test command to verify connectivity",
    allowedPayloadKeys: [],
    sanitizers: {},
  },
  ping: {
    description: "Ping the machine to check if it's alive",
    allowedPayloadKeys: ["message"],
    sanitizers: {
      message: (v) => String(v).slice(0, 100).replace(/[<>]/g, ""),
    },
  },
};
```

### Ownership Verification

Every `machine.commands.*` endpoint must verify ownership:

```typescript
// Pseudocode for ownership check
async function verifyMachineOwnership(
  ctx: MutationCtx,
  machineId: Id<"machines">,
  userId: Id<"users">
): Promise<void> {
  const machine = await ctx.db.get(machineId);
  if (!machine || machine.userId !== userId) {
    throw new ConvexError({
      code: "UNAUTHORIZED",
      message: "You do not have access to this machine",
    });
  }
}
```

### Input Sanitization

All user-provided payload values must be sanitized:

1. Validate payload keys against whitelist
2. Apply type-specific sanitizers
3. Reject any unrecognized keys
4. Limit string lengths to prevent abuse

## Integration Points

### Authentication Flow

Machines authenticate using a token stored locally after registration:

1. User runs `chatroom auth login` (prerequisite)
2. User runs `chatroom machine register`
3. Backend generates secure machine token
4. Token stored in `~/.chatroom/machine.json`
5. Subsequent commands include token for authentication

### WebSocket/Subscription

The `machine.waitForCommand` uses Convex subscriptions:

1. CLI subscribes to pending commands for this machine
2. Backend pushes new commands in real-time
3. CLI processes and acknowledges receipt
4. Automatic reconnection on connection loss
