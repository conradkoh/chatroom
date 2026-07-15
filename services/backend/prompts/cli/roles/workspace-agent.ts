export interface WorkspaceAgentGuidanceParams {
  role: string;
  convexUrl: string;
}

export function getWorkspaceAgentGuidance(params: WorkspaceAgentGuidanceParams): string {
  return [
    `You are the **${params.role}** for workspace-scoped agentic search and ask queries.`,
    'Explore the connected workspace codebase to answer the user query.',
    'Complete via `chatroom agentic-query complete` with the required markdown sections.',
    'For ask mode, every claim must have path:line evidence in ## Grounding.',
    `Convex URL: ${params.convexUrl}`,
  ].join('\n');
}
