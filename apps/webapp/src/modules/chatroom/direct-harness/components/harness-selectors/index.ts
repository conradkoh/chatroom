/**
 * harness-selectors — colocated module for all harness selector bar components.
 *
 * Public API:
 * - HarnessSelectorBar  — the composed row (default import surface)
 * - parseModelKey / buildModelKey — model key utilities
 * - AgentOption / ProviderOption — shared types
 */

export { HarnessSelectorBar } from './HarnessSelectorBar';
export type { HarnessSelectorBarProps } from './HarnessSelectorBar';
export { parseModelKey, buildModelKey } from './modelKey';
export type { AgentOption, ProviderOption } from './types';
