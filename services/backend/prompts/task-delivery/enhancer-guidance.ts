/**
 * Task-delivery section informing the planner about handoff enhancer behavior.
 *
 * Only included when enhancer is enabled for planner→builder handoffs in the chatroom.
 */

export function appendTaskDeliveryEnhancerGuidance(lines: string[]): void {
  lines.push('');
  lines.push('<handoff-enhancer>');
  lines.push('## Handoff Enhancer (enabled)');
  lines.push('');
  lines.push(
    'This chatroom uses a **planner → enhancer → planner → builder** workflow for delegations.'
  );
  lines.push('');
  lines.push('**How it works:**');
  lines.push(
    '1. Hand off to `enhancer` using the **Handoff to `enhancer`** template (enhancement draft).'
  );
  lines.push(
    '2. The enhancer polishes your draft into a full builder delegation brief **asynchronously** — the handoff command returns immediately.'
  );
  lines.push(
    '3. When enhancement completes, you receive the enhanced brief as a new planner task.'
  );
  lines.push(
    '4. Review the brief, edit if needed, then hand off to `builder` using the builder template (this step is **not** intercepted).'
  );
  lines.push('');
  lines.push(
    '**The enhancer has no context.** It cannot see this session, prior messages, attachments, or the codebase — only the templates and your draft markdown.'
  );
  lines.push('');
  lines.push('**Before you hand off to enhancer:**');
  lines.push(
    '- Follow the **Handoff to `enhancer`** template — include context, goals, and constraints the enhancer cannot infer.'
  );
  lines.push(
    '- Do not write the full builder delegation brief yet; the enhancer expands your draft into that format.'
  );
  lines.push('');
  lines.push('**After handoff to enhancer returns success:**');
  lines.push(
    '- **Run get-next-task immediately** and end your turn — do not wait for enhancement, poll, or re-submit.'
  );
  lines.push(
    '- **Do not hand off to enhancer again** while a job is in progress (you will get an error).'
  );
  lines.push('');
  lines.push('</handoff-enhancer>');
}

/** Guidance when planner receives an enhanced brief back from the enhancer. */
export function appendTaskDeliveryEnhancerReviewGuidance(lines: string[]): void {
  lines.push('');
  lines.push('<enhancer-review>');
  lines.push('## Enhanced Brief Review');
  lines.push('');
  lines.push(
    'This task contains the **enhanced delegation brief** returned by the handoff enhancer.'
  );
  lines.push('');
  lines.push('**Your job:**');
  lines.push('- Review the brief for accuracy, completeness, and alignment with user intent.');
  lines.push('- Edit the content if anything is missing or wrong.');
  lines.push(
    '- When ready, hand off to `builder` using the **Handoff to `builder`** template with the reviewed brief.'
  );
  lines.push('');
  lines.push('</enhancer-review>');
}
