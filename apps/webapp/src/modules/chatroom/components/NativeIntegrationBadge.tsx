'use client';

/** Subtle indicator that a harness receives tasks via daemon injection (no get-next-task loop). */
export function NativeIntegrationBadge() {
  return (
    <span
      className="ml-1.5 flex-shrink-0 rounded-sm border border-chatroom-border px-1 py-0 text-[8px] font-medium normal-case tracking-normal text-chatroom-text-muted"
      title="This harness receives tasks via direct session injection"
    >
      ⚡ Native
    </span>
  );
}
