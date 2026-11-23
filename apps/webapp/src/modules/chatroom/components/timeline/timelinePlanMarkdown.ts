/**
 * Joins parsed list items into one markdown bullet list for TimelineMarkdownBody.
 * Continuation lines are indented under their bullet so a multi-line item
 * (for example one containing a fenced block) stays inside that bullet.
 *
 * The parser keeps each continuation line's own indentation, and this join adds
 * the bullet's two-space content indent on top of it. A fence written two spaces
 * deep in the plan therefore stays a nested fence under its bullet; a fence
 * written four or more spaces deep becomes an indented code block instead.
 */
export function toPlanMarkdownList(items: readonly string[]): string {
  return items.map((item) => `- ${item.split('\n').join('\n  ')}`).join('\n');
}
