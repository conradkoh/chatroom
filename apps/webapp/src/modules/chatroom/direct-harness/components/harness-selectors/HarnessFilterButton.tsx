'use client';

import { ModelFilterButton } from '../../../components/model-selection';
import type { UseHarnessModelFilterResult } from '../../hooks/useHarnessModelFilter';
import type { ProviderOption } from './types';

interface HarnessFilterButtonProps {
  filter: UseHarnessModelFilterResult;
  providers: ProviderOption[];
}

export function HarnessFilterButton({ filter, providers }: HarnessFilterButtonProps) {
  return <ModelFilterButton filter={filter} providers={providers} variant="harness" />;
}
