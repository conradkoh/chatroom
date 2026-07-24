'use client';

import { useMemo } from 'react';

import { PickerOptionRow } from '../picker';
import { filterModelGroups } from './filterModelGroups';
import { ModelFilterProviderHeader } from './ModelFilterProviderHeader';
import { isModelEffectivelyHidden } from './modelVisibility';
import type { ModelGroup } from './types';

import { cn } from '@/lib/utils';

interface ModelGroupedListBaseProps {
  groups: ModelGroup[];
  searchTerm?: string;
  emptyMessage?: string;
}

export interface ModelGroupedListSelectProps extends ModelGroupedListBaseProps {
  mode: 'select';
  value: string;
  onValueChange: (value: string) => void;
  onClose: () => void;
  isHidden?: (value: string) => boolean;
  allowDeselect?: boolean;
}

export interface ModelGroupedListVisibilityProps extends ModelGroupedListBaseProps {
  mode: 'visibility-toggle';
  hiddenModels: string[];
  hiddenProviders: string[];
  onModelToggle: (modelId: string) => void;
  onProviderToggle: (providerKey: string) => void;
  disabled?: boolean;
}

export type ModelGroupedListProps = ModelGroupedListSelectProps | ModelGroupedListVisibilityProps;

export function ModelGroupedList(props: ModelGroupedListProps) {
  const { groups, searchTerm = '', emptyMessage = 'No models found.', mode } = props;
  const isHidden = mode === 'select' ? props.isHidden : undefined;

  const filtered = useMemo(() => {
    if (mode === 'select') {
      return filterModelGroups(groups, searchTerm, { isHidden });
    }
    return filterModelGroups(groups, searchTerm);
  }, [groups, searchTerm, mode, isHidden]);

  const hiddenModelsSet = useMemo(() => {
    if (mode !== 'visibility-toggle') return new Set<string>();
    return new Set(props.hiddenModels);
  }, [mode, mode === 'visibility-toggle' ? props.hiddenModels : null]);

  const hiddenProvidersSet = useMemo(() => {
    if (mode !== 'visibility-toggle') return new Set<string>();
    return new Set(props.hiddenProviders);
  }, [mode, mode === 'visibility-toggle' ? props.hiddenProviders : null]);

  if (filtered.length === 0) {
    return <p className="px-3 py-2 text-xs text-chatroom-text-muted">{emptyMessage}</p>;
  }

  if (mode === 'select') {
    const { value, onValueChange, onClose, allowDeselect = true } = props;
    return (
      <>
        {filtered.map((group) => (
          <div key={group.providerKey}>
            <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider text-chatroom-text-muted">
              {group.providerLabel}
            </p>
            {group.options.map((option) => {
              const isSelected = value === option.value;
              return (
                <PickerOptionRow
                  key={option.value}
                  selected={isSelected}
                  onSelect={() => {
                    onValueChange(isSelected && allowDeselect ? '' : option.value);
                    onClose();
                  }}
                >
                  {option.label}
                </PickerOptionRow>
              );
            })}
          </div>
        ))}
      </>
    );
  }

  const { onModelToggle, onProviderToggle, disabled = false } = props;

  return (
    <>
      {filtered.map((group) => {
        const isProviderHidden = hiddenProvidersSet.has(group.providerKey);
        return (
          <div key={group.providerKey}>
            <ModelFilterProviderHeader
              providerLabel={group.providerLabel}
              isProviderHidden={isProviderHidden}
              disabled={disabled}
              onToggle={() => onProviderToggle(group.providerKey)}
            />

            {group.options.map((option) => {
              const isEffectivelyHidden = isModelEffectivelyHidden(
                option.value,
                group.providerKey,
                hiddenModelsSet,
                hiddenProvidersSet
              );

              return (
                <div
                  key={option.value}
                  className={cn(
                    'py-1 flex items-center gap-2 hover:bg-chatroom-bg-hover cursor-pointer group',
                    isProviderHidden ? 'pl-5 pr-4 border-l-2 border-chatroom-border' : 'px-4'
                  )}
                  onClick={() => onModelToggle(option.value)}
                  role="checkbox"
                  aria-checked={!isEffectivelyHidden}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onModelToggle(option.value);
                    }
                  }}
                >
                  <div
                    className={
                      isEffectivelyHidden
                        ? 'w-3 h-3 border border-chatroom-border bg-chatroom-bg-tertiary flex-shrink-0'
                        : 'w-3 h-3 border border-chatroom-accent bg-chatroom-accent flex-shrink-0'
                    }
                  />
                  <span
                    className={
                      isEffectivelyHidden
                        ? 'text-[10px] uppercase tracking-wider text-chatroom-text-muted flex-1 truncate opacity-50'
                        : 'text-[10px] uppercase tracking-wider text-chatroom-text-primary flex-1 truncate'
                    }
                  >
                    {option.label}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}
