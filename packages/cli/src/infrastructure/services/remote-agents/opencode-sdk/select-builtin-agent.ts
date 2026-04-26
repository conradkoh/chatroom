export function selectBuiltInAgent(role: string): 'build' | 'plan' {
  const normalized = role.toLowerCase().trim();
  return normalized === 'planner' ? 'plan' : 'build';
}
