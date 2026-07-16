'use client';

import { Settings2 } from 'lucide-react';
import { memo, useState } from 'react';

import type { HarnessOption } from '@/modules/chatroom/direct-harness/hooks/useHarnessConfig';
import type { ProviderOption } from '@/modules/chatroom/direct-harness/components/harness-selectors/types';
import type { UseHarnessModelFilterResult } from '@/modules/chatroom/direct-harness/hooks/useHarnessModelFilter';
import { SearchConfigQuickPick } from '@/modules/chatroom/features/search-config/components/SearchConfigQuickPick';
import { formatSearchConfigLabel } from '@/modules/chatroom/features/search-config/utils/formatSearchConfigLabel';
import type { SearchConfigEntry } from '@/modules/chatroom/features/search-config/types/searchConfig';
import { AgenticQueryConfigModal } from './AgenticQueryConfigModal';

export interface AgenticQueryConfigBarProps {
  harnesses: HarnessOption[];
  harnessName: string;
  selectedModel: string;
  providers: ProviderOption[];
  isModelHidden?: (modelKey: string) => boolean;
  favorites: SearchConfigEntry[];
  currentEntry: SearchConfigEntry | null;
  disabled?: boolean;
  onApplyConfig: (entry: SearchConfigEntry) => void;
  onAddFavorite: (entry: SearchConfigEntry) => void;
  onRemoveFavorite: (entry: SearchConfigEntry) => void;
  onMoveFavorite: (fromIndex: number, toIndex: number) => void;
  isFavorite: (entry: SearchConfigEntry) => boolean;
  onHarnessChange: (name: string) => void;
  onModelChange: (modelKey: string) => void;
  filter: UseHarnessModelFilterResult;
}

export const AgenticQueryConfigBar = memo(function AgenticQueryConfigBar({
  harnesses,
  harnessName,
  selectedModel,
  providers,
  isModelHidden,
  favorites,
  currentEntry,
  disabled = false,
  onApplyConfig,
  onAddFavorite,
  onRemoveFavorite,
  onMoveFavorite,
  isFavorite: checkFavorite,
  onHarnessChange,
  onModelChange,
  filter,
}: AgenticQueryConfigBarProps) {
  const [configModalOpen, setConfigModalOpen] = useState(false);

  const summaryLabel =
    harnessName && selectedModel
      ? formatSearchConfigLabel({ harnessName, modelKey: selectedModel }, harnesses)
      : 'Select config';

  return (
    <div data-testid="agentic-query-config-bar" className="space-y-2">
      <div className="flex items-center gap-2">
        <span
          className="flex-1 text-[11px] text-chatroom-text-primary truncate"
          title={summaryLabel}
        >
          {summaryLabel}
        </span>
        <button
          type="button"
          disabled={disabled}
          onClick={() => setConfigModalOpen(true)}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold uppercase tracking-wider bg-chatroom-bg-tertiary border border-chatroom-border text-chatroom-text-muted hover:text-chatroom-text-primary hover:border-chatroom-border-strong disabled:opacity-50 disabled:cursor-not-allowed"
          title="Configure"
        >
          <Settings2 size={12} />
          Configure
        </button>
      </div>

      <SearchConfigQuickPick
        favorites={favorites}
        harnesses={harnesses}
        currentEntry={currentEntry}
        disabled={disabled}
        onApply={onApplyConfig}
        onAddFavorite={onAddFavorite}
        onRemoveFavorite={onRemoveFavorite}
        onMoveFavorite={onMoveFavorite}
        isFavorite={checkFavorite}
      />

      <AgenticQueryConfigModal
        open={configModalOpen}
        onOpenChange={setConfigModalOpen}
        harnesses={harnesses}
        harnessName={harnessName}
        onHarnessChange={onHarnessChange}
        providers={providers}
        selectedModel={selectedModel}
        onModelChange={onModelChange}
        isModelHidden={isModelHidden}
        filter={filter}
        currentEntry={currentEntry}
        isFavorite={checkFavorite}
        onAddFavorite={onAddFavorite}
        disabled={disabled}
      />
    </div>
  );
});
