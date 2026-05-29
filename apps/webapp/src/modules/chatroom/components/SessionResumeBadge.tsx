'use client';

/** Subtle indicator that a harness supports session resume between turns. */
export function SessionResumeBadge() {
  return (
    <span
      className="ml-1.5 flex-shrink-0 rounded-sm border border-chatroom-border px-1 py-0 text-[8px] font-medium normal-case tracking-normal text-chatroom-text-muted"
      title="This harness can resume the agent session after each turn"
    >
      ↺ Session resume
    </span>
  );
}
