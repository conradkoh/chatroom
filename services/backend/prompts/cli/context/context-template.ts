/**
 * Canonical markdown template for `chatroom context new` stdin body.
 * Use italic guidance — never angle-bracket placeholders (agents copy them literally).
 */
export const CONTEXT_VIEW_TEMPLATE = `## Goal
- **User-centric:** _Describe what the user wants in plain language._
- **Development-centric:** _Describe what we are building or changing._

## Requirements
- _One concrete outcome or requirement per bullet._

## Structure
- _Key files, folders, or architecture decisions (e.g. module boundaries, SSOT locations)._

## Avoid
- _Out-of-scope work or anti-patterns to skip._`;

export function getContextViewTemplate(): string {
  return CONTEXT_VIEW_TEMPLATE;
}
