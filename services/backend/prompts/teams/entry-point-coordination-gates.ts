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

  return `- **Product manager before scoping a new ambiguous feature:** when the user asks for a new feature whose scope is ambiguous or undecided, whose in-scope boundary the user has not set, or whose feature completeness depends on existing behavior you cannot settle from the code you have read, hand off to \`product-manager\` for a product specification before ${beforeStep}. Only the entry point (\`${entryPointRole}\`) activates it. Skip it for small bug fixes, for unambiguous requests with an agreed scope, and for pure asset or UI requests that have their own gates; a bug fix activates it only when the fix itself needs a scope decision, and the handoff must say so. When the specification returns, check its \`## In scope\`, \`## Out of scope\`, and \`## Consistency with existing functionality\` sections before you delegate, put any open question that blocks planning to \`user\` before you delegate, and use the accepted specification as the scope of the work you delegate next. The \`product-manager\` handoff template defines the request.`;
}

export function getEntryPointCoordinationGates(options: {
  entryPointRole: string;
  implementationRole: string;
}): string {
  const { entryPointRole, implementationRole } = options;

  return `${getProductManagerGate({
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
