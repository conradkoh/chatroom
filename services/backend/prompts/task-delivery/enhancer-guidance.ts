/** Entry-point task-delivery guidance for the request-first enhancer workflow. */

import {
  getEnhancerEnabledUserWorkflow,
  getEnhancerRequestFirstWorkflow,
} from '../../src/domain/usecase/enhancer/enhancer-workflow';
import { contextReadCommand } from '../cli/context/read';

/** Shown only for the originating user task when enhancement is enabled. */
export function appendTaskDeliveryEnhancerGuidance(
  lines: string[],
  params: { entryPointRole: string; hasBuilder: boolean }
): void {
  const entryPointRole = params.entryPointRole.toLowerCase();
  lines.push('');
  lines.push('<handoff-enhancer>');
  lines.push('## Handoff Enhancer (enabled)');
  lines.push('');
  lines.push(
    '**First action after required task-intake/context setup:** hand off the user request to the enhancer. Do not research, plan, or draft implementation instructions first.'
  );
  lines.push('');
  lines.push('```');
  lines.push(getEnhancerEnabledUserWorkflow(entryPointRole, params.hasBuilder));
  lines.push('```');
  lines.push('');
  lines.push(
    `The enhancer pass is **one-time per originating user message**: \`${getEnhancerRequestFirstWorkflow(entryPointRole)}\`. Implementation, delegation, and rework happen afterward without another enhancer pass.`
  );
  lines.push('');
  lines.push('**How it works:**');
  lines.push(
    "1. Read the user message (and pinned chatroom context if helpful), then fill only `<additional-context>` in the Handoff to `enhancer` template — the system injects `<user-message>` automatically; do not copy the user's message."
  );
  lines.push(
    '2. Transfer the goal in `<additional-context>` — not the chatroom Context feature; no implementation draft, builder brief, or researched solution.'
  );
  lines.push(
    '3. The memoryless enhancer uses the origin user message ID to download authoritative chatroom history, investigates the repository, and returns independent design input asynchronously.'
  );
  lines.push(
    `4. When that input arrives as a new ${entryPointRole} task, use it as the first planning input; then do your own research and proceed with implementation, delegation, or user delivery as the team permits.`
  );
  lines.push('');
  lines.push('**The enhancer provides design input:**');
  lines.push('- User intent, constraints, and relevant history');
  lines.push('- Repository evidence and existing patterns');
  lines.push('- One recommended design with frontend and data/query detail');
  lines.push('- Proof of Principles for how the design satisfies quality constraints');
  lines.push('- Open questions and a recommended implementation sequence');
  lines.push(
    `- The ${entryPointRole} agent verifies and delegates — input is consultative, not authoritative`
  );
  lines.push('');
  lines.push('**After handoff to enhancer returns success:**');
  lines.push(
    '- **End your turn immediately** (CLI: run get-next-task) — do not wait for input, poll, monitor the enhancer, or re-submit.'
  );
  lines.push(
    `- **Enhancer → ${entryPointRole} delivery is your resume trigger** — design input arrives as a new ${entryPointRole} task.`
  );
  lines.push(
    '- **Do not hand off to enhancer again for this user message** — the enhancer pass is intentionally one-time.'
  );
  lines.push(
    '- **Do not hand off elsewhere** while enhancer analysis is in progress — wait for its input first (the server rejects early handoffs).'
  );
  lines.push('');
  lines.push('</handoff-enhancer>');
}

/** Guidance when the team entry point receives request-first design input. */
export function appendTaskDeliveryEnhancerInputGuidance(
  lines: string[],
  ctx: { chatroomId: string; role: string; cliEnvPrefix: string }
): void {
  const contextReadCmd = contextReadCommand(ctx);
  lines.push('');
  lines.push('<enhancer-input>');
  lines.push('## Enhancer Design Input');
  lines.push('');
  lines.push(
    "This task contains the enhancer's independent design for the user's request. It arrives before entry-point research or drafting by design."
  );
  lines.push('');
  lines.push('**Your job:**');
  lines.push(
    '- Treat this as your first planning input, not as a review of an entry-point-authored draft.'
  );
  lines.push(
    `- **Do not run context new** — continue the user task context (run \`${contextReadCmd}\` only if needed).`
  );
  lines.push(
    '- Validate the enhancer design, then do the research, refinement, and implementation work that remains yours.'
  );
  lines.push('- Verify the **recommended design** against repository evidence and user intent.');
  lines.push('- Validate frontend and data design sections against concrete files and patterns.');
  lines.push(
    '- For large or multi-surface revisions, activate the defragmentation skill before delegating implementation slices.'
  );
  lines.push('- If gaps remain, do more research before proceeding.');
  lines.push(
    '- When ready: implement, delegate, or hand off to `user` using the workflow and templates available to your team.'
  );
  lines.push(
    '- Treat the input as **advisory** — you verify and delegate; do not blindly follow suggestions.'
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
    '**Do not hand off to `enhancer` for this task.** Enhancer is not enabled for this chatroom or this task snapshot. Continue with the implementation, delegation, or delivery path in `<next-steps>`.'
  );
  lines.push('</handoff-enhancer-disabled>');
}

export function appendPlanningReviewOutcomeGuidance(lines: string[]): void {
  lines.push('');
  lines.push('<planning-review-outcome-intake>');
  lines.push('## Enhancer analysis did not complete');
  lines.push('');
  lines.push(
    'The enhancer was cancelled or failed before it could return design input for the user request.'
  );
  lines.push('');
  lines.push('**Your job:**');
  lines.push('- Proceed with entry-point-owned research and planning without enhancer input.');
  lines.push('- **Do not retry the enhancer** for this user message.');
  lines.push('- Implement, delegate, or hand off to `user` as appropriate for your team.');
  lines.push('');
  lines.push('</planning-review-outcome-intake>');
}
