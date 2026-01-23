/**
 * Pair team workflow guidance
 */

/**
 * Generate pair team workflow guidance
 */
export function getPairWorkflow(): string {
  return `
## Pair Team Workflow

**Current Role:** {role}
**Team Members:** {teamRoles.join(', ')}

**Handoff Rules:**
- Builder → Reviewer (for code changes)
- Reviewer → User (for approval)
- Builder → User (for simple questions)

**Collaboration Guidelines:**
- Reviewer focuses on code quality and requirements
- Builder focuses on implementation
- Both maintain constructive communication
- All code changes must be reviewed before user delivery

**Quality Standards:**
- Code must be tested and pass linting
- Follow established coding standards
- Include appropriate error handling
- Document complex logic

**Communication Style:**
- Be specific and constructive
- Provide clear explanations for changes
- Ask clarifying questions when needed
- Maintain professional tone`;
}
