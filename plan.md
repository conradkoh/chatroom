# Plan: Replace throw-based auth with value object pattern

## Problem

`getAuthenticatedUser` throws errors on auth failure, and `getAuthenticatedUserOptional`
wraps it in a try/catch to return null. This creates two issues:

1. **UI suffers**: Convex mutations that throw errors surface as error toasts or
   unhandled exceptions on the frontend, making it hard to show proper error screens
   or redirect logic.
2. **Two redundant functions**: `getAuthenticatedUserOptional` is just a try/catch
   wrapper around `getAuthenticatedUser`, adding unnecessary indirection.

## Solution

Replace both functions with a single `getAuthenticatedUser` that returns a value object:

```typescript
type AuthResult =
  | { isAuthenticated: true; user: Doc<'users'> }
  | { isAuthenticated: false; user: null };
```

Each caller then uses discriminated union narrowing:

```typescript
const auth = await getAuthenticatedUser(ctx, args.sessionId);
if (!auth.isAuthenticated) {
  // Queries: return empty data
  // Mutations: return { success: false, error: 'Authentication required' }
  return ...;
}
const user = auth.user; // TypeScript narrows to Doc<'users'>
```

## Scope

### File: `services/backend/convex/machines.ts`

This is the only file that defines and uses these functions.

### Callers (11 total)

**Queries (4) — currently use `getAuthenticatedUserOptional`:**
| Function | Current failure behavior | New failure behavior |
|----------|------------------------|---------------------|
| `listMachines` | Returns `{ machines: [] }` | Same — return `{ machines: [] }` |
| `getAgentConfigs` | Returns `{ configs: [] }` | Same — return `{ configs: [] }` |
| `getPendingCommands` | Returns `{ commands: [] }` | Same — return `{ commands: [] }` |
| `getAgentPreferences` | Returns `null` | Same — return `null` |

**Mutations (7) — currently use `getAuthenticatedUser` (throw):**
| Function | Current failure behavior | New failure behavior |
|----------|------------------------|---------------------|
| `register` | Throws | Return error value (TBD by caller contract) |
| `updateAgentConfig` | Throws | Return error value |
| `updateDaemonStatus` | Throws | Return error value |
| `sendCommand` | Throws | Return error value |
| `updateSpawnedAgent` | Throws | Return error value |
| `ackCommand` | Throws | Return error value |
| `updateAgentPreferences` | Throws | Return error value |

### Mutation error handling strategy

For mutations, throwing is still acceptable since:
- Mutations are called from the CLI daemon (not the UI) in most cases
- The daemon expects errors to surface for retry logic
- However, per the user's request, we should avoid throws

We'll have mutations throw `ConvexError` with structured data instead of raw
`Error`, so the frontend can distinguish auth failures from other errors. But
since the user prefers no throws, we can also return structured error objects
where the return type allows it.

**Approach**: For this iteration, we'll focus on the value object pattern for
`getAuthenticatedUser`. Mutations that currently throw will continue to throw
(since their callers are CLI-side), but we'll convert to `ConvexError` with
a code field for better error handling on the frontend.

Actually, re-reading the user's request: "let's not throw an error but rather
have a single function getAuthenticatedUser which returns the result in a value
object" — this applies to the helper function itself. The callers can still
decide what to do with the result. Mutations can throw their own errors based
on the result if needed.

## Implementation Steps

1. Define `AuthResult` type
2. Rewrite `getAuthenticatedUser` to return `AuthResult` instead of throwing
3. Remove `getAuthenticatedUserOptional` (no longer needed)
4. Update all 4 query callers: use `if (!auth.isAuthenticated)` guard
5. Update all 7 mutation callers: use `if (!auth.isAuthenticated)` guard + throw
6. Typecheck + test
7. Commit and handoff

## Risk

- **Low**: The external behavior doesn't change. Queries still return empty data,
  mutations still throw. Only the internal plumbing changes.
- **No frontend changes needed**: The return types of all exported functions remain the same.
