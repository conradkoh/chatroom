/**
 * useHarnessConfig — shared hook for agent/model selection state.
 *
 * Encapsulates the selectedAgent/selectedModel state pair, eligibleAgents
 * filtering, and the agent+model resolution fallback chains that were
 * previously duplicated across NewSessionForm and SessionParamsPopover.
 *
 * Pure state + memo + effects — no Convex calls inside this hook.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import type { AgentOption, ProviderOption } from '../components/harness-selectors/types';
import type { HarnessVersionInfo } from '../../types/machine';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HarnessOption {
  name: string;
  displayName: string;
  agents: AgentOption[];
  providers: ProviderOption[];
  /** Daemon-reported harness version from machine.harnessVersions. */
  version?: HarnessVersionInfo;
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
  /**
   * Optional model filter predicate. When provided, models for which
   * `isModelHidden(modelKey)` returns true are excluded from `modelOptions`
   * and from `resolvedModel`. The key format is `"providerID::modelID"`.
   */
  isModelHidden?: (modelKey: string) => boolean;
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
  /** Resolved model key (after filter) — falls back through: selectedModel → agent default → first visible. */
  resolvedModel: string;
  /** Flat list of visible model options (after applying isModelHidden filter). */
  modelOptions: { value: string; label: string }[];
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useHarnessConfig({
  harnesses,
  harnessName,
  initial,
  isModelHidden: isModelHiddenFn,
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
        const key = `${provider.providerID}::${model.modelID}`;
        if (isModelHiddenFn?.(key)) continue; // exclude filtered models
        list.push({
          value: key,
          label: `${provider.name} · ${model.name}`,
        });
      }
    }
    return list;
  }, [providers, isModelHiddenFn]);

  // Resolved agent:
  //   - When agents are available: user selection → initial → first eligible
  //   - When no agents yet (harness not booted): free-text input → 'builder' default
  const resolvedAgent =
    eligibleAgents.length > 0
      ? (eligibleAgents.find((a) => a.name === selectedAgent)?.name ??
        (initial?.agent ? eligibleAgents.find((a) => a.name === initial.agent)?.name : undefined) ??
        eligibleAgents[0]?.name ??
        '')
      : selectedAgent || 'builder';

  // Resolved model (after filter): user selection → agent default → first visible model
  const agentDefaultModel = eligibleAgents.find((a) => a.name === resolvedAgent)?.model;
  const agentDefaultModelKey = agentDefaultModel
    ? `${agentDefaultModel.providerID}::${agentDefaultModel.modelID}`
    : undefined;
  const resolvedModel =
    modelOptions.find((m) => m.value === selectedModel)?.value ??
    (agentDefaultModelKey && modelOptions.find((m) => m.value === agentDefaultModelKey)?.value) ??
    modelOptions[0]?.value ??
    '';

  // ── Display-state sync effects ───────────────────────────────────────────────

  // Use refs to read stable current values without adding them to effect deps,
  // preventing infinite re-render loops.
  const selectedAgentRef = useRef(selectedAgent);
  selectedAgentRef.current = selectedAgent;

  // Effect 1: Sync selectedAgent when eligibleAgents loads or the harness changes.
  // If the current selection is invalid (empty or agent no longer in list), reset.
  useEffect(() => {
    if (eligibleAgents.length === 0) return;
    const currentAgent = selectedAgentRef.current;
    const isValid = eligibleAgents.some((a) => a.name === currentAgent);
    if (isValid) return;
    // Empty or stale selection — pick the best default
    const fallback =
      eligibleAgents.find((a) => a.name === (initial?.agent ?? ''))?.name ??
      eligibleAgents[0]?.name ??
      '';
    setSelectedAgent(fallback);
  }, [eligibleAgents, initial?.agent]);

  // Effect 2: On user-driven agent change (after initial mount), overwrite
  // selectedModel with the new agent's default model (or first visible).
  // On initial mount, do NOT overwrite if initial.model was provided — that
  // preserves the session-restore behavior when initial is populated.
  const initialMountRef = useRef(true);
  const prevResolvedAgentRef = useRef(resolvedAgent);

  useEffect(() => {
    if (initialMountRef.current) {
      initialMountRef.current = false;
      prevResolvedAgentRef.current = resolvedAgent;
      return;
    }
    if (resolvedAgent === prevResolvedAgentRef.current) return;
    prevResolvedAgentRef.current = resolvedAgent;

    // Agent changed after mount — switch model to the new agent's default
    const agent = eligibleAgents.find((a) => a.name === resolvedAgent);
    if (agent?.model) {
      const key = `${agent.model.providerID}::${agent.model.modelID}`;
      // Use the agent default if visible; otherwise fall through to first visible
      const isVisible = modelOptions.some((m) => m.value === key);
      setSelectedModel(isVisible ? key : (modelOptions[0]?.value ?? ''));
    } else {
      setSelectedModel(modelOptions[0]?.value ?? '');
    }
  }, [resolvedAgent, eligibleAgents, modelOptions]);

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
