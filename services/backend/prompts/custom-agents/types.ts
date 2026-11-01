// fallow-ignore-file unused-file unused-type
/**
 * Custom-agent prompt context.
 *
 * Everything prompt composition needs to render a user-authored role, already
 * resolved: which role is being rendered (if any), its instructions, and the
 * delegates the entry point can hand work to.
 *
 * A `null` template means "no authored template row was stored", so the
 * renderer substitutes a generated default. `undefined` context means "this is
 * a builtin role with no custom agent behind it", which is what keeps builtin
 * prompts byte-identical.
 *
 * Temporary: S4a ships these building blocks ahead of the prompt wiring, so the
 * dead-code suppression above is needed until S4b consumes them.
 */

export interface CustomRoleInstructions {
  name: string;
  description: string;
  systemPrompt: string;
  /** `null` means use `defaultReturnHandoffTemplate`. */
  returnHandoffTemplate: string | null;
}

export interface CustomDelegate {
  name: string;
  description: string;
  /** `null` means use `defaultInboundHandoffTemplate`. */
  inboundHandoffTemplate: string | null;
}

export interface CustomAgentPromptContext {
  entryPoint: string;
  /** Present when the role being rendered is a custom role. */
  self?: CustomRoleInstructions;
  /** Present on the entry point; empty otherwise. */
  delegates: CustomDelegate[];
}
