export function isFocusModeActive(
  listingSidebarVisible: boolean,
  agentsSidebarVisible: boolean
): boolean {
  return !listingSidebarVisible && !agentsSidebarVisible;
}
