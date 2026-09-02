/** Shared persistence/query design guidance for enhancer output and the data-design skill. */
export function getDataQueryDesignTemplateBlock(): string {
  return `## Persistent state and query pattern design

**Goal:** Small updates must not cause large cache invalidations. High-frequency writes use projections to smaller tables.

### 1. Sources of concern
| Source | Write frequency | Read pattern | Risk |
|--------|---------------|--------------|------|
| \`<table/mutation>\` | \`<frequency>\` | \`<pattern>\` | \`<scan / hot partition>\` |

### 2. Schema design
**Hot path:** \`<table>\` — fields, projection from \`<source>\`
**Cold path:** \`<table>\` — …

\`\`\`typescript
// target schema shape
\`\`\`

### 3. Index design (within limits)
| Table | Index | Serves query | Budget |
|-------|-------|--------------|--------|

### 4. Query design (within limits)
| Query | Index | Rows scanned | Timeout | Invalidation scope |
|-------|-------|--------------|---------|-------------------|

\`\`\`typescript
// target query signature
\`\`\`

<!-- Write exactly "Not Applicable." for the entire section if no persistence changes -->`;
}
