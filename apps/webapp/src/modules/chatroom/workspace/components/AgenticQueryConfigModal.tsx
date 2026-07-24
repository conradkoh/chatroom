'use client';

import { Star, Plus } from 'lucide-react';

import { AgenticQueryHarnessControls } from './AgenticQueryHarnessControls';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/modules/chatroom/components/ui/dialog';
import { ModelFilterButton } from '@/modules/chatroom/components/model-selection';
import type { ProviderOption } from '@/modules/chatroom/direct-harness/components/harness-selectors/types';
import { WorkspaceCapabilitiesRefreshButton } from '@/modules/chatroom/direct-harness/components/WorkspaceCapabilitiesRefreshButton';
import type { HarnessOption } from '@/modules/chatroom/direct-harness/hooks/useHarnessConfig';
import type { UseMachineModelFilterResult } from '@/modules/chatroom/components/model-selection';
import { SearchConfigFavoritesList } from '@/modules/chatroom/features/search-config/components/SearchConfigFavoritesList';
import type { SearchConfigEntry } from '@/modules/chatroom/features/search-config/types/searchConfig';

export interface AgenticQueryConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  harnesses: HarnessOption[];
  harnessName: string;
  onHarnessChange: (name: string) => void;
  providers: ProviderOption[];
  selectedModel: string;
  onModelChange: (modelKey: string) => void;
  isModelHidden?: (modelKey: string) => boolean;
  filter: UseMachineModelFilterResult;
  currentEntry: SearchConfigEntry | null;
  isFavorite: (entry: SearchConfigEntry) => boolean;
  onAddFavorite: (entry: SearchConfigEntry) => void;
  onApplyConfig: (entry: SearchConfigEntry) => void;
  onRemoveFavorite: (entry: SearchConfigEntry) => void;
  onMoveFavorite: (fromIndex: number, toIndex: number) => void;
  favorites: SearchConfigEntry[];
  disabled?: boolean;
}

export function AgenticQueryConfigModal({
  open,
  onOpenChange,
  workspaceId,
  harnesses,
  harnessName,
  onHarnessChange,
  providers,
  selectedModel,
  onModelChange,
  isModelHidden,
  filter,
  currentEntry,
  isFavorite: checkFavorite,
  onAddFavorite,
  onApplyConfig,
  onRemoveFavorite,
  onMoveFavorite,
  favorites,
  disabled = false,
}: AgenticQueryConfigModalProps) {
  const currentIsFavorite = currentEntry != null && checkFavorite(currentEntry);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogContent
        data-testid="agentic-query-config-modal"
        className="sm:max-w-2xl overflow-hidden"
      >
        <DialogHeader>
          <DialogTitle>Search configuration</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <AgenticQueryHarnessControls
            harnesses={harnesses}
            harnessName={harnessName}
            onHarnessChange={onHarnessChange}
            providers={providers}
            selectedModel={selectedModel}
            onModelChange={onModelChange}
            isModelHidden={isModelHidden}
            disabled={disabled}
            refreshButton={
              <WorkspaceCapabilitiesRefreshButton
                workspaceId={workspaceId}
                disabled={disabled}
                hasProviders={providers.some((provider) => provider.models.length > 0)}
              />
            }
            filterButton={
              <ModelFilterButton filter={filter} providers={providers} variant="harness" />
            }
          />
          {currentEntry && !currentIsFavorite && (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onAddFavorite(currentEntry)}
              className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-chatroom-text-muted hover:text-chatroom-status-warning disabled:opacity-50"
            >
              <Plus size={12} />
              Add current config to favorites
            </button>
          )}
          {currentIsFavorite && (
            <div className="flex items-center gap-1 text-xs text-chatroom-text-muted">
              <Star size={12} className="text-chatroom-status-warning" />
              Current config is favorited
            </div>
          )}
          <SearchConfigFavoritesList
            favorites={favorites}
            harnesses={harnesses}
            disabled={disabled}
            onApply={onApplyConfig}
            onRemoveFavorite={onRemoveFavorite}
            onMoveFavorite={onMoveFavorite}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
