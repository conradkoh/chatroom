'use client';

import { useState } from 'react';

import { WorkspaceBottomBarShell } from '@/modules/chatroom/workspace/components/WorkspaceBottomBar';

export function WorkspaceBottomBarSection() {
  const [taps, setTaps] = useState(0);
  return (
    <section className="space-y-2" data-testid="workspace-bottom-bar-section">
      <h2 className="text-xs font-bold uppercase tracking-wider">Workspace bottom bar</h2>
      <p className="text-[10px] text-chatroom-text-muted">
        Real WorkspaceBottomBarShell. Drive the keyboard sliders above, then focus the composer.
      </p>
      <div data-main-chat-composer className="bg-chatroom-bg-surface p-2">
        <textarea
          data-testid="bar-harness-composer"
          aria-label="Bar harness composer"
          rows={2}
          className="w-full bg-chatroom-bg-secondary p-2 text-sm"
        />
      </div>
      <WorkspaceBottomBarShell>
        <button
          type="button"
          data-testid="bar-harness-button"
          onClick={() => setTaps((n) => n + 1)}
          className="px-3 h-full text-[11px] font-bold uppercase text-chatroom-text-primary"
        >
          Tap me
        </button>
        <span
          data-testid="bar-harness-taps"
          className="ml-auto text-[10px] text-chatroom-text-muted"
        >
          {taps}
        </span>
      </WorkspaceBottomBarShell>
    </section>
  );
}
