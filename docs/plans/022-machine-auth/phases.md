# Machine Authentication - Implementation Phases

## Phase Overview

| Phase | Description | Dependencies |
|-------|-------------|--------------|
| 1 | Schema & Core Backend | None |
| 2 | Machine Registration CLI | Phase 1 |
| 3 | Machine List UI | Phase 1 |
| 4 | Command Infrastructure | Phase 1 |
| 5 | CLI Command Listener | Phase 4 |
| 6 | UI Command Sending | Phase 3, 4 |
| 7 | Security Hardening | Phase 1-6 |

---

## Phase 1: Schema & Core Backend

### Goal
Establish the database schema and core backend functions for machine management.

### Tasks

1. **Add schema definitions** (`convex/schema.ts`)
   - Add `machines` table with fields: userId, name, machineToken, lastActiveAt, registeredAt, metadata
   - Add `machine_commands` table with fields: machineId, senderId, commandType, payload, status, timestamps

2. **Create machine module** (`convex/machine/index.ts`)
   - `register` mutation - Create machine record with hashed token
   - `list` query - List machines for current user
   - `get` query - Get single machine by ID
   - `updateActivity` mutation - Update lastActiveAt timestamp
   
   Consumer API: `api.machine.register`, `api.machine.list`, `api.machine.get`, `api.machine.updateActivity`

3. **Create command whitelist config** (`convex/machine/config.ts`)
   - Define `COMMAND_WHITELIST` constant
   - Add `test` command as the only initially supported command
   - Add sanitization utilities
   - Export `verifyMachineOwnership` helper for ownership checks

### Success Criteria
- Schema migration runs successfully
- Can create and query machine records via Convex dashboard
- Ownership verification rejects unauthorized access

### Estimated Scope
~100-150 lines of code

---

## Phase 2: Machine Registration CLI

### Goal
Implement the CLI commands for machine registration and listing.

### Tasks

1. **Create machine register command** (`packages/cli/src/commands/machine-register.ts`)
   - Check if user is authenticated (prerequisite)
   - Check if machine is already registered (read local config)
   - If not registered, call `api.machine.register` mutation
   - Store machine token in `~/.chatroom/machine.json`
   - Display registration confirmation

2. **Create machine list command** (`packages/cli/src/commands/machine-list.ts`)
   - Call `api.machine.list` query
   - Display table of registered machines
   - Show last active time, registration date

3. **Add local machine config** (`packages/cli/src/config/machine.ts`)
   - Read/write machine token to local file
   - Secure file permissions (600)

4. **Register commands in CLI** (`packages/cli/src/index.ts`)
   - Add `machine register` subcommand
   - Add `machine list` subcommand

### Success Criteria
- `chatroom machine register` successfully registers a new machine
- `chatroom machine list` shows registered machines
- Machine token persists across sessions

### Estimated Scope
~150-200 lines of code

---

## Phase 3: Machine List UI

### Goal
Display registered machines in the webapp.

### Tasks

1. **Create machine list component** (`apps/webapp/src/modules/machines/MachineList.tsx`)
   - Fetch machines using `listMachines` query
   - Display as cards or list items
   - Show machine name, last active, registration date

2. **Create machine card component** (`apps/webapp/src/modules/machines/MachineCard.tsx`)
   - Display individual machine info
   - Show online/offline status based on lastActiveAt
   - Placeholder for command buttons (Phase 6)

3. **Add navigation entry**
   - Add "Machines" link to sidebar/navigation
   - Create machines page route

### Success Criteria
- Machines page shows user's registered machines
- Machine cards display correctly
- Empty state shown when no machines registered

### Estimated Scope
~100-150 lines of code

---

## Phase 4: Command Infrastructure

### Goal
Build the backend infrastructure for sending and receiving commands.

### Tasks

1. **Create command module** (`convex/machine/commands.ts`)
   - `send` mutation - Send a command to a machine
     - Verify user is machine owner
     - Validate command type against whitelist
     - Sanitize payload
     - Insert command record with status "pending"
   - `getNext` query - Get next pending command for a machine
   - `acknowledge` mutation - Mark command as delivered
   - `reportResult` mutation - Update command with execution result
   
   Consumer API: `api.machine.commands.send`, `api.machine.commands.getNext`, `api.machine.commands.acknowledge`, `api.machine.commands.reportResult`

2. **Add command subscription** (`convex/machine/commands.ts`)
   - Query that returns pending commands for a machine
   - Suitable for use with Convex subscription

3. **Add command types** (`convex/machine/types.ts`)
   - TypeScript interfaces for all command-related types
   - Export for use in CLI and webapp

### Success Criteria
- Commands can be created and queried
- Whitelist validation rejects unknown commands
- Payload sanitization works correctly

### Estimated Scope
~150-200 lines of code

---

## Phase 5: CLI Command Listener

### Goal
Implement the `machine start` command that listens for and executes commands.

### Tasks

1. **Create machine start command** (`packages/cli/src/commands/machine-start.ts`)
   - Read machine token from local config
   - Authenticate with backend using token
   - Subscribe to pending commands for this machine
   - Display "Listening for commands..." status
   - Handle connection state changes

2. **Implement command execution**
   - Receive command from subscription
   - Acknowledge receipt (update status to "delivered")
   - Execute command based on type:
     - `test`: Print message to console
   - Report result back to backend

3. **Handle reconnection**
   - Automatic retry on connection loss
   - Exponential backoff
   - Show connection status in CLI

4. **Update machine activity**
   - Periodic heartbeat to update lastActiveAt
   - Or update on command receipt

### Success Criteria
- `chatroom machine start` establishes persistent connection
- Commands sent from backend appear in CLI
- Test command executes correctly

### Estimated Scope
~200-250 lines of code

---

## Phase 6: UI Command Sending

### Goal
Enable the webapp to send commands to registered machines.

### Tasks

1. **Create command panel component** (`apps/webapp/src/modules/machines/MachineCommandPanel.tsx`)
   - Display available commands (from whitelist)
   - "Send test command" button
   - Show command history for this machine

2. **Integrate with machine card**
   - Add command panel to MachineCard
   - Show when machine is clicked/selected
   - Display command execution status

3. **Create command history component**
   - Show recent commands sent to this machine
   - Display status (pending/delivered/executed/failed)
   - Show results for executed commands

4. **Add loading and error states**
   - Loading spinner while command is pending
   - Error display if command fails
   - Success confirmation on delivery

### Success Criteria
- "Send test command" button works
- Command appears in CLI running `machine start`
- UI shows command status updates

### Estimated Scope
~150-200 lines of code

---

## Phase 7: Security Hardening

### Goal
Ensure all security requirements are met and add additional protections.

### Tasks

1. **Audit ownership checks**
   - Review all `machine.commands.*` endpoints
   - Ensure ownership verification on every endpoint
   - Add integration tests for unauthorized access

2. **Audit input sanitization**
   - Review all payload handling
   - Ensure all user input is sanitized
   - Add edge case tests (XSS attempts, SQL injection patterns, etc.)

3. **Rate limiting** (if needed)
   - Add rate limiting to command sending
   - Prevent command spam

4. **Token security**
   - Ensure tokens are hashed in database
   - Secure token transmission
   - Token rotation capability (future enhancement)

5. **Add security tests**
   - Test unauthorized access attempts
   - Test payload injection attempts
   - Test malformed command types

### Success Criteria
- No unauthorized access possible
- All input sanitization passes security review
- Security tests pass

### Estimated Scope
~100-150 lines of code (mostly tests)

---

## Total Estimated Scope

| Phase | Lines of Code |
|-------|--------------|
| Phase 1 | ~100-150 |
| Phase 2 | ~150-200 |
| Phase 3 | ~100-150 |
| Phase 4 | ~150-200 |
| Phase 5 | ~200-250 |
| Phase 6 | ~150-200 |
| Phase 7 | ~100-150 |
| **Total** | **~950-1300** |

## Dependency Graph

```
Phase 1 (Schema & Backend)
    │
    ├───> Phase 2 (CLI Registration)
    │
    ├───> Phase 3 (UI Machine List)
    │         │
    │         └───> Phase 6 (UI Commands) <───┐
    │                                          │
    └───> Phase 4 (Command Infrastructure) ───┘
              │
              └───> Phase 5 (CLI Listener)
                        │
                        └───> Phase 7 (Security)
```
