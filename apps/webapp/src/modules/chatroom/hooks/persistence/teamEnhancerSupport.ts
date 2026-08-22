import { teamSupportsEnhancer as supportsEnhancer } from '@workspace/shared/domain/enhancer-team-capability';

export function teamSupportsEnhancer(
  teamId: string | null | undefined,
  teamRoles: readonly string[]
): boolean {
  return supportsEnhancer({ teamId, teamRoles });
}
