'use client';

// fallow-ignore-file complexity

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useEffect, useMemo, useRef, useState } from 'react';

import { parseModelKey } from '@/modules/chatroom/direct-harness/components/harness-selectors';
import type { HarnessOption } from '@/modules/chatroom/direct-harness/hooks/useHarnessConfig';
import { useNativeHarnessWorkspace } from '@/modules/chatroom/direct-harness/hooks/useNativeHarnessWorkspace';
import { useSearchConfigUsage } from '@/modules/chatroom/features/search-config/hooks/useSearchConfigUsage';

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

  const [harnessName, setHarnessName] = useState<string>('opencode-sdk');
  const [selectedModel, setSelectedModel] = useState('');

  // Initialize from machine-scoped localStorage or legacy migration once machineId is known
  const [initialized, setInitialized] = useState(false);
  useEffect(() => {
    if (initialized || !machineId) return;
    setInitialized(true);

    // Try legacy migration first
    const legacyRaw = migrateLegacyWorkspaceKey(workspaceId, machineId);
    let persisted: PersistedHarnessSelection | null = null;
    if (legacyRaw) {
      try {
        persisted = JSON.parse(legacyRaw) as PersistedHarnessSelection;
      } catch {}
    }
    // Try machine-scoped key
    if (!persisted) persisted = readPersisted(machineId);
    // Try last-used from usage store
    const lastUsed = getLastUsed();
    if (lastUsed) {
      setHarnessName(lastUsed.harnessName);
      setSelectedModel(lastUsed.modelKey);
    } else if (persisted) {
      setHarnessName(persisted.harnessName);
      setSelectedModel(persisted.modelKey);
    }
  }, [machineId, workspaceId, initialized, getLastUsed]);

  const { harnesses, resolvedHarnessName, filter } = useNativeHarnessWorkspace(
    capabilities,
    harnessName
  );
  const providers = harnesses.find((h) => h.name === resolvedHarnessName)?.providers ?? [];

  const modelOptions = useMemo(
    () => buildModelOptions(harnesses, resolvedHarnessName, filter.isHidden),
    [filter.isHidden, harnesses, resolvedHarnessName]
  );

  const resolvedModel =
    modelOptions.find((option) => option.value === selectedModel)?.value ??
    modelOptions[0]?.value ??
    '';

  const selectedModelRef = useRef(selectedModel);
  selectedModelRef.current = selectedModel;

  useEffect(() => {
    if (modelOptions.length === 0) return;
    const current = selectedModelRef.current;
    if (modelOptions.some((option) => option.value === current)) return;
    const fallback = modelOptions[0]?.value ?? '';
    if (fallback !== current) setSelectedModel(fallback);
  }, [modelOptions]);

  useEffect(() => {
    if (!machineId) return;
    writePersisted(machineId, {
      harnessName: resolvedHarnessName,
      modelKey: resolvedModel,
    });
  }, [resolvedHarnessName, resolvedModel, machineId]);

  // Record usage when selection resolves
  useEffect(() => {
    if (!machineId || !resolvedHarnessName || !resolvedModel) return;
    recordUsage({ harnessName: resolvedHarnessName, modelKey: resolvedModel });
  }, [machineId, resolvedHarnessName, resolvedModel, recordUsage]);

  const selectionReady = !!resolvedHarnessName && (modelOptions.length === 0 || !!resolvedModel);

  const toSubmitSelection = (): AgenticQueryHarnessSelection => ({
    harnessName: resolvedHarnessName,
    model: parseModelKey(resolvedModel),
  });

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
  };
}
