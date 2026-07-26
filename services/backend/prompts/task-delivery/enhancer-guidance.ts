/**
 * Task-delivery section informing the planner about handoff enhancer behavior.
 *
 * Included when enhancement is enabled and the planner is about to delegate to builder
 * (initial user task or mid-task slice continuation after builder handback).
 */

export function appendTaskDeliveryEnhancerGuidance(lines: string[]): void {
  lines.push('');
  lines.push('<handoff-enhancer>');
  lines.push('## Handoff Enhancer (enabled)');
  lines.push('');
  lines.push(
    '**One check-in per builder delegation.** Before handing off to `builder` — for any slice — check in with the enhancer first.'
  );
  lines.push('');
  lines.push('**Workflow per slice:**');
  lines.push('');
  lines.push('```');
  lines.push('planner → enhancer → planner → builder → planner (review) → [next slice or user]');
  lines.push('```');
  lines.push('');
  lines.push('**Multi-slice tasks:**');
  lines.push('');
  lines.push('```mermaid');
  lines.push('flowchart TD');
  lines.push('    P[Planner] --> E1[Enhancer check-in slice 1]');
  lines.push('    E1 --> B1[Builder slice 1]');
  lines.push('    B1 --> P2[Planner reviews]');
  lines.push('    P2 -->|more slices| E2[Enhancer check-in slice 2]');
  lines.push('    E2 --> B2[Builder slice 2]');
  lines.push('    P2 -->|done| U[Handoff to user]');
  lines.push('```');
  lines.push('');
  lines.push(
    'After reviewing builder output, if more slices remain, check in with the enhancer again before delegating the next slice. Rework on the *same* slice (hand back to builder with feedback) does **not** require re-enhancement.'
  );
  lines.push('');
  lines.push(
    '**You MUST check in with the enhancer** before each builder delegation when enhancement is enabled.'
  );
  lines.push(
    '**Only one enhancer job at a time** — wait for feedback before submitting the next check-in.'
  );
  lines.push('');
  lines.push(
    '**After builder handback:** Primary target is `user` (deliver results). If more delegations remain, your **next** handoff is `enhancer` — not `builder` directly. Use `<handoffs>` to check in before delegating the next slice.'
  );
  lines.push('');
  lines.push('**How it works:**');
  lines.push(
    '1. Hand off to `enhancer` using the **Handoff to `enhancer`** template with your delegation brief.'
  );
  lines.push(
    '2. Structure your check-in with three XML sections: `<user-message>`, `<grounding>`, and `<builder-handoff>`.'
  );
  lines.push(
    '3. The enhancer returns structured **planning feedback** asynchronously — the handoff command returns immediately.'
  );
  lines.push(
    '4. When feedback arrives (new planner task), incorporate it, then hand off to `builder`.'
  );
  lines.push(
    '5. After builder returns, review output — then enhance+delegate the next slice or deliver to `user`.'
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
  lines.push(
    '- **Do not hand off to builder or user** while enhancer review is in progress — wait for feedback first (the server will reject early handoffs).'
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
  lines.push(
    '- **Do not run `context new`** — continue the user task context (`context read` only if needed).'
  );
  lines.push(
    '- Update your understanding, research, or builder handoff draft based on valid critiques.'
  );
  lines.push('- If gaps remain, do more research before proceeding.');
  lines.push(
    '- If you **already delegated to builder** before this feedback arrived, wait for the builder handback — do not delegate again.'
  );
  lines.push(
    '- When ready: delegate to `builder` (implementation) or hand off to `user` (delivery) using the matching template.'
  );
  lines.push('</enhancer-review>');
}

export function isPlanningReviewOutcomeContent(content: string): boolean {
  return /<planning-review-outcome\s/i.test(content);
}

export function appendPlanningReviewOutcomeGuidance(lines: string[]): void {
  lines.push('');
  lines.push('<planning-review-outcome-intake>');
  lines.push('## Planning review did not complete');
  lines.push('');
  lines.push(
    'This is **not** enhancer feedback. The review was cancelled or failed before the enhancer could return critiques.'
  );
  lines.push('');
  lines.push('**Your job:**');
  lines.push('- Proceed with your delegation brief using existing research — no re-review step.');
  lines.push('- Delegate to `builder` or hand off to `user` as appropriate.');
  lines.push('');
  lines.push('</planning-review-outcome-intake>');
}
