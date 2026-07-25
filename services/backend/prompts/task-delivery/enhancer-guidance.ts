/**
 * Task-delivery section informing the planner about handoff enhancer behavior.
 *
 * Only included when enhancer is enabled for planner→builder handoffs in the chatroom.
 */

export function appendTaskDeliveryEnhancerGuidance(lines: string[]): void {
  lines.push('');
  lines.push('<handoff-enhancer>');
  lines.push('## Handoff Enhancer (enabled — mandatory check-in)');
  lines.push('');
  lines.push(
    'This chatroom requires a **planner → enhancer → planner** review loop before you delegate to builder or hand off to the user.'
  );
  lines.push('');
  lines.push(
    '**You MUST check in with the enhancer** — there is no option to skip this step while the enhancer is enabled.'
  );
  lines.push('');
  lines.push('**How it works:**');
  lines.push(
    '1. **Before** delegating to builder or delivering to user, hand off to `enhancer` using the **Handoff to `enhancer`** template.'
  );
  lines.push(
    '2. Structure your check-in with three XML sections: `<user-message>`, `<grounding>`, and `<builder-handoff>`.'
  );
  lines.push(
    '3. The enhancer returns structured **planning feedback** asynchronously — the handoff command returns immediately.'
  );
  lines.push(
    '4. When feedback arrives, address it in a new planner task, then proceed to `builder` or `user`.'
  );
  lines.push('');
  lines.push(
    '**The enhancer has no context.** It cannot see this session, prior messages, attachments, or the codebase — only your check-in markdown.'
  );
  lines.push('');
  lines.push('**Your check-in MUST use these XML sections:**');
  lines.push("- `<user-message>` — the user's request (verbatim or faithful quote)");
  lines.push(
    '- `<grounding>` — code examples, file references, technology choices, and detailed observations from your research'
  );
  lines.push(
    '- `<builder-handoff>` — your complete, filled-in planner→builder Delegation Brief (for review, not placeholders)'
  );
  lines.push('');
  lines.push('**The enhancer will critique:**');
  lines.push('- Mistakes in assessing what the user may want');
  lines.push('- Knowledge gaps in your research');
  lines.push('- Logical or reasoning errors');
  lines.push('- How to tighten your work toward a strong planner→user handoff');
  lines.push('');
  lines.push('**After handoff to enhancer returns success:**');
  lines.push(
    '- **Run get-next-task immediately** and end your turn — do not wait for feedback, poll, or re-submit.'
  );
  lines.push(
    '- **Do not hand off to enhancer again** while a job is in progress (you will get an error).'
  );
  lines.push('');
  lines.push('</handoff-enhancer>');
}

/** Guidance when planner receives planning feedback from the enhancer. */
export function appendTaskDeliveryEnhancerReviewGuidance(lines: string[]): void {
  lines.push('');
  lines.push('<enhancer-review>');
  lines.push('## Enhancer Planning Feedback');
  lines.push('');
  lines.push(
    'This task contains **planning feedback** from the handoff enhancer on your check-in.'
  );
  lines.push('');
  lines.push('**Your job:**');
  lines.push('- Read each feedback section (user intent, knowledge gaps, reasoning, alignment).');
  lines.push('- Update your understanding, research, or conclusions based on valid critiques.');
  lines.push('- If gaps remain, do more research before proceeding.');
  lines.push(
    '- When ready: delegate to `builder` (implementation) or hand off to `user` (delivery) using the matching template.'
  );
  lines.push(
    '- If your conclusions changed significantly, **check in with the enhancer again** before proceeding.'
  );
  lines.push('');
  lines.push('</enhancer-review>');
}
