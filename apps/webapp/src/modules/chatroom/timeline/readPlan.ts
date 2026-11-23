import { parsePlan, type ParsedPlan } from '@workspace/backend/src/domain/plan/parse-plan';

/**
 * Parse failure and thrown exceptions both return null; callers fall back to raw markdown / plain text.
 * This is the single guarded entry point into `parsePlan` for the webapp, so the body and the
 * collapsed summary cannot drift apart.
 */
export function readPlan(content: string): ParsedPlan | null {
  try {
    const result = parsePlan(content);
    return result.ok ? result.plan : null;
  } catch {
    return null;
  }
}
