import type { SkillModule } from '../../registry';

export const softwareEngineeringSkill: SkillModule = {
  skillId: 'software-engineering',
  name: 'Software Engineering Reference',
  description: 'Implementation order, SOLID principles, and engineering standards.',
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getPrompt: (_cliEnvPrefix: string) => `You have been activated with the "software-engineering" skill.

## Implementation Order

\`\`\`mermaid
flowchart TD
  A([New Feature]) --> B["Domain Model\\ntypes · entities · invariants"]
  B --> C["Use Case Layer\\nbusiness logic · dependency inversion · pure · testable"]
  C --> D["Persistence Layer\\nschema · storage · migrations"]
  D --> E["Remaining\\nUI · integrations · cleanup · tests"]
\`\`\`

Each phase: shippable code, no scaffolding, one concern, clear acceptance criteria.
Always end with a cleanup phase: remove dead code, de-duplicate.

---

## SOLID Principles

- **S**ingle Responsibility — each module has one reason to change
- **O**pen/Closed — open for extension, closed for modification
- **L**iskov Substitution — subtypes must be substitutable for their base types
- **I**nterface Segregation — prefer many small, focused interfaces over one large one
- **D**ependency Inversion — depend on abstractions, not concretions

---

## Naming Conventions

Mutations: \`create\`, \`write\`, \`update\`
Queries: \`get\`, \`list\`, \`fetch\`
No mutations in "get" methods.`,
};
