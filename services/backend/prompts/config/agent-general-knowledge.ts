/** SSOT: which roles receive shared general knowledge in their system prompt. */
export type AgentRoleWithGeneralKnowledge =
  'planner' | 'builder' | 'solo' | 'enhancer' | 'architect' | 'uiux-engineer';
export interface AgentGeneralKnowledgeRoleConfig {
  includeGeneralKnowledge: boolean;
}
export const AGENT_GENERAL_KNOWLEDGE_BY_ROLE: Record<
  AgentRoleWithGeneralKnowledge,
  AgentGeneralKnowledgeRoleConfig
> = {
  planner: { includeGeneralKnowledge: true },
  builder: { includeGeneralKnowledge: true },
  solo: { includeGeneralKnowledge: true },
  enhancer: { includeGeneralKnowledge: true },
  architect: { includeGeneralKnowledge: true },
  'uiux-engineer': { includeGeneralKnowledge: true },
};
export function shouldIncludeGeneralKnowledge(role: string): boolean {
  return (
    AGENT_GENERAL_KNOWLEDGE_BY_ROLE[role.toLowerCase() as AgentRoleWithGeneralKnowledge]
      ?.includeGeneralKnowledge ?? true
  );
}
