/**
 * Workflow Template Registry
 *
 * Templates define pre-filled structured workflows. Each template
 * produces a set of sequential (or DAG) steps that the planner
 * discloses one at a time.
 */

export type { TemplateStep, WorkflowTemplate } from './types';
import { getCodeReviewTemplate } from './code-review';

/**
 * Return a workflow template by name, or null if unknown.
 */
export function getTemplate(
  name: string,
  role: string
): import('./types').WorkflowTemplate | null {
  switch (name.toLowerCase()) {
    case 'code-review':
      return getCodeReviewTemplate(role);
    default:
      return null;
  }
}

export { getCodeReviewTemplate };
