/** Planner task-delivery guidance for the request-first enhancer workflow. */

import {
  ENHANCER_ENABLED_USER_WORKFLOW,
  ENHANCER_REQUEST_FIRST_WORKFLOW,
} from '../../src/domain/usecase/enhancer/enhancer-workflow';
import { contextReadCommand } from '../cli/context/read';

/** Shown only for the originating user task when enhancement is enabled. */
export function appendTaskDeliveryEnhancerGuidance(lines: string[]): void {
  lines.push('');
  lines.push('<handoff-enhancer>');
  lines.push('## Handoff Enhancer (enabled)');
  lines.push('');
  lines.push(
    '**First action after required task-intake/context setup:** hand off the user request to the enhancer. Do not research, plan, or draft a builder handoff first.'
  );
  lines.push('');
  lines.push('```');
  lines.push(ENHANCER_ENABLED_USER_WORKFLOW);
  lines.push('```');
  lines.push('');
  lines.push(
    `The enhancer pass is **one-time per originating user message**: \`${ENHANCER_REQUEST_FIRST_WORKFLOW}\`. Builder delegation and rework loops happen afterward without another enhancer pass.`
  );
  lines.push('');
  lines.push('**How it works:**');
  lines.push('1. Copy the user request into the stripped-down **Handoff to `enhancer`** template.');
  lines.push(
    '2. Hand it off immediately; do not add planner analysis, grounding, or a builder draft.'
  );
  lines.push(
    '3. The memoryless enhancer uses the origin user message ID to download authoritative chatroom history, investigates the repository, and returns independent planning input asynchronously.'
  );
  lines.push(
    '4. When that input arrives as a new planner task, use it as the first planning input; then do your own research and prepare the builder delegation or user response.'
  );
  lines.push('');
  lines.push('**The enhancer provides advisory planning input:**');
  lines.push('- User intent, constraints, and relevant history');
  lines.push('- Codebase evidence and existing patterns');
  lines.push('- Risks, failure modes, and missing groundwork');
  lines.push('- A recommended approach and concrete next steps');
  lines.push('- The planner makes the final call — input is consultative, not authoritative');
  lines.push('');
  lines.push('**After handoff to enhancer returns success:**');
  lines.push(
    '- **End your turn immediately** (CLI: run get-next-task) — do not wait for feedback, poll, monitor the enhancer, or re-submit.'
  );
  lines.push(
    '- **Enhancer → planner delivery is your resume trigger** — planning input arrives as a new planner task.'
  );
  lines.push(
    '- **Do not hand off to enhancer again for this user message** — the enhancer pass is intentionally one-time.'
  );
  lines.push(
    '- **Do not hand off to builder or user** while enhancer analysis is in progress — wait for its input first (the server rejects early handoffs).'
  );
  lines.push('');
  lines.push('</handoff-enhancer>');
}

/** Guidance when planner receives request-first planning input from the enhancer. */
export function appendTaskDeliveryEnhancerInputGuidance(
  lines: string[],
  ctx: { chatroomId: string; role: string; cliEnvPrefix: string }
): void {
  const contextReadCmd = contextReadCommand(ctx);
  lines.push('');
  lines.push('<enhancer-input>');
  lines.push('## Enhancer Planning Input');
  lines.push('');
  lines.push(
    "This task contains the enhancer's independent analysis of the user's request. It arrives before planner research or drafting by design."
  );
  lines.push('');
  lines.push('**Your job:**');
  lines.push(
    '- Treat this as your first planning input, not as a review of a planner-authored draft.'
  );
  lines.push(
    `- **Do not run context new** — continue the user task context (run \`${contextReadCmd}\` only if needed).`
  );
  lines.push(
    '- Validate the enhancer findings, then do the planner-owned research and design needed for a precise builder handoff or user response.'
  );
  lines.push('- If gaps remain, do more research before proceeding.');
  lines.push(
    '- When ready: delegate to `builder` (implementation) or hand off to `user` (delivery) using the matching template.'
  );
  lines.push(
    '- Treat the input as **advisory** — you make the final call; do not blindly follow suggestions.'
  );
  lines.push(
    '- Implementation notes may include file-level detail and code snippets — evaluate them on merit rather than treating them as a finished delegation brief.'
  );
  lines.push(
    '- **One enhancer pass per originating user message** — proceed through builder slices without re-enhancing.'
  );
  lines.push('</enhancer-input>');
}

/** Legacy envelope tag retained for in-flight failed/cancelled jobs. */
export function isPlanningReviewOutcomeContent(content: string): boolean {
  return /<planning-review-outcome\s/i.test(content);
}

/** Shown when enhancer is NOT active for this task — prevents spurious handoffs. */
export function appendTaskDeliveryEnhancerDisabledGuidance(lines: string[]): void {
  lines.push('');
  lines.push('<handoff-enhancer-disabled>');
  lines.push('## Handoff Enhancer (not active for this task)');
  lines.push('');
  lines.push(
    '**Do not hand off to `enhancer` for this task.** Enhancer is not enabled for this chatroom or this task snapshot. Delegate directly to `builder` or deliver to `user` per `<next-steps>`.'
  );
  lines.push('</handoff-enhancer-disabled>');
}

export function appendPlanningReviewOutcomeGuidance(lines: string[]): void {
  lines.push('');
  lines.push('<planning-review-outcome-intake>');
  lines.push('## Enhancer analysis did not complete');
  lines.push('');
  lines.push(
    'The enhancer was cancelled or failed before it could return planning input for the user request.'
  );
  lines.push('');
  lines.push('**Your job:**');
  lines.push('- Proceed with planner-owned research and planning without enhancer input.');
  lines.push('- **Do not retry the enhancer** for this user message.');
  lines.push('- Delegate to `builder` or hand off to `user` as appropriate.');
  lines.push('');
  lines.push('</planning-review-outcome-intake>');
}
