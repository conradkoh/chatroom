/**
 * Entry-point coordination gates shared by team presets.
 *
 * Covers the product-manager, research, architecture, review, asset, bug,
 * verification, and file-viewing gates the entry point clears before
 * delegating work. The implementation role is parameterized so personae that
 * delegate to a different builder role can reuse the same prose.
 */

/**
 * Product-manager activation gate. Only the entry-point role can contact other
 * roles, so only it activates the product manager; `beforeStep` names what the
 * activation must precede in that team.
 */
export function getProductManagerGate(options: {
  entryPointRole: string;
  beforeStep: string;
}): string {
  const { entryPointRole, beforeStep } = options;

  return `- **Product manager before scoping a new ambiguous feature:** when the user asks for a new feature whose scope is ambiguous or undecided, whose in-scope boundary the user has not set, or whose feature completeness depends on existing behavior you cannot settle from the code you have read, hand off to \`product-manager\` for a product specification before ${beforeStep}. Only the entry point (\`${entryPointRole}\`) activates it. Skip it for small bug fixes, for unambiguous requests with an agreed scope, and for pure asset requests that have their own gate; a bug fix activates it only when the fix itself needs a scope decision, and the handoff must say so. When the specification returns, read its \`## UI and UX review\` section and follow it (routing rule 3), check its \`## In scope\`, \`## Out of scope\`, and \`## Consistency with existing functionality\` sections before you delegate, settle any open question it raises under the decision-routing rule (only an item that meets its escalation criteria goes to \`user\`) before you delegate, and use the accepted specification as the scope of the work you delegate next. The \`product-manager\` handoff template defines the request.`;
}

/** Wording that varies between an entry point that delegates implementation and one that implements itself. */
interface RoutingWording {
  uiWorkBy: string;
  goesTo: string;
  assetRoute: string;
  citeDesign: string;
}

function getDelegatingRoutingWording(implementationRole: string): RoutingWording {
  return {
    uiWorkBy: `\`${implementationRole}\` UI work`,
    goesTo: `\`${implementationRole}\``,
    assetRoute: 'go to `game-asset-designer`, not to `product-manager` and not to `uiux-engineer`',
    citeDesign: ", and cite the design's message id when you delegate",
  };
}

/** Solo implements its own work and has no `game-asset-designer`. */
const SELF_IMPLEMENTING_ROUTING_WORDING: RoutingWording = {
  uiWorkBy: 'UI work by you',
  goesTo: 'you',
  assetRoute:
    'are never sent to `product-manager` or `uiux-engineer` (this team has no `game-asset-designer`; you handle the asset work yourself)',
  citeDesign: '',
};

/**
 * Deterministic routing rules for the entry point: which specialist (or the
 * implementation role) receives a task. Rendered for every team's entry point
 * with that team's own role names. The rules are ordered; apply the first that
 * matches.
 */
export function getEntryPointRoutingRules(options: {
  entryPointRole: string;
  /** Omit when the entry point implements its own work (solo). */
  implementationRole?: string;
}): string {
  const { entryPointRole, implementationRole } = options;
  const { uiWorkBy, goesTo, assetRoute, citeDesign } = implementationRole
    ? getDelegatingRoutingWording(implementationRole)
    : SELF_IMPLEMENTING_ROUTING_WORDING;

  return `- **Routing rules (\`${entryPointRole}\`), apply the first that matches:** \`product-manager\` answers *what* and *whether* (scope, user stories, in and out of scope, consistency with existing behavior) and never designs layout. \`uiux-engineer\` answers *how it looks and behaves* (user flows, screens, layout, component ownership, loading, empty, error and success states, keyboard and responsive behavior) and never decides scope.
  1. **Bug report:** goes to \`triage\` first. Neither \`product-manager\` nor \`uiux-engineer\` is involved unless the fix itself needs a scope or design decision.
  2. **New feature with undecided or ambiguous scope:** goes to \`product-manager\` first; its specification decides the next step.
  3. **New feature with a UI surface and agreed scope:** a UI surface is a new screen, panel, flow, interaction, or visible state. It goes to \`uiux-engineer\` for a design before any ${uiWorkBy}. Do not start UI implementation of a new UI feature without that design${citeDesign}.
  4. **Non-game icons, illustrations, and asset files:** ${assetRoute}.
  5. **Backend contract, API, or schema change:** goes to \`architect\` first.
  6. **Existing UI with no new surface and no design decision:** goes straight to ${goesTo}, with no \`uiux-engineer\`.`;
}

/**
 * Decision-routing rule for the entry point: open product decisions go to
 * `product-manager`, open technical decisions go to `architect`, and `user`
 * is reached only for an ambiguous or insufficient request or destructive
 * risk. Rendered for every team's entry point; the fallback covers teams that
 * do not advertise the optional specialists.
 */
export function getDecisionRoutingRule(options: { entryPointRole: string }): string {
  const { entryPointRole } = options;

  return `- **Decision routing (\`${entryPointRole}\`):** never hand \`user\` a list of decisions. Open **product** decisions (scope, user stories, in and out of scope, consistency with existing behavior, product defaults) go to \`product-manager\`. Open **technical** decisions (approach, design, contracts, schema, libraries, trade-offs) go to \`architect\`. Reach \`user\` only under these escalation criteria: (a) **ambiguous or insufficient request:** the request is clearly ambiguous or insufficient, and no specialist can settle the question from the request, the code, \`memory/\`, or \`docs/\`; (b) **destructive risk:** the decision involves deletion, data loss, an irreversible migration, an externally visible or production-affecting action, or spending money. Everything else is decided by the owning specialist. If a specialist's report leaves a decision open that falls within its remit, send that one question back to the same specialist once, then proceed on its recommendation. If your team composition does not list \`product-manager\` or \`architect\`, make that decision yourself, record the rationale in your handoff, and escalate to \`user\` only under (a) or (b).`;
}

export function getEntryPointCoordinationGates(options: {
  entryPointRole: string;
  implementationRole: string;
}): string {
  const { entryPointRole, implementationRole } = options;

  return `${getEntryPointRoutingRules({ entryPointRole, implementationRole })}
${getDecisionRoutingRule({ entryPointRole })}
${getProductManagerGate({
  entryPointRole,
  beforeStep: `any researcher, architect, or \`${implementationRole}\` delegation`,
})}
- **Ground new work first:** when a request introduces something not yet grounded in this repository, get a researcher brief before delegating. The \`researcher\` handoff template defines when research is needed and how to request it.
- **Architect before backend design changes:** when a backend change involves contracts, APIs, or schema/persistence, hand off to \`architect\` first (after any researcher brief the request needs). Delegate to \`${implementationRole}\` only after the architect's design returns to you. The \`architect\` handoff template defines the request.
- **Review before delivery:** for code-producing work, hand off to \`reviewer\` with the review target (commit range, branch, PR, or file list) and focus; the \`reviewer\` handoff template defines when to review and when to skip. Review findings are advisory: triage them, send blocking issues back to \`${implementationRole}\` as rework, and deliver to \`user\` only after blockers are resolved or explicitly accepted.
- **All asset generation via designer:** when the request creates or changes any asset file (game art or audio, models, textures, sprites, sound, and non-game UI icons or illustrations), or the code that loads them, hand off to \`game-asset-designer\`. The designer generates the asset files itself: 2D assets with \`chatroom generate-image --platform=fal\`, and 3D models (mesh, texture, rig, and animation clips) with \`chatroom generate-3d --platform=fal\`. It edits only the asset-integration paths you name (for example manifests, import settings, loader registration). Do not assign asset generation or those asset-integration edits to \`builder\` or \`uiux-engineer\`; the builder owns application logic outside those paths, and the \`uiux-engineer\` owns UI layout, components, and styling only. The brief must name: target engine, budgets, style reference, \`## Lighting contract\` (lighting cannot be optional), deliverable mode, output location, allowed tools, allowed edit paths, and commit policy; for a 3D model it must also name the model id (default \`fal-ai/trellis-2\`, where a prompt generates a bundled reference image first; any fal id is accepted, and an unknown id has no price), plus the output paths: \`--out\` sets both the folder and the package base (\`<out-stem>-<timestamp>\`), and \`--package-dir <dir>\` (default: the master's directory) moves the zip and preview. Bones or animation use \`meshy/v7.1\` only; obtain the user's approval of the priced dry run, then quote it in the brief's \`## Cost confirmation\`, and note that every bundle includes web versions. The \`game-asset-designer\` prompt describes the package files. Treat the designer's checklist results as evidence-labelled claims: send any \`fail\` item back to the designer as rework, and accept any \`not checked\` item only when the user has explicitly accepted it. Do not author prompts, material treatment, style or lighting art direction: state the goal and the target rig's facts and let the designer propose the palette and lighting anchor. Lighting gate: a 3D asset's lighting \`pass\` needs an **asset-in-rig render**: "a render of the generated asset loaded in the project's real scene after generation, attached by path under \`## Lighting verification\`. Only this render supports \`pass\`." The **rig reference render** is "the existing render of the target rig, attached by path under \`## Lighting contract\`, used as a style target before generation. It is input only and cannot support \`pass\`." On \`not checked\`, hand off to \`${implementationRole}\` for the asset-in-rig render; allow the builder a temporary scene load used only for the render. The load is never committed, and the builder reverts it after rendering. Then send the designer a verification-only brief naming the existing asset paths and the asset-in-rig render, not a \`spec and generate\` brief; or record the user's explicit acceptance yourself in the handoff to \`user\`. The \`game-asset-designer\` handoff template defines the request.
- **Bug reports go to triage first:** when the user reports a bug (something broken or behaving differently than expected), always hand off to \`triage\` to investigate before any ${implementationRole} delegation. Never delegate a bug fix straight to the ${implementationRole}. The \`triage\` handoff template defines what to send.
- **Verify before delivering:** when task delivery includes a \`<verifier-gate>\` block, follow it after any review and before handing off to \`user\`. The \`verifier\` handoff template defines the request.
- **Show the user an existing file:** to show the user a file that already exists (for example an image), attach it with \`--attach-file=<path>\` on the handoff to \`user\`. Viewing a file does not go through \`game-asset-designer\`. Do not say a file is attached unless your handoff to \`user\` sent it with \`--attach-file\`; if you cannot attach it, say so. When the request does not say how the user wants to view a file (inline, as an attachment, or as a path), ask before choosing.`;
}
