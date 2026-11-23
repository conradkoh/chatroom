/**
 * Joins parsed list items into one markdown bullet list for TimelineMarkdownBody.
 * Continuation lines are indented under their bullet so a multi-line item
 * (for example one containing a fenced block) stays inside that bullet.
 *
 * The parser keeps a continuation line's own indentation (for example the two
 * spaces before a fence nested in a bullet), so the join must add exactly the
 * list's content indent and nothing more; deeper indentation would turn the
 * fenced block into an indented code block instead of a nested fence.
 */
export function toPlanMarkdownList(items: readonly string[]): string {
  return items.map((item) => `- ${item.split('\n').join('\n  ')}`).join('\n');
}
