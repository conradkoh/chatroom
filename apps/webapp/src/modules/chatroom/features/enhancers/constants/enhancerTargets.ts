import type { EnhancerTarget } from '../types/enhancer';

export const ENHANCER_TARGETS: readonly EnhancerTarget[] = [
  {
    id: 'handoff:planner-to-builder',
    label: 'Handoff: Planner → Builder',
    description:
      'Enhance planner drafts into builder delegation briefs; planner reviews before builder handoff.',
  },
] as const;
