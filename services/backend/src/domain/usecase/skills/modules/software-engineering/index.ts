import type { SkillModule } from '../../registry';

export const softwareEngineeringSkill: SkillModule = {
  skillId: 'software-engineering',
  name: 'Software Engineering Reference',
  description:
    'Universal software engineering standards: build from the application core outward, SOLID principles, and naming conventions.',
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getPrompt: (_cliEnvPrefix: string) => `You have been activated with the "software-engineering" skill.

## Build Order

Start from the core and work outward. The core must never depend on external systems (frameworks, databases, APIs).

\`\`\`mermaid
flowchart TD
  A([New Feature]) --> B["Application Core\\nentities · domain logic · pure functions · no external deps"]
  B --> C["Use Cases\\nbusiness logic · orchestration · defines ports and interfaces"]
  C --> D["Adapters\\npersistence · APIs · UI · external services · implements ports"]
  D --> E["Cleanup\\nremove dead code · de-duplicate · enforce boundaries"]
\`\`\`

Each phase: shippable code, one concern, clear acceptance criteria.
Always end with a cleanup phase.

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
