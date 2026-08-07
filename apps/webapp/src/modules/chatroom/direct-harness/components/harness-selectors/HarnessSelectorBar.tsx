'use client';

import { useCallback, useMemo } from 'react';

import { HarnessHarnessSelect } from './HarnessHarnessSelect';
import { HarnessAgentSelect } from './HarnessAgentSelect';
import {
  ModelSelect,
  ModelFilterButton,
  groupProviderOptions,
  harnessModelKey,
  getHarnessModelLabel,
  findModelLabel,
} from '../../../components/model-selection';
import type { HarnessOption, UseHarnessConfigResult } from '../../hooks/useHarnessConfig';
import type { UseMachineModelFilterResult } from '../../../components/model-selection';
import type { ModelGroup } from '../../../components/model-selection/types';

export interface HarnessSelectorBarProps {
  harnesses: HarnessOption[];
  harnessName: string;
  onHarnessChange: (name: string) => void;
  harnessFrozen?: boolean;
  config: UseHarnessConfigResult;
  filter?: UseMachineModelFilterResult;
}

export function HarnessSelectorBar({
  harnesses,
  harnessName,
  onHarnessChange,
  harnessFrozen,
  config,
  filter,
}: HarnessSelectorBarProps) {
  const {
    selectedAgent,
    setSelectedAgent,
    selectedModel,
    setSelectedModel,
    providers,
    resolvedAgent,
  } = config;

  const selectedHarness = harnesses.find((h) => h.name === harnessName) ?? harnesses[0];
  const currentHarnessAgents = selectedHarness?.agents ?? [];

  const showFilter = filter && filter.enabled;

  const groups = useMemo(
    () => groupProviderOptions(providers, { modelKey: harnessModelKey }),
    [providers]
  );

  const getTriggerLabel = useCallback(
    (_groups: ModelGroup[], val: string) =>
      getHarnessModelLabel(providers, val) ?? findModelLabel(_groups, val),
    [providers]
  );

  return (
    <div className="flex gap-2">
      <div className="w-32 shrink-0">
        <HarnessHarnessSelect
          harnesses={harnesses}
          value={harnessName}
          onValueChange={onHarnessChange}
          disabled={harnessFrozen}
        />
      </div>
      <div className="w-28 shrink-0">
        <HarnessAgentSelect
          agents={currentHarnessAgents}
          value={selectedAgent}
          onValueChange={setSelectedAgent}
          resolvedAgent={resolvedAgent}
        />
      </div>
      <div className="flex-1 min-w-0">
        <ModelSelect
          groups={groups}
          value={selectedModel}
          onValueChange={setSelectedModel}
          isHidden={filter?.isHidden}
          getTriggerLabel={getTriggerLabel}
          triggerVariant="harness"
          contentClassName="w-72"
        />
      </div>
      {showFilter && <ModelFilterButton filter={filter} providers={providers} variant="harness" />}
    </div>
  );
}
