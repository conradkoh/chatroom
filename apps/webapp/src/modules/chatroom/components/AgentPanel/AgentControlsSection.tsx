'use client';

import { memo, useState } from 'react';

import type { MachineInfo } from '../../types/machine';
import type { useAgentControls } from '../AgentConfigTabs';
import { RemoteTabContent, CustomTabContent } from '../AgentConfigTabs';

// ─── AgentControlsSection ────────────────────────────────────────────────────

export interface AgentControlsSectionProps {
  /** Return value of useAgentControls — passed in so the parent manages the hook. */
  controls: ReturnType<typeof useAgentControls>;
  connectedMachines: MachineInfo[];
  isLoadingMachines: boolean;
  daemonStartCommand: string;
  role: string;
  prompt: string;
  /** Which tab to show initially. Defaults to 'remote'. */
  initialTab?: 'remote' | 'custom';
}

/**
 * Reusable tab bar (Remote / Custom) + tab content section.
 * Extracted from InlineAgentCard so it can be reused in other panels.
 */
export const AgentControlsSection = memo(function AgentControlsSection({
  controls,
  connectedMachines,
  isLoadingMachines,
  daemonStartCommand,
  role,
  prompt,
  initialTab = 'remote',
}: AgentControlsSectionProps) {
  const [activeTab, setActiveTab] = useState<'remote' | 'custom'>(initialTab);

  return (
    <>
      {/* Tab bar — closer to content below */}
      <div className="flex gap-3 mb-1">
        <button
          onClick={() => setActiveTab('remote')}
          className={`text-[11px] font-bold uppercase tracking-wide border-b-2 pb-0.5 transition-colors ${
            activeTab === 'remote'
              ? 'border-chatroom-accent text-chatroom-text-primary'
              : 'border-transparent text-chatroom-text-muted hover:text-chatroom-text-secondary'
          }`}
        >
          Remote
        </button>
        <button
          onClick={() => setActiveTab('custom')}
          className={`text-[11px] font-bold uppercase tracking-wide border-b-2 pb-0.5 transition-colors ${
            activeTab === 'custom'
              ? 'border-chatroom-accent text-chatroom-text-primary'
              : 'border-transparent text-chatroom-text-muted hover:text-chatroom-text-secondary'
          }`}
        >
          Custom
        </button>
      </div>

      {/* Tab content — sits directly after tab bar */}
      <div className="pt-2">
        {activeTab === 'remote' ? (
          <RemoteTabContent
            controls={controls}
            connectedMachines={connectedMachines}
            isLoadingMachines={isLoadingMachines}
            daemonStartCommand={daemonStartCommand}
          />
        ) : (
          <CustomTabContent role={role} prompt={prompt} />
        )}
      </div>
    </>
  );
});
