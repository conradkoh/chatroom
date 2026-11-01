/**
 * Custom-agent loader public surface.
 *
 * Only the source loader is exported: the parser and the bounded reader are
 * internal building blocks, so callers cannot bypass the loader's containment,
 * cap, and determinism rules.
 */

export { loadCustomAgentSource } from './load-custom-agent-source.js';
export type {
  LoadCustomAgentSourceInput,
  LoadedCustomAgentSource,
} from './load-custom-agent-source.js';
