# Local web — error conventions

Socket.IO handlers in the daemon local-web server follow a single ack-based error contract.

## Ack shape

Every client-initiated event uses an acknowledgment callback. Responses are always one of:

```typescript
type SocketAckSuccess<T> = { ok: true; data: T };
type SocketAckFailure = { ok: false; error: AppError };
type SocketAck<T> = SocketAckSuccess<T> | SocketAckFailure;

type AppError = {
  code: 'validation_error' | 'not_found' | 'internal_error' | 'unauthorized';
  message: string;
  details?: unknown;
};
```

## Handler pattern

```typescript
socket.on('harness.history', async (input, ack) => {
  try {
    const parsed = harnessHistoryInputSchema.parse(input);
    const data = listHarnessHistory(repo, parsed);
    ack({ ok: true, data });
  } catch (err) {
    ack({ ok: false, error: normalizeError(err) });
  }
});
```

Rules:

1. **Always call `ack`** — success or failure. Never leave the client hanging.
2. **Validate input with Zod** before use cases. Zod failures map to `validation_error`.
3. **Use cases throw `Error` with `code`** for domain failures (`not_found`, etc.).
4. **Never expose stack traces** in `error.message` sent to the client.
5. **Server-push events** (e.g. `harness.stream`) do not use ack; they are fire-and-forget broadcasts.

## Error codes

| Code               | When                                      |
| ------------------ | ----------------------------------------- |
| `validation_error` | Zod parse failure or invalid client input |
| `not_found`        | Requested resource does not exist         |
| `unauthorized`     | Reserved for future auth                  |
| `internal_error`   | Unexpected failure; log server-side       |

## Client handling

```typescript
const ack = await socket.emitWithAck('health.get');
if (!ack.ok) {
  console.error(ack.error.code, ack.error.message);
  return;
}
useHealth(ack.data);
```

Use `@tanstack/react-query` for request/response events; subscribe to push channels separately.
