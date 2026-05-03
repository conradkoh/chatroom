/**
 * useHarnessConfig — shared hook for agent/model selection state.
 *
 * Encapsulates the selectedAgent/selectedModel state pair, eligibleAgents
 * filtering, and the agent+model resolution fallback chains that were
 * previously duplicated across NewSessionForm and SessionParamsPopover.
 *
 * Pure state + memo only — no Convex calls inside this hook.
 */

import { useMemo, useState } from 'react';

import type { AgentOption, ProviderOption } from '../components/HarnessSelects';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HarnessOption {
  name: string;
  displayName: string;
  agents: AgentOption[];
  providers: ProviderOption[];
}

interface UseHarnessConfigArgs {
  /** All harness options available for the workspace. */
  harnesses: HarnessOption[] | undefined | null;
  /** The name of the currently active harness. */
  harnessName: string;
  /** Optional initial selections (e.g. from session.lastUsedConfig). */
  initial?: {
    agent?: string;
    model?: { providerID: string; modelID: string };
  };
}

export interface UseHarnessConfigResult {
  selectedAgent: string;
  setSelectedAgent: (v: string) => void;
  selectedModel: string; // "<providerID>::<modelID>" or ""
  setSelectedModel: (v: string) => void;
  /** Agents eligible to be used as the primary driver (mode primary|all). */
  eligibleAgents: AgentOption[];
  /** The providers for the currently selected harness. */
  providers: ProviderOption[];
  /** Resolved agent name — falls back through: selectedAgent → initial.agent → first eligible. */
  resolvedAgent: string;
  /** Resolved model key — falls back through: selectedModel → agent default → first model. */
  resolvedModel: string;
  /** Flat list of model options derived from the harness providers. */
  modelOptions: { value: string; label: string }[];
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useHarnessConfig({
  harnesses,
  harnessName,
  initial,
}: UseHarnessConfigArgs): UseHarnessConfigResult {
  const [selectedAgent, setSelectedAgent] = useState<string>(initial?.agent ?? '');
  const [selectedModel, setSelectedModel] = useState<string>(
    initial?.model ? `${initial.model.providerID}::${initial.model.modelID}` : ''
  );

  const currentHarness = useMemo(
    () => harnesses?.find((h) => h.name === harnessName) ?? harnesses?.[0] ?? null,
    [harnesses, harnessName]
  );

  const eligibleAgents = useMemo(
    () => currentHarness?.agents.filter((a) => a.mode === 'primary' || a.mode === 'all') ?? [],
    [currentHarness]
  );

  const providers = currentHarness?.providers ?? [];

  const modelOptions = useMemo(() => {
    const list: { value: string; label: string }[] = [];
    for (const provider of providers) {
      for (const model of provider.models) {
        list.push({
          value: `${provider.providerID}::${model.modelID}`,
          label: `${provider.name} · ${model.name}`,
        });
      }
    }
    return list;
  }, [providers]);

  // Resolved agent: user selection → initial → first eligible
  const resolvedAgent =
    eligibleAgents.find((a) => a.name === selectedAgent)?.name ??
    (initial?.agent ? eligibleAgents.find((a) => a.name === initial.agent)?.name : undefined) ??
    eligibleAgents[0]?.name ??
    '';

  // Resolved model: user selection → agent default → first model
  const agentDefaultModel = eligibleAgents.find((a) => a.name === resolvedAgent)?.model;
  const agentDefaultModelKey = agentDefaultModel
    ? `${agentDefaultModel.providerID}::${agentDefaultModel.modelID}`
    : undefined;
  const resolvedModel =
    modelOptions.find((m) => m.value === selectedModel)?.value ??
    (agentDefaultModelKey && modelOptions.find((m) => m.value === agentDefaultModelKey)?.value) ??
    modelOptions[0]?.value ??
    '';

  return {
    selectedAgent,
    setSelectedAgent,
    selectedModel,
    setSelectedModel,
    eligibleAgents,
    providers,
    resolvedAgent,
    resolvedModel,
    modelOptions,
  };
}
