'use client';

import { Check, Plus, Star } from 'lucide-react';

import { EnhancerConfigFavoritesList } from './EnhancerConfigFavoritesList';
import { EnhancerHarnessModelSelect } from './EnhancerHarnessModelSelect';
import { en } from '../../../lang/en';
import type { AgentHarness } from '../../../types/machine';
import { ENHANCER_TARGETS } from '../constants/enhancerTargets';
import type { EnhancerConfigEntry } from '../types/enhancerConfigEntry';

export interface EnhancerConfigFormProps {
  targetId: string;
  onTargetIdChange: (id: string) => void;
  machineId: string | null | undefined;
  agentHarness: AgentHarness | null;
  model: string;
  onHarnessChange: (h: AgentHarness) => void;
  onModelChange: (m: string) => void;
  canSave: boolean;
  saveButtonLabel: string;
  onSave: () => void;
  onCancel: () => void;
  currentEntry: EnhancerConfigEntry | null;
  currentIsFavorite: boolean;
  targetFavorites: EnhancerConfigEntry[];
  onAddFavorite: (entry: EnhancerConfigEntry) => void;
  onRemoveFavorite: (entry: EnhancerConfigEntry) => void;
  onMoveFavorite: (fromIndex: number, toIndex: number) => void;
  handleApplyFavorite: (entry: EnhancerConfigEntry) => void;
  handleMoveFavorite: (fromIndex: number, toIndex: number) => void;
}

export function EnhancerConfigForm({
  targetId,
  onTargetIdChange,
  machineId,
  agentHarness,
  model,
  onHarnessChange,
  onModelChange,
  canSave,
  saveButtonLabel,
  onSave,
  onCancel,
  currentEntry,
  currentIsFavorite,
  targetFavorites,
  onAddFavorite,
  onRemoveFavorite,
  handleApplyFavorite,
  handleMoveFavorite,
}: EnhancerConfigFormProps) {
  return (
    <div className="flex flex-col gap-4 py-2">
      <div>
        <label className="block text-xs font-medium text-chatroom-text-secondary mb-2">
          Target
        </label>
        <div className="flex flex-col gap-1.5">
          {ENHANCER_TARGETS.map((target) => (
            <button
              key={target.id}
              type="button"
              onClick={() => onTargetIdChange(target.id)}
              className={`flex items-start gap-2 px-2 py-2 border-2 text-left transition-colors ${
                targetId === target.id
                  ? 'border-chatroom-accent bg-chatroom-accent/5'
                  : 'border-chatroom-border hover:border-chatroom-border-strong'
              }`}
            >
              <span
                className={`mt-0.5 flex-shrink-0 w-4 h-4 flex items-center justify-center border-2 ${
                  targetId === target.id
                    ? 'border-chatroom-accent bg-chatroom-accent text-chatroom-bg-primary'
                    : 'border-chatroom-border'
                }`}
              >
                {targetId === target.id && <Check size={12} />}
              </span>
              <div className="flex flex-col">
                <span className="text-sm text-chatroom-text-primary">{target.label}</span>
                <span className="text-xs text-chatroom-text-muted mt-0.5">
                  {target.description}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>

      <EnhancerHarnessModelSelect
        machineId={machineId}
        agentHarness={agentHarness}
        model={model}
        onHarnessChange={onHarnessChange}
        onModelChange={onModelChange}
      />

      {currentEntry && !currentIsFavorite && (
        <button
          type="button"
          onClick={() => onAddFavorite(currentEntry)}
          className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-chatroom-text-muted hover:text-chatroom-status-warning"
        >
          <Plus size={12} />
          {en.configFavorites.addCurrentConfig}
        </button>
      )}
      {currentEntry && currentIsFavorite && (
        <div className="flex items-center gap-1 text-xs text-chatroom-text-muted">
          <Star size={12} className="text-chatroom-status-warning" />
          {en.configFavorites.currentConfigFavorited}
        </div>
      )}

      <EnhancerConfigFavoritesList
        favorites={targetFavorites}
        onApply={handleApplyFavorite}
        onRemoveFavorite={onRemoveFavorite}
        onMoveFavorite={handleMoveFavorite}
      />

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-chatroom-border">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1.5 text-sm border-2 border-chatroom-border text-chatroom-text-primary hover:bg-chatroom-bg-hover rounded-none transition-colors"
        >
          Cancel
        </button>

        <button
          type="button"
          onClick={onSave}
          disabled={!canSave}
          className="px-3 py-1.5 text-sm bg-chatroom-accent text-chatroom-bg-primary hover:bg-chatroom-text-secondary rounded-none transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {saveButtonLabel}
        </button>
      </div>
    </div>
  );
}
