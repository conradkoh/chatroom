/**
 * Static grounding template renderer for `chatroom grounding view-template`.
 *
 * A grounding has no sender/recipient pair and no conversation mode, so this is
 * a thin wrapper over the skeleton and rules generators.
 */

import { getGroundingRules, getGroundingSkeleton } from './grounding-template';

/** `chatroom grounding view-template` output: the skeleton, a blank line, then the rules. */
export function viewGroundingTemplate(): string {
  return `${getGroundingSkeleton()}\n\n${getGroundingRules()}`;
}
