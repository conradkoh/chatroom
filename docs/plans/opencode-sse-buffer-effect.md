# Plan: Reliable SSE Streaming for OpencodeSdkSession (v2 — ground-up rebuild)

**Goal**: Replace the broken SSE pipeline in `OpencodeSdkSession` with a clean, ground-up rebuild around (1) a per-session SSE buffer + async generator, (2) Effect for the harness-level subscribe/retry loop, and (3) idle-driven message finalization. Old per-session SSE loop and HTTP fallback are deleted at the end.

**Build order**: bottom-up (primitives → harness wiring → session → finalize → cleanup of old code), each phase shippable and tested.

**Test policy** (from user):
- **Unit tests** run in the default suite — every new module gets one.
- **Integration tests** are on-demand only (`*.integration.test.ts` is already excluded by `vitest.config.ts`). Live integration uses model `opencode-go/deepseek-v4-flash` and is run with:
  ```
  cd packages/cli && pnpm test -- opencode-harness.integration
  ```

---

## Diagnosis recap

Two SSE subscribers race on the same `OpencodeClient`:
1. `OpencodeSdkHarness.runEventLoop()` — shared fan-out (correct, keep & refactor).
2. `OpencodeSdkSession.startEventStream()` — per-session redundant subscribe (logs "received no events"). **Delete.**

Plus the "HTTP fallback" path is still wired alongside `promptAsync`. **Delete.**

---

## Target architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  OpencodeSdkHarness                                              │
│   ONE event.subscribe via Effect (retry: Schedule.exponential).  │
│   Events routed by sessionID → session._pushEvent(raw)           │
└──────────────────────────────────────────────────────────────────┘
                            │ push
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  SseEventBuffer<T>  (per opencode session)                       │
│   • bounded queue with single-consumer async iterator            │
│   • push(event), close(), [Symbol.asyncIterator]()               │
│   • drop-oldest + warn on overflow                               │
└──────────────────────────────────────────────────────────────────┘
                            │ for await
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  OpencodeSdkSession                                              │
│   prompt(input):                                                 │
│     1. promptAsync() → 204                                       │
│     2. consume buffer; dispatch each event to onEvent listeners  │
│     3. resolve when session.idle (or timeout) seen               │
│   No own SSE subscription. No HTTP fallback.                     │
└──────────────────────────────────────────────────────────────────┘
                            │ session.idle
                            ▼
┌──────────────────────────────────────────────────────────────────┐
│  Daemon idle-handler (existing) → finalizeAssistantTurn          │
│   Backend aggregates chunks by messageId → text/reasoning        │
│   Cron purges chunk rows after 1h (existing)                     │
└──────────────────────────────────────────────────────────────────┘
```

Invariant: **exactly one** `client.event.subscribe()` per harness.

---

## Phases

### Phase 1 — `SseEventBuffer<T>` primitive
**Files**:
- `packages/cli/src/infrastructure/harnesses/opencode-sdk/sse-event-buffer.ts` (new)
- `packages/cli/src/infrastructure/harnesses/opencode-sdk/sse-event-buffer.test.ts` (new)

**Contract**:
```ts
export interface SseEventBufferOptions {
  /** Max events buffered before drop-oldest kicks in. Default: 1024. */
  readonly capacity?: number;
  /** Logger for overflow warnings. */
  readonly onOverflow?: (dropped: number) => void;
}

export class SseEventBuffer<T> implements AsyncIterable<T> {
  constructor(options?: SseEventBufferOptions);
  push(event: T): void;
  close(): void;
  readonly closed: boolean;
  readonly size: number;
  [Symbol.asyncIterator](): AsyncIterator<T>;
}
```

**Unit tests** (essential):
- push-then-iterate emits all events in order
- iterate-then-push wakes the awaiting consumer
- `close()` resolves the iterator (`{ done: true }`)
- close mid-iteration drains remaining events first
- overflow drops oldest, calls `onOverflow`, never blocks `push`
- single-consumer guarantee: second `[Symbol.asyncIterator]()` call throws

**Acceptance**: unit tests pass, no callers wired yet.

---

### Phase 2 — Reproduction integration test (on-demand)
**File**: extend `packages/cli/src/infrastructure/harnesses/opencode-sdk/opencode-harness.integration.test.ts`

**Add tests** (using `opencode-go/deepseek-v4-flash`):
1. `"streams text deltas via SSE only (no HTTP body fallback)"` — assert `chunks.length > 0`, no events arrive *after* `session.idle`.
2. `"opens exactly one event.subscribe per harness"` — spy on `client.event.subscribe`, assert called exactly once across the lifetime of the harness even with multiple sessions.
3. `"finalizeAssistantTurn-equivalent: aggregated text matches concatenated chunks"` — collect chunks during streaming, assert their concatenation equals what would be persisted.

**Acceptance**: tests #1 and #2 **fail** on current code (proving the bug); test #3 passes since aggregation already works. Run with `pnpm test -- opencode-harness.integration`.

---

### Phase 3 — Wire `SseEventBuffer` into `OpencodeSdkSession` (no behavior change yet)
**Files**: `opencode-session.ts`, `opencode-session.test.ts`, `opencode-harness.ts`.

Changes:
- Add private `_buffer: SseEventBuffer<SdkEvent>` to `OpencodeSdkSession`.
- Rename `_receiveEvent(raw)` → keep the public method, but its body becomes `this._buffer.push(raw)`.
- Add a private `consume()` task started lazily on first `onEvent()` registration:
  ```ts
  for await (const raw of this._buffer) {
    const evt = toSessionEvent(raw);
    for (const l of this.onEventListeners) l(evt);
    if (raw.type === 'session.idle') this._idleResolve?.();
  }
  ```
- `close()` calls `this._buffer.close()`.
- **Do not yet remove** `startEventStream()` / HTTP fallback — that happens in Phase 5. This phase keeps both paths alive so the daemon stays functional.

**Unit tests** (extend existing `opencode-session.test.ts`):
- pushed events flow to `onEvent` listeners in order
- `session.idle` resolves the in-flight `prompt()`
- `close()` cancels in-flight prompt cleanly

**Acceptance**: full unit suite green; integration test from Phase 2 still in same failing state (no regression).

---

### Phase 4 — Refactor `OpencodeSdkHarness.runEventLoop` to Effect
**Files**: `opencode-harness.ts`, `opencode-harness.test.ts`.

Replace the hand-rolled `while (!closed)` + manual exponential backoff with:
```ts
const subscribeOnce = Effect.tryPromise({
  try: () => this.client.event.subscribe({ query: { directory: this.cwd } }),
  catch: (e) => new SseSubscribeError(e),
});

const consumeStream = (result) => Effect.async<void, SseStreamError>((resume) => {
  // pump result.stream → route by sessionID → session._pushEvent(raw)
  // resume on stream end / error / interrupt
});

const program = subscribeOnce.pipe(
  Effect.flatMap(consumeStream),
  Effect.retry(
    Schedule.exponential(Duration.millis(500))
      .pipe(Schedule.either(Schedule.spaced(Duration.seconds(30))))
  ),
);

this._fiber = Effect.runFork(program);
```

`close()`: `Fiber.interrupt(this._fiber)` (await it).

Also: route every received event via `session._pushEvent(raw)` (which Phase 3 added), feeding the per-session `SseEventBuffer`.

**Unit tests** (extend `opencode-harness.test.ts`):
- single subscribe call when one session opens (mock client)
- still single subscribe call when 3 sessions open simultaneously
- on simulated stream end → resubscribes after backoff
- `close()` interrupts the fiber within < 100ms

**Acceptance**: unit suite green; integration test "opens exactly one event.subscribe per harness" now **passes**.

---

### Phase 5 — Delete old paths
**Remove from `OpencodeSdkSession`**:
- `startEventStream()` and all per-session SSE state (`sseRunning`, `sseStopped`, `_sseEventCount`, `_sseDeliveredForCurrentPrompt`, `_sseDelay`, the per-session retry loop).
- The HTTP-fallback emission code in `prompt()` (anything that reads from the sync `prompt()` HTTP body — `promptAsync()` is the only path).
- Stale logs (`"HTTP fallback"`, `"SSE stream connected/ended for session"` from the session — keep harness-level ones).

**Remove from `OpencodeSdkHarness`**:
- The hand-rolled retry loop and `_sleepWithEarlyExit` (replaced by Effect Schedule in Phase 4).

**Update tests**: delete tests pinned to deleted behavior; ensure no orphaned mocks.

**Acceptance**: `pnpm typecheck && pnpm test` green. Integration test "streams text deltas via SSE only" now **passes**.

---

### Phase 6 — Idle → finalize verification + observability
Verify the existing daemon path still fires correctly:
- `prompt-subscriber.ts` and `idle-handler.ts` should see `session.idle` via the new buffer-driven dispatch and call `sessionRepository.finalizeAssistantTurn(turnId)`.
- Backend `finalizeAssistantTurn` aggregates chunks by `messageId` (already implemented).
- `purgeFinalizedChunks` cron continues to clean up after 1h grace (already implemented — leave as-is for incident debuggability).

**Add unit test** in `prompt-subscriber.test.ts` (or wherever idle-handler is tested):
- given a buffered `session.idle` event, `finalizeAssistantTurn` is called exactly once with the current turn's ID.

**Add a focused integration test** (on-demand):
- "end-to-end: prompt → chunks streamed → session.idle → backend turn marked complete with concatenated content".

**Acceptance**: integration tests #1, #2, #3 from Phase 2 + new e2e all pass against live opencode.

---

### Phase 7 — Code review + final verification
- Activate `code-review` skill, review across the eight pillars.
- Run `pnpm typecheck && pnpm test` from repo root.
- Run integration suite: `cd packages/cli && pnpm test -- opencode-harness.integration` and capture output.
- Confirm no `"HTTP fallback"` or `"SSE stream ended … received no events"` lines remain in any code path.

---

## Out of scope
- Multi-consumer fan-out from `SseEventBuffer` (single consumer per session is enough).
- Resumable SSE / event cursors (opencode doesn't expose them).
- Effect refactor of the daemon prompt-subscriber (separate future work).
- Shortening the 1h chunk purge grace.

---

## Decision defaults (locked in unless told otherwise)
- **Effect scope**: harness SSE loop only. Session uses plain async iteration over the buffer — keeps Effect surface small and the session easy to reason about.
- **Chunk purge timing**: keep existing 1-hour grace (good for debugging, negligible storage cost).
- **Integration tests**: on-demand only via `*.integration.test.ts` exclusion; model `opencode-go/deepseek-v4-flash`. Single-subscribe assertion ALSO covered by a unit test in `opencode-harness.test.ts` (mocked client) so CI catches regressions.
