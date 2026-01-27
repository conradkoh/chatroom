/**
 * Design Policy Guidelines for Code Review
 *
 * Generic design and UI/UX guidelines that should be adapted to
 * the specific codebase's design system and conventions.
 */

/**
 * Design review guidelines
 */
export const DESIGN_POLICY = `
## Design Review Policy

These are general design principles. Adapt to your codebase's specific design system.

### Design System Compliance

- [ ] Uses existing design tokens (colors, spacing, typography)
- [ ] Follows established component patterns
- [ ] Reuses existing components instead of creating duplicates
- [ ] Styling uses semantic values, not hardcoded ones

### Color Usage

**Semantic colors should be preferred:**
- Use \`text-foreground\` not \`text-black\`
- Use \`bg-card\` not \`bg-white\`
- Use \`border-border\` not \`border-gray-200\`

**Dark mode support:**
- All UI should work in both light and dark mode
- Brand/status colors need dark variants (e.g., \`bg-red-50 dark:bg-red-950/20\`)

### Component Patterns

- [ ] Components follow existing file structure conventions
- [ ] Props are typed properly
- [ ] Components are accessible (keyboard navigation, ARIA)
- [ ] Responsive design is considered

### Typography

- [ ] Uses established font sizes from the design system
- [ ] Heading hierarchy is semantic (h1, h2, etc.)
- [ ] Text is readable at all sizes
- [ ] Font weights follow conventions

### Spacing & Layout

- [ ] Uses design system spacing tokens
- [ ] Layout is responsive
- [ ] Alignment is consistent
- [ ] Proper use of flexbox/grid patterns

### UX Considerations

- [ ] Loading states are handled
- [ ] Error states have clear messaging
- [ ] Empty states are designed
- [ ] Interactive elements have hover/focus states

### Common Design Issues to Catch

1. **Inconsistent Styling**
   - Different button styles for similar actions
   - Inconsistent spacing between elements
   - Mixed font sizes within components

2. **Accessibility Gaps**
   - Missing keyboard navigation
   - Low color contrast
   - Missing ARIA labels
   - Focus states not visible

3. **Hardcoded Values**
   - Magic numbers for spacing (use tokens)
   - Hardcoded colors (use semantic colors)
   - Fixed widths that break responsive

4. **Component Duplication**
   - Recreating existing components
   - Copy-paste instead of abstraction
   - Similar patterns implemented differently

### Codebase-Specific Design

Check these locations for design guidelines:
- \`docs/design/*.md\` - Design documentation
- \`components/ui/\` - Existing UI component library
- \`tailwind.config.*\` - Theme configuration
- \`globals.css\` or theme files - CSS custom properties
- \`AGENTS.md\` or \`CLAUDE.md\` - May contain UI guidelines

**Important:** These are general guidelines. Always verify against your project's specific design system.
`;

/**
 * Get the design policy content
 */
export function getDesignPolicy(): string {
  return DESIGN_POLICY;
}
