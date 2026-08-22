import type { EnhancerTarget } from '../types/enhancer';

export const ENHANCER_TARGETS: readonly EnhancerTarget[] = [
  {
    id: 'handoff:planner-to-builder',
    label: 'Request-first planning input',
    description: 'Analyze each new user request once before the team entry point begins work.',
  },
] as const;
