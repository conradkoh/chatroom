/**
 * Team composition configuration for prompt section builders.
 *
 * Section builders accept this explicit config so they contain no
 * runtime derivation logic — the caller (team prompt files) decides
 * the composition.
 */
export interface TeamCompositionConfig {
  hasBuilder: boolean;
  hasReviewer: boolean;
}
