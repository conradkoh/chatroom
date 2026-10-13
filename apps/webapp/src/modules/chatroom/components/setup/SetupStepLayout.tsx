'use client';

import type { ReactNode, Ref } from 'react';

/** Secondary action (Back, Cancel). Full width on mobile, fixed width from sm up. */
export const setupSecondaryButtonClassName =
  'inline-flex h-10 w-full items-center justify-center gap-2 px-4 border border-chatroom-border text-xs font-bold uppercase tracking-wider text-chatroom-text-primary hover:bg-chatroom-bg-hover disabled:opacity-50 sm:h-9 sm:w-auto sm:min-w-28';

/** Primary action (Continue, Create, Start). Full width on mobile, fixed width from sm up. */
export const setupPrimaryButtonClassName =
  'inline-flex h-10 w-full items-center justify-center gap-2 px-4 bg-chatroom-status-success text-chatroom-bg-primary text-xs font-bold uppercase tracking-wider hover:opacity-90 disabled:opacity-50 sm:h-9 sm:w-auto sm:min-w-28';

interface SetupStepLayoutProps {
  children: ReactNode;
  /** Pinned to the bottom of the step. Usually a `SetupStepFooter`. */
  footer?: ReactNode;
  /** Attached to the scrolling body, so focus logic can find the step's content. */
  bodyRef?: Ref<HTMLDivElement>;
}

/**
 * The shell every setup step shares: a body that scrolls, and a footer pinned below it. The footer
 * never moves with the content, so the actions sit in the same place on every step.
 */
export function SetupStepLayout({ children, footer, bodyRef }: SetupStepLayoutProps) {
  return (
    <div data-slot="setup-step" className="flex min-h-0 flex-1 flex-col">
      <div
        ref={bodyRef}
        data-slot="setup-step-body"
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5"
      >
        {children}
      </div>
      {footer}
    </div>
  );
}

interface SetupStepFooterProps {
  /** Left side. Back or Cancel. */
  secondary?: ReactNode;
  /** Right side. The step's main action. */
  primary?: ReactNode;
}

/** Secondary on the left, primary on the right. On mobile the two share the width. */
export function SetupStepFooter({ secondary, primary }: SetupStepFooterProps) {
  return (
    <div
      data-slot="setup-step-footer"
      className="flex shrink-0 items-center gap-3 border-t-2 border-chatroom-border bg-chatroom-bg-surface px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-3"
    >
      {secondary && <div className="flex flex-1 sm:flex-none">{secondary}</div>}
      <div className="flex flex-1 justify-end sm:ml-auto sm:flex-none">{primary}</div>
    </div>
  );
}
