---
type: decision-log
title: Handoff sender agent snapshot
description: Point-in-time harness and model stored on handoff messages, normalized defensively in the webapp and printed by the CLI download.
tags: [handoff, sender-agent, harness, model, webapp, cli]
status: active
---

# Handoff sender agent snapshot

## Context

Readers of a handoff could not tell which harness or model produced it, and the
sending agent's configuration can change after the message is written. Showing
the current configuration would misattribute old handoffs, so the value is
captured when the handoff is emitted and never refreshed.

## Decisions

1. **Stored once, point-in-time.** `chatroom_messages.senderAgent` holds
   `{ harness: string; model?: string }` written by the backend at handoff time.
   Later edits to an agent's harness or model do not change existing rows.
2. **Display-only.** The snapshot is informational. Nothing routes, filters,
   sorts, or resumes based on it.
3. **Handoff-only.** `getSenderAgentLabel(type, value)` returns `undefined` for
   every non-`handoff` type, so the chip cannot appear on notices, messages, or
   user rows even if a stray snapshot is present.
4. **Defensive normalization in the webapp.** Never trust the backend value:
   non-object or null snapshots are absent; the harness must be a non-empty
   string after trimming; whitespace runs collapse to one space; empty segments
   are dropped and segments longer than 64 characters are clipped with `…`. A
   non-string model drops only the model.
5. **No placeholder for legacy rows.** A handoff without a usable snapshot
   renders no chip, no "unknown", and no dash. The header and route markup stay
   identical so legacy and new rows measure the same.
6. **One label, one chip.** The row header and the details dialog both render
   `TimelineSenderAgentChip`, which calls `getSenderAgentLabel`; the dialog also
   derives its screen-reader sentence from the same helper so the visible chip
   and the accessible description cannot disagree.
7. **CLI parity.** `chatroom messages download` includes the same snapshot in
   its handoff output, so scripts and the webapp read one backend field. The
   command downloads the latest page by default; `--page-id`, `--before` and
   `--after` select other pages.

## Known limits and fallbacks

- **Model source.** `slot.model` is the model the agent was configured or launched with.
  A harness that switches models mid-session is not reflected: the snapshot records the
  configured model, not a live switch.
- **Ambiguous slot lookup.** The daemon resolves the snapshot with
  `getSlot(chatroomId, role)` and no working directory. When the role has slots in more
  than one working directory the lookup is ambiguous, returns nothing, and the handoff is
  stored with no snapshot (no chip). Legacy and unambiguous cases are unaffected.
- **Backend skew.** If the backend rejects the call because `senderAgent` is an unknown
  argument (a backend older than the CLI), the daemon retries the handoff once without the
  snapshot and logs `sender-agent fallback`. A snapshot never causes a handoff to fail.
- **Model normalization.** The model is trimmed, then rejected if it contains any Unicode
  control character, U+2028, U+2029, or `|` (the linear header delimiter). Internal
  whitespace runs collapse to one space. Over 200 characters after collapsing is dropped.
  A rejected model drops only the model.
- **Linear profile only.** The `| harness=… model=…` suffix is printed only by the `linear`
  download profile. `context-xml` and `task-origin` omit the snapshot by design.
