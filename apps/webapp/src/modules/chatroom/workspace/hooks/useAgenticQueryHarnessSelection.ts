'use client';

// fallow-ignore-file complexity

import { api } from '@workspace/backend/convex/_generated/api';
import type { Id } from '@workspace/backend/convex/_generated/dataModel';
import { useSessionQuery } from 'convex-helpers/react/sessions';
import { useEffect, useMemo, useRef, useState } from 'react';

import { parseModelKey } from '@/modules/chatroom/direct-harness/components/harness-selectors';
import type { HarnessOption } from '@/modules/chatroom/direct-harness/hooks/useHarnessConfig';
import { useNativeHarnessWorkspace } from '@/modules/chatroom/direct-harness/hooks/useNativeHarnessWorkspace';

export interface AgenticQueryHarnessSelection {
  harnessName: string;
  model?: { providerID: string; modelID: string };
}

interface PersistedHarnessSelection {
  harnessName: string;
  modelKey: string;
}

function storageKey(workspaceId: string): string {
  return `agentic-query-harness:${workspaceId}`;
}

function readPersisted(workspaceId: string): PersistedHarnessSelection | null {
  if (typeof window === 'undefined' || !workspaceId) return null;
  try {
    const raw = localStorage.getItem(storageKey(workspaceId));
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

function writePersisted(workspaceId: string, value: PersistedHarnessSelection): void {
  if (typeof window === 'undefined' || !workspaceId) return;
  localStorage.setItem(storageKey(workspaceId), JSON.stringify(value));
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
  const persisted = useMemo(() => readPersisted(workspaceId), [workspaceId]);
  const [harnessName, setHarnessName] = useState(persisted?.harnessName ?? 'opencode-sdk');
  const [selectedModel, setSelectedModel] = useState(persisted?.modelKey ?? '');

  const capabilities = useSessionQuery(
    api.web.directHarness.capabilities.listForWorkspace,
    workspaceId ? { workspaceId: workspaceId as Id<'chatroom_workspaces'> } : 'skip'
  );

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
    if (!workspaceId) return;
    writePersisted(workspaceId, {
      harnessName: resolvedHarnessName,
      modelKey: resolvedModel,
    });
  }, [resolvedHarnessName, resolvedModel, workspaceId]);

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
