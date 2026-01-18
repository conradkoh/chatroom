# Architecture: Graceful Error Responses

## Changes Overview

This plan modifies the error handling pattern in Convex backend mutations and their corresponding CLI command handlers. Instead of throwing errors that crash the CLI process, mutations return structured error responses that the CLI can handle gracefully.

## New Contracts

### Standard Error Response Structure

All mutations that can fail gracefully will return a union type:

```typescript
// Base error response structure
interface ErrorInfo {
  code: string;                    // Machine-readable error code
  message: string;                 // Human-readable error message
  suggestedAction?: string;        // Optional guidance for resolution
  context?: Record<string, unknown>; // Additional error context
}

// Generic mutation response wrapper
interface MutationResult<T> {
  success: boolean;
  error: ErrorInfo | null;
  data: T | null;
}
```

### Error Codes by Domain

```typescript
// Task-related error codes
type TaskErrorCode =
  | 'NO_PENDING_TASK'           // No pending task to start
  | 'TASK_NOT_FOUND'            // Task ID doesn't exist
  | 'INVALID_TASK_STATUS'       // Task is in wrong status for operation
  | 'FORCE_COMPLETE_REQUIRED';  // Must use --force for active tasks

// Message-related error codes
type MessageErrorCode =
  | 'HANDOFF_RESTRICTED'        // Already implemented
  | 'CANNOT_CLASSIFY'           // Message cannot be classified
  | 'ALREADY_CLASSIFIED';       // Message already has classification

// Participant-related error codes
type ParticipantErrorCode =
  | 'INVALID_ROLE'              // Role not in team configuration
  | 'PARTICIPANT_NOT_FOUND';    // Participant doesn't exist
```

## Modified Components

### Backend: `services/backend/convex/tasks.ts`

**Affected Mutations:**

| Mutation | Current Behavior | New Behavior |
|----------|-----------------|--------------|
| `startTask` | Throws "No pending task to start" | Returns `{success: false, error: {code: 'NO_PENDING_TASK', ...}}` |
| `completeTaskById` | Throws for invalid status | Returns `{success: false, error: {code: 'INVALID_TASK_STATUS', ...}}` |

**Return Type Changes:**

```typescript
// startTask - before
handler: async (ctx, args) => {
  // ... throws Error
  return { taskId, messageId };
}

// startTask - after
handler: async (ctx, args) => {
  // ... returns error response
  return {
    success: true,
    error: null,
    taskId,
    messageId,
  } | {
    success: false,
    error: { code: 'NO_PENDING_TASK', message: '...' },
    taskId: null,
    messageId: null,
  };
}
```

### Backend: `services/backend/convex/messages.ts`

**Affected Mutations:**

| Mutation | Current Behavior | New Behavior |
|----------|-----------------|--------------|
| `taskStarted` | Throws classification errors | Returns `{success: false, error: {...}}` |

**Error Cases:**

1. `Can only classify user messages` → `{code: 'CANNOT_CLASSIFY', message: '...'}`
2. `Message is already classified` → `{code: 'ALREADY_CLASSIFIED', message: '...'}`

### Backend: `services/backend/convex/participants.ts`

**Affected Mutations:**

| Mutation | Current Behavior | New Behavior |
|----------|-----------------|--------------|
| `join` | Throws "Invalid role" | Returns `{success: false, error: {code: 'INVALID_ROLE', allowedRoles: [...]}}`

### CLI: Command Handlers

Each CLI command handler will be updated to:

1. Receive the typed response from the mutation
2. Check the `success` field
3. Display appropriate error message on failure
4. Exit gracefully with proper exit code

**Pattern for CLI handlers:**

```typescript
const result = await client.mutation(api.tasks.startTask, { ... });

if (!result.success && result.error) {
  console.error(`\n❌ ${result.error.message}`);
  if (result.error.suggestedAction) {
    console.error(`\n💡 ${result.error.suggestedAction}`);
  }
  process.exit(1);
}

// Continue with success path
```

## Data Flow Changes

### Before (Throwing Pattern)

```
CLI Command → Convex Mutation → throw Error → Uncaught Exception → Process Crash
```

### After (Response Pattern)

```
CLI Command → Convex Mutation → Return {success: false, error} → CLI Handles → Clean Exit
```

## Files to Modify

| File | Type | Changes |
|------|------|---------|
| `services/backend/convex/tasks.ts` | Backend | Modify `startTask`, `completeTaskById` return types |
| `services/backend/convex/messages.ts` | Backend | Modify `taskStarted` return type |
| `services/backend/convex/participants.ts` | Backend | Modify `join` return type |
| `packages/cli/src/commands/wait-for-task.ts` | CLI | Handle startTask error response |
| `packages/cli/src/commands/task-started.ts` | CLI | Handle taskStarted error response |
| `packages/cli/src/commands/backlog.ts` | CLI | Handle completeTaskById error response |

## Backward Compatibility

The CLI must handle both:
1. **New response format** - `{success: boolean, error: ErrorInfo | null, ...}`
2. **Old throw format** - For gradual rollout and older backend versions

CLI handlers should:
1. First check for `success` field in response
2. If `success` field doesn't exist, assume it's the old format (implicit success)
3. Wrap mutation calls in try/catch to handle thrown errors from old backend

```typescript
try {
  const result = await client.mutation(api.tasks.startTask, { ... });
  
  // New format check
  if ('success' in result && !result.success && result.error) {
    handleError(result.error);
    return;
  }
  
  // Success (new or old format)
  handleSuccess(result);
} catch (error) {
  // Old format - thrown error
  handleLegacyError(error);
}
```
