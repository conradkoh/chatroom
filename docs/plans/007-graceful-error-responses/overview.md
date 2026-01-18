# Plan 007: Graceful Error Responses

## Summary

Refactor high-priority backend errors to return structured error responses instead of throwing exceptions. This improves the CLI agent experience by providing actionable error messages with context, rather than uncaught exceptions that crash the process.

## Goals

1. **Improve CLI agent UX** - Errors should be clear, actionable, and include guidance on how to proceed
2. **Eliminate uncaught exceptions** - Backend should return error responses that CLI can handle gracefully
3. **Consistent error response format** - All refactored errors should follow the same response structure
4. **Preserve security** - Authentication and authorization errors should continue to throw (fail-fast)

## Non-Goals

- Refactoring all 77 throw statements (only high-priority agent-facing ones)
- Changing authentication/authorization error handling
- Modifying OAuth flow error handling
- Changing error handling for internal consistency checks

## Scope

### In Scope (High Priority - Agent-Facing Errors)

| File | Line | Error | Priority |
|------|------|-------|----------|
| tasks.ts | 307 | Cannot force complete task | High |
| tasks.ts | 108 | No pending task to start | High |
| messages.ts | 490 | Can only classify user messages | High |
| messages.ts | 495 | Message is already classified | High |
| participants.ts | 36 | Invalid role | High |

### Out of Scope

- Authentication errors (should fail fast for security)
- OAuth flow errors (internal, should throw)
- Resource not found errors (medium priority, future plan)
- Internal consistency errors (should throw)

## Success Criteria

1. All high-priority errors return structured `{success: false, error: {...}}` responses
2. CLI commands handle error responses and display helpful messages
3. No uncaught exceptions for the refactored error cases
4. Type safety maintained across backend and CLI
