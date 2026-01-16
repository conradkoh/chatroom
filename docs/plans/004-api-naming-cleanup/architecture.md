# Architecture Changes

## Changes Overview

Add new methods with clearer names and deprecate the old ones. No functional changes - new methods are aliases that call the same logic.

## New Components

None - only renaming existing components.

## Modified Components

### Backend: `services/backend/convex/messages.ts`

Add new exported mutations that wrap existing functionality:

```typescript
// New: clearer name for sending messages
export const sendMessage = mutation({
  // ... same args as send
  handler: async (ctx, args) => {
    // Calls same logic as send
  },
});

// New: clearer name for completing and handing off
export const handoff = mutation({
  // ... same args as sendHandoff
  handler: async (ctx, args) => {
    // Calls same logic as sendHandoff
  },
});

// Existing methods become deprecated aliases
/** @deprecated Use sendMessage instead */
export const send = mutation({ ... });

/** @deprecated Use handoff instead */
export const sendHandoff = mutation({ ... });
```

### CLI: `packages/cli/src/index.ts`

Add new commands as aliases:

```typescript
// New command: chatroom send-message
program
  .command('send-message <chatroomId>')
  .description('Send a message to a chatroom (without completing task)')
  // ... same options as send
  
// Old command: chatroom send (deprecated)
program
  .command('send <chatroomId>')
  .description('[DEPRECATED: Use "send-message" instead] Send a message to a chatroom')
  // ... same implementation

// New command: chatroom handoff
program
  .command('handoff <chatroomId>')
  .description('Complete your task and hand off to the next role')
  // ... same options as task-complete

// Old command: chatroom task-complete (deprecated)
program
  .command('task-complete <chatroomId>')
  .description('[DEPRECATED: Use "handoff" instead] Complete a task and hand off')
  // ... same implementation
```

### CLI: `packages/cli/src/convex-api/index.ts`

Add new API references:

```typescript
// After sync, the api object will include:
// api.messages.postMessage
// api.messages.completeAndHandoff
```

## New Contracts

None - no new interfaces or types.

## Modified Contracts

### API References

Add to CLI API exports:

```typescript
// In generated api.d.ts (from backend)
export const api: {
  messages: {
    // New methods
    sendMessage: FunctionReference<'mutation', 'public'>;
    handoff: FunctionReference<'mutation', 'public'>;
    
    // Deprecated (kept for backward compatibility)
    send: FunctionReference<'mutation', 'public'>;
    sendHandoff: FunctionReference<'mutation', 'public'>;
    // ... other methods
  };
  // ... other modules
};
```

## Data Flow Changes

None - data flow remains identical.

## Integration Changes

None - no external integrations affected.
