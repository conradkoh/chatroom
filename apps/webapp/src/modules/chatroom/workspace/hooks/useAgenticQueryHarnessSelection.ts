'use client';

// fallow-ignore-file complexity

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useCallback, useMemo, useRef, useState } from 'react';

import { parseModelKey } from '@/modules/chatroom/direct-harness/components/harness-selectors';
import type { HarnessOption } from '@/modules/chatroom/direct-harness/hooks/useHarnessConfig';
import { useNativeHarnessWorkspace } from '@/modules/chatroom/direct-harness/hooks/useNativeHarnessWorkspace';
import { useSearchConfigFavorites } from '@/modules/chatroom/features/search-config/hooks/useSearchConfigFavorites';
import { useSearchConfigUsage } from '@/modules/chatroom/features/search-config/hooks/useSearchConfigUsage';
import type { SearchConfigEntry } from '@/modules/chatroom/features/search-config/types/searchConfig';

export interface AgenticQueryHarnessSelection {
  harnessName: string;
  model?: { providerID: string; modelID: string };
}

interface PersistedHarnessSelection {
  harnessName: string;
  modelKey: string;
}

function storageKey(machineId: string): string {
  return `agentic-query-harness:${machineId}`;
}

function migrateLegacyWorkspaceKey(workspaceId: string, machineId: string): string | null {
  const legacyKey = `agentic-query-harness:${workspaceId}`;
  try {
    const raw = localStorage.getItem(legacyKey);
    if (!raw) return null;
    const machineKey = storageKey(machineId);
    if (localStorage.getItem(machineKey)) return null;
    localStorage.setItem(machineKey, raw);
    return raw;
  } catch {
    return null;
  }
}

function readPersisted(machineId: string): PersistedHarnessSelection | null {
  if (typeof window === 'undefined' || !machineId) return null;
  try {
    const raw = localStorage.getItem(storageKey(machineId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedHarnessSelection;
    if (typeof parsed.harnessName !== 'string') return null;
    return {
      harnessName: parsed.harnessName,
      modelKey: typeof parsed.modelKey === 'string' ? parsed.modelKey : '',
    };
  } catch {
    return null;
  }
}

function writePersisted(machineId: string, value: PersistedHarnessSelection): void {
  if (typeof window === 'undefined' || !machineId) return;
  localStorage.setItem(storageKey(machineId), JSON.stringify(value));
}

function buildModelOptions(
  harnesses: HarnessOption[],
  harnessName: string,
  isModelHidden?: (modelKey: string) => boolean
): { value: string; label: string }[] {
  const harness = harnesses.find((h) => h.name === harnessName);
  if (!harness) return [];

  const list: { value: string; label: string }[] = [];
  for (const provider of harness.providers) {
    for (const model of provider.models) {
      const key = `${provider.providerID}::${model.modelID}`;
      if (isModelHidden?.(key)) continue;
      list.push({
        value: key,
        label: `${provider.name} · ${model.name}`,
      });
    }
  }
  return list;
}

export function useAgenticQueryHarnessSelection(workspaceId: string) {
  const capabilities = useSessionQuery(
    api.web.directHarness.capabilities.listForWorkspace,
    workspaceId ? { workspaceId: workspaceId as Id<'chatroom_workspaces'> } : 'skip'
  );

  const machineId = (capabilities as { machineId?: string } | null)?.machineId ?? null;
  const { getLastUsed, recordUsage } = useSearchConfigUsage(machineId);
  const {
    favorites,
    addFavorite,
    removeFavorite,
    moveFavorite,
    isFavorite,
    isLoading: favoritesLoading,
  } = useSearchConfigFavorites(machineId);

  const [harnessName, setHarnessName] = useState<string>('opencode-sdk');
  const [selectedModel, setSelectedModel] = useState('');
  const initializedRef = useRef(false);
  useMemo(() => {
    if (initializedRef.current || !machineId) return;
    initializedRef.current = true;
    const legacyRaw = migrateLegacyWorkspaceKey(workspaceId, machineId);
    const persisted = legacyRaw ? readPersisted(machineId) : readPersisted(machineId);
    const selection = persisted ?? getLastUsed();
    if (selection) {
      setHarnessName(selection.harnessName);
      setSelectedModel(selection.modelKey);
    }
  }, [getLastUsed, machineId, workspaceId]);

  const { harnesses, resolvedHarnessName, filter } = useNativeHarnessWorkspace(
    capabilities,
    harnessName
  );
  const providers = useMemo(
    () => harnesses.find((h) => h.name === resolvedHarnessName)?.providers ?? [],
    [harnesses, resolvedHarnessName]
  );

  const modelOptions = useMemo(
    () => buildModelOptions(harnesses, resolvedHarnessName, filter.isHidden),
    [filter.isHidden, harnesses, resolvedHarnessName]
  );

  const resolvedModel =
    modelOptions.find((option) => option.value === selectedModel)?.value ??
    modelOptions[0]?.value ??
    '';

  const initialized = initializedRef.current;
  useMemo(() => {
    if (!machineId || !initialized || !resolvedHarnessName || !resolvedModel) return;
    writePersisted(machineId, { harnessName: resolvedHarnessName, modelKey: resolvedModel });
    recordUsage({ harnessName: resolvedHarnessName, modelKey: resolvedModel });
  }, [initialized, machineId, recordUsage, resolvedHarnessName, resolvedModel]);

  const selectionReady = !!resolvedHarnessName && (modelOptions.length === 0 || !!resolvedModel);

  const toSubmitSelection = (): AgenticQueryHarnessSelection => ({
    harnessName: resolvedHarnessName,
    model: parseModelKey(resolvedModel),
  });

  const currentEntry: SearchConfigEntry | null =
    resolvedHarnessName && resolvedModel
      ? { harnessName: resolvedHarnessName, modelKey: resolvedModel }
      : null;

  const applyConfig = useCallback((entry: SearchConfigEntry) => {
    setHarnessName(entry.harnessName);
    setSelectedModel(entry.modelKey);
  }, []);

  return {
    harnesses,
    harnessName: resolvedHarnessName,
    setHarnessName,
    providers,
    selectedModel,
    setSelectedModel,
    isModelHidden: filter.isHidden,
    selectionReady,
    toSubmitSelection,
    isLoading: workspaceId ? capabilities === undefined : false,
    machineId,
    filter,
    currentEntry,
    applyConfig,
    favorites,
    addFavorite,
    removeFavorite,
    moveFavorite,
    isFavorite,
    favoritesLoading,
  };
}
