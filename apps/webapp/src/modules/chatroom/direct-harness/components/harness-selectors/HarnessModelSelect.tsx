'use client';

import { useMemo } from 'react';

import { ModelSelect, groupProviderOptions } from '../../../components/model-selection';
import { modelKey } from './harness-model-select-utils';
import type { ProviderOption } from './types';

interface HarnessModelSelectProps {
  providers: ProviderOption[];
  value: string;
  onValueChange: (v: string) => void;
  isHidden?: (modelKey: string) => boolean;
  disabled?: boolean;
}

export function HarnessModelSelect({
  providers,
  value,
  onValueChange,
  isHidden,
  disabled = false,
}: HarnessModelSelectProps) {
  const groups = useMemo(() => groupProviderOptions(providers, { modelKey }), [providers]);

  return (
    <ModelSelect
      groups={groups}
      value={value}
      onValueChange={onValueChange}
      isHidden={isHidden}
      disabled={disabled}
      triggerVariant="harness"
      contentClassName="w-72"
    />
  );
}
