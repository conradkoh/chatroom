/**
 * Guidelines API for fetching review guidelines by type
 *
 * Provides a layer of indirection so different review types can have
 * different guidelines (coding, design, documentation, etc.)
 */

import { v } from 'convex/values';

import { query } from './_generated/server';
import { getReviewGuidelines } from './prompts/guidelines';
import { getDesignPolicy } from './prompts/policies/design';
import { getPerformancePolicy } from './prompts/policies/performance';
import { getSecurityPolicy } from './prompts/policies/security';

/**
 * Available guideline types
 */
export const GUIDELINE_TYPES = ['coding', 'security', 'design', 'performance', 'all'] as const;
export type GuidelineType = (typeof GUIDELINE_TYPES)[number];

/**
 * Get guidelines by type
 *
 * Returns the guidelines content for the specified type.
 * This allows reviewers to fetch specific guidelines as needed.
 */
export const getGuidelines = query({
  args: {
    type: v.union(
      v.literal('coding'),
      v.literal('security'),
      v.literal('design'),
      v.literal('performance'),
      v.literal('all')
    ),
  },
  handler: async (_ctx, args) => {
    switch (args.type) {
      case 'coding':
        return {
          type: 'coding',
          title: 'Coding Review Guidelines',
          content: getReviewGuidelines(),
        };

      case 'security':
        return {
          type: 'security',
          title: 'Security Review Guidelines',
          content: getSecurityPolicy(),
        };

      case 'design':
        return {
          type: 'design',
          title: 'Design Review Guidelines',
          content: getDesignPolicy(),
        };

      case 'performance':
        return {
          type: 'performance',
          title: 'Performance Review Guidelines',
          content: getPerformancePolicy(),
        };

      case 'all':
        return {
          type: 'all',
          title: 'All Review Guidelines',
          content: [
            '# Coding Review Guidelines\n',
            getReviewGuidelines(),
            '\n\n# Security Review Guidelines\n',
            getSecurityPolicy(),
            '\n\n# Design Review Guidelines\n',
            getDesignPolicy(),
            '\n\n# Performance Review Guidelines\n',
            getPerformancePolicy(),
          ].join(''),
        };

      default: {
        // Exhaustive check: if this errors, a new type was added but not handled
        const exhaustiveCheck: never = args.type;
        throw new Error(`Unknown guideline type: ${exhaustiveCheck}`);
      }
    }
  },
});

/**
 * List available guideline types
 */
export const listGuidelineTypes = query({
  args: {},
  handler: async () => {
    return [
      { type: 'coding', description: 'Code review guidelines (TypeScript, patterns, quality)' },
      { type: 'security', description: 'Security review guidelines (auth, input, data handling)' },
      { type: 'design', description: 'Design review guidelines (UI/UX, design system, a11y)' },
      {
        type: 'performance',
        description: 'Performance review guidelines (frontend, backend, optimization)',
      },
      { type: 'all', description: 'All guidelines combined' },
    ];
  },
});
