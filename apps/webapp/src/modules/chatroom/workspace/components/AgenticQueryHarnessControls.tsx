'use client';

import type { ReactNode } from 'react';

import { HarnessHarnessSelect } from '@/modules/chatroom/direct-harness/components/harness-selectors/HarnessHarnessSelect';
import { HarnessModelSelect } from '@/modules/chatroom/direct-harness/components/harness-selectors/HarnessModelSelect';
import type { ProviderOption } from '@/modules/chatroom/direct-harness/components/harness-selectors/types';
import type { HarnessOption } from '@/modules/chatroom/direct-harness/hooks/useHarnessConfig';

export interface AgenticQueryHarnessControlsProps {
  harnesses: HarnessOption[];
  harnessName: string;
  onHarnessChange: (name: string) => void;
  providers: ProviderOption[];
  selectedModel: string;
  onModelChange: (modelKey: string) => void;
  isModelHidden?: (modelKey: string) => boolean;
  disabled?: boolean;
  filterButton?: ReactNode;
  refreshButton?: ReactNode;
}

export function AgenticQueryHarnessControls({
  harnesses,
  harnessName,
  onHarnessChange,
  providers,
  selectedModel,
  onModelChange,
  isModelHidden,
  disabled = false,
  filterButton,
  refreshButton,
}: AgenticQueryHarnessControlsProps) {
  return (
    <div
      className="flex flex-col gap-2 min-w-0"
      data-testid="agentic-query-harness-controls"
      aria-disabled={disabled}
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-40 shrink-0">
          <HarnessHarnessSelect
            harnesses={harnesses}
            value={harnessName}
            onValueChange={onHarnessChange}
            disabled={disabled}
          />
        </div>
        <div className="flex-1 min-w-0">
          <HarnessModelSelect
            providers={providers}
            value={selectedModel}
            onValueChange={onModelChange}
            isHidden={isModelHidden}
            disabled={disabled}
          />
        </div>
      </div>
      {refreshButton || filterButton ? (
        <div className="flex items-center justify-end gap-2 shrink-0">
          {refreshButton}
          {filterButton}
        </div>
      ) : null}
    </div>
  );
}
