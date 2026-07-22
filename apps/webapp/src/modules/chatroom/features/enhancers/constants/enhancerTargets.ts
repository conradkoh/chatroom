import type { EnhancerTarget } from '../types/enhancer';

export const ENHANCER_TARGETS: readonly EnhancerTarget[] = [
  {
    id: 'handoff:planner-to-builder',
    label: 'Handoff: Planner → Builder',
    description: 'Enhance planner-to-builder delegation briefs with a single-turn completion.',
  },
] as const;
