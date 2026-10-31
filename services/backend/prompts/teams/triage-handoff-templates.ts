import { handoffCommand } from '../cli/handoff/command';
import type { HandoffTemplateQuery } from '../cli/handoff-templates/contracts';

/** Body for a planner or solo agent delegating a bug investigation to triage. */
export function getEntryPointToTriageHandoffTemplate(query: HandoffTemplateQuery): string {
  const entryPoint = query.fromRole;

  return `The automatically injected \`<user-message>\` is the authoritative request. Pass the reported bug, observed and expected behavior with the source of the expectation (the reporter's words, a spec, or a documented decision), reproduction details and commands, relevant constraints, and the files or symbols already suspected. State the observable success condition: what the fixed behavior looks like to the reporter, so triage can build a loop that goes red on this bug and green once it is fixed. Ask triage to investigate and report only. Triage may inspect code and attempt a focused automated regression test as evidence, but must not edit implementation files or implement a fix.

Use this for every reported bug (something broken or behaving differently than expected) before any fix is implemented.

After completing the investigation, triage must return the evidence-backed report to \`${entryPoint}\` with the normal handoff command.

\`\`\`bash
${handoffCommand({
  chatroomId: '<chatroom-id>',
  role: entryPoint,
  nextRole: 'triage',
  cliEnvPrefix: '',
})}
\`\`\``;
}

/** Body for triage returning its investigation report to the entry role. */
export function getTriageToEntryPointHandoffTemplate(query: HandoffTemplateQuery): string {
  const entryPoint = query.toRole;

  return `Instructions (not part of the message): Return a complete, evidence-backed investigation of the authoritative reported bug. Triage is advisory: do not edit implementation files or implement the proposed fix. Begin with the \`## Summary\` section, then use the remaining sections below in order. Use \`###\` for sub-items within a section. Cite concrete repository paths and symbols, observed behavior, commands, and test output. Distinguish confirmed findings from hypotheses; never claim a test proved behavior unless its failing assertion demonstrates the report. Redact every secret in quoted output as \`<REDACTED>\`, and quote only the lines that carry the signal.

## Summary
<briefly state the diagnosis and whether the root cause was confirmed or remains a hypothesis>

## Reported behavior
<state the reported symptoms and expected behavior, including reproduction details and constraints recovered from the request or relevant history>

## Root cause
<first list 3 to 5 ranked hypotheses, each as "If <X> is the cause, then <changing Y> removes the symptom (or <changing Z> makes it worse)", before testing any of them; then state the confirmed or hypothesized cause, tracing ownership, data, and control flow with concrete repository paths and symbols; for each hypothesis, say whether it was tested and the outcome; check memory/ decision-log entries and docs/ for whether the behavior is documented as intended before calling it a defect; label the finding confirmed or hypothesis>

## Reproduction attempt
<give the one command that drives the user's exact symptom, its observed output (redacted), and how many times it ran; state whether it is deterministic, or the reproduction rate for flaky behavior; give the minimal scenario, listing each input, caller, or configuration removed and whether the symptom stayed; for slow or regressed performance, the baseline measurement taken before any change; if no reproducing command could be built, say so, list what was tried, and name exactly what is needed to proceed (environment access, a redacted captured artifact, or permission to add temporary instrumentation); never fabricate proof>

## Proposed immediate fix
<recommend the smallest appropriate change, naming the likely files and the specific change; do not implement it; then name the regression-test seam: the public interface where a failing regression test belongs, with one line on what it catches and what it misses; if only a shallow seam exists (the bug needs several callers or a longer chain of calls to trigger), say so and add it under Systemic issues>

## Systemic issues
<list each separate systemic concern with repository evidence, impact, and follow-up concern, or write exactly: None observed.>

## Work completed
<state the code paths inspected and every test or reproduction action taken, including results>

Instructions after the body (not part of the message): run the normal handoff command to \`${entryPoint}\` with the complete body above, then stop.

\`\`\`bash
${handoffCommand({
  chatroomId: '<chatroom-id>',
  role: 'triage',
  nextRole: entryPoint,
  cliEnvPrefix: '',
})}
\`\`\``;
}
