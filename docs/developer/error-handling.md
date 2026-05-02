# Backend Error Handling Convention

This document defines the error-handling convention for the Chatroom backend (Convex functions in `services/backend/`).

## Two Patterns: Throw vs Return

### Pattern 1: Throw (default)

Use **`throw new ConvexError({ code, message, fields? })`** for exceptional conditions that callers should not normally branch on.

```typescript
// ✅ Correct: structured throw
throw new ConvexError({
  code: BACKEND_ERROR_CODES.BACKLOG_ITEM_NOT_FOUND,
  message: 'Backlog item not found',
});

// ❌ Forbidden: bare-string throw
throw new ConvexError('Backlog item not found');
```

### Pattern 2: Return discriminated union (only for normal business outcomes)

Use a **return type with typed variants** when the failure is a normal expected outcome that callers MUST branch on. Do NOT throw for these cases.

```typescript
// ✅ Correct: return union for expected outcomes
type GetNextTaskResponse =
  | { type: 'tasks'; tasks: [...] }
  | { type: 'no_tasks' }
  | { type: 'error'; code: BackendErrorCode; message: string; fatal: boolean };

// ❌ Wrong: throwing for an expected outcome
throw new ConvexError({ code: 'NO_TASKS', message: 'No tasks available' });
```

**Decision rule**: Will most callers branch on this outcome rather than treat it as an error? → Union. Otherwise → Throw.

## The Structured ConvexError Shape

All throws must use the `BackendError` type defined in `services/backend/config/errorCodes.ts`:

```typescript
type BackendError = {
  code: BackendErrorCode;  // From BACKEND_ERROR_CODES
  message: string;          // Human-readable message
  fields?: string[];        // Optional: field names involved (for BAD_REQUEST-style errors)
};
```

### Adding a new error code

1. Add the string literal to the `BackendErrorCode` union type in `errorCodes.ts`
2. Add the corresponding entry to `BACKEND_ERROR_CODES` with a docstring
3. Add it to either `FATAL_ERROR_CODES` or `NON_FATAL_ERROR_CODES` (the test suite verifies every code is classified)
4. When in doubt, choose **non-fatal** — it's easier to promote to fatal later than to demote

### Using `fields`

The `fields` array is for validation errors that identify specific offending fields:

```typescript
throw new ConvexError({
  code: BACKEND_ERROR_CODES.VALIDATION_ERROR,
  message: 'Missing required fields',
  fields: ['content', 'priority'],
});
```

The CLI renders fields as `offending fields: content, priority` in the error message.

## What the CLI sees

When a Convex function throws a `ConvexError`:
- The error arrives at the CLI with `error.data` containing the structured `{ code, message, fields? }` object
- The CLI's `getErrorMessage()` function extracts `data.message` (or `data.code` as fallback)
- If `fields` is present, it's appended as `offending fields: <fields joined>`

When a non-ConvexError occurs in prod (e.g. arg-validator rejection), Convex sanitizes the response to an opaque `"Server Error"`. The CLI detects this and appends a diagnostic hint:

```
[Request ID: abc123] Server Error
  hint: This is a generic server error — likely a backend arg-validator rejection or a CLI/backend
  version mismatch. Verify the CLI and backend are on the same commit (run `pnpm install` and check
  `git log -1 origin/master`).
```

This is why **bare-string throws and unregistered codes are forbidden** — they make debugging prod issues extremely difficult.

## Enforcement

A unit test at `services/backend/tests/unit/error-codes-registry.spec.ts`:

1. **Fails on any NEW bare-string throw** not in the baseline allow-list
2. **Fails on any unregistered code** used in a structured throw
3. **Verifies all codes** are classified as fatal or non-fatal

The baseline is shrinking-only. Once all bare-string throws are migrated, the baseline is removed entirely.

## Anti-patterns

- ❌ `throw new ConvexError('some message')` — bare-string throws are forbidden (enforced by test)
- ❌ `throw new ConvexError({ code: 'MY_CUSTOM_CODE', message: '...' })` with an unregistered code — enforced by test
- ❌ Ad-hoc error shapes that don't match `BackendError` — the type system catches these