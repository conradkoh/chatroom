export function selectBuiltInAgent(role: string): 'build' | 'planner' {
  const normalized = role.toLowerCase().trim();
  return normalized === 'planner' ? 'planner' : 'build';
}
