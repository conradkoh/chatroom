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
  lines.push('This chatroom has the **handoff enhancer** enabled for planner→builder delegations.');
  lines.push('');
  lines.push('**How it works:**');
  lines.push(
    'When you run `chatroom handoff --next-role=builder`, your draft delegation brief is sent to a separate enhancer model before delivery to the builder. Enhancement runs **asynchronously** — the handoff command returns immediately while the enhancer polishes your draft.'
  );
  lines.push('');
  lines.push(
    '**The enhancer has no context.** It cannot see this session, prior messages, attachments, or the codebase — only the handoff template and your draft markdown. Anything the builder needs must be written into the delegation brief.'
  );
  lines.push('');
  lines.push('**Before you hand off to builder:**');
  lines.push(
    '- Write each delegation brief as **fully self-contained** — include all context, file paths, code snippets, and requirements.'
  );
  lines.push(
    '- Follow the **Handoff to `builder`** template; the enhancer improves clarity and detail but does not research or add scope.'
  );
  lines.push('');
  lines.push('**After handoff returns success:**');
  lines.push(
    '- **Run get-next-task immediately** and end your turn — do not wait for enhancement, poll, or re-submit the handoff.'
  );
  lines.push(
    '- **Do not hand off to builder again** while an enhancer job is in progress (you will get an error).'
  );
  lines.push('');
  lines.push('</handoff-enhancer>');
}
