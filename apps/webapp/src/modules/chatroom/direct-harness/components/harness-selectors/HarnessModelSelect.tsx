'use client';

import { useCallback, useMemo } from 'react';

import {
  ModelSelect,
  groupProviderOptions,
  findModelLabel,
} from '../../../components/model-selection';
import type { ModelGroup } from '../../../components/model-selection/types';
import { modelKey } from './harness-model-select-utils';
import type { ProviderOption } from './types';

interface HarnessModelSelectProps {
  providers: ProviderOption[];
  value: string;
  onValueChange: (v: string) => void;
  isHidden?: (modelKey: string) => boolean;
  disabled?: boolean;
}

function getSelectedModelLabel(providers: ProviderOption[], value: string): string | undefined {
  if (!value) return undefined;
  const [providerID, modelID] = value.split('::');
  const provider = providers.find((p) => p.providerID === providerID);
  const model = provider?.models.find((m) => m.modelID === modelID);
  if (!provider || !model) return undefined;
  return `${provider.name} / ${model.name}`;
}

export function HarnessModelSelect({
  providers,
  value,
  onValueChange,
  isHidden,
  disabled = false,
}: HarnessModelSelectProps) {
  const groups = useMemo(() => groupProviderOptions(providers, { modelKey }), [providers]);

  const getTriggerLabel = useCallback(
    (_groups: ModelGroup[], val: string) =>
      getSelectedModelLabel(providers, val) ?? findModelLabel(_groups, val),
    [providers]
  );

  return (
    <ModelSelect
      groups={groups}
      value={value}
      onValueChange={onValueChange}
      isHidden={isHidden}
      disabled={disabled}
      triggerVariant="harness"
      contentClassName="w-72"
      getTriggerLabel={getTriggerLabel}
    />
  );
}
