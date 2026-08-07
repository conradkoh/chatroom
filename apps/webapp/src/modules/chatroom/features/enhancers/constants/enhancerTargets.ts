import type { EnhancerTarget } from '../types/enhancer';

export const ENHANCER_TARGETS: readonly EnhancerTarget[] = [
  {
    id: 'handoff:planner-to-builder',
    label: 'Planning review (before builder)',
    description: 'Require a planner check-in with the enhancer before each delegation to builder.',
  },
] as const;
