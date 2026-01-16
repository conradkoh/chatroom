# Plan 001: Dark/Light Mode Theme Fix - Architecture

## Changes Overview

This plan modifies the CSS variable system and individual component styling to support proper theme switching. The changes are primarily in the presentation layer (CSS and React components) with no changes to domain logic or data structures.

## Modified Components

### 1. Global CSS Variables (`apps/webapp/src/app/globals.css`)

**Current State:**
The `.chatroom-root` class defines hardcoded dark theme colors with no light mode variants.

**Modification:**
Add a light mode variant that activates when the `dark` class is NOT present on the document root.

```css
/* Dark mode (default for .chatroom-root) */
.dark .chatroom-root {
  --chatroom-bg-primary: #09090b;           /* zinc-950 */
  --chatroom-bg-secondary: rgba(24, 24, 27, 0.5);
  --chatroom-bg-tertiary: #18181b;          /* zinc-900 */
  --chatroom-bg-hover: #27272a;             /* zinc-800 */
  --chatroom-bg-surface: rgba(24, 24, 27, 0.6);
  --chatroom-border: rgba(250, 250, 250, 0.1);
  --chatroom-border-strong: rgba(250, 250, 250, 0.15);
  --chatroom-text-primary: #fafafa;         /* zinc-100 */
  --chatroom-text-secondary: #a1a1aa;       /* zinc-400 */
  --chatroom-text-muted: #71717a;           /* zinc-500 */
  --chatroom-status-success: #34d399;       /* emerald-400 */
  --chatroom-status-warning: #fbbf24;       /* amber-400 */
  --chatroom-status-error: #f87171;         /* red-400 */
  --chatroom-status-info: #60a5fa;          /* blue-400 */
  --chatroom-status-purple: #c084fc;        /* purple-400 */
  --chatroom-accent: #fafafa;               /* zinc-100 */
  --chatroom-accent-subtle: #27272a;        /* zinc-800 */
}

/* Light mode - Neutral Glass theme */
:root:not(.dark) .chatroom-root {
  --chatroom-bg-primary: #f5f5f5;           /* neutral-100 */
  --chatroom-bg-secondary: rgba(255, 255, 255, 0.6);
  --chatroom-bg-tertiary: #ffffff;          /* white */
  --chatroom-bg-hover: #e5e5e5;             /* neutral-200 */
  --chatroom-bg-surface: rgba(255, 255, 255, 0.6);
  --chatroom-border: rgba(23, 23, 23, 0.1);
  --chatroom-border-strong: rgba(23, 23, 23, 0.15);
  --chatroom-text-primary: #171717;         /* neutral-900 */
  --chatroom-text-secondary: #525252;       /* neutral-600 */
  --chatroom-text-muted: #737373;           /* neutral-500 */
  --chatroom-status-success: #15803d;       /* green-700 */
  --chatroom-status-warning: #b45309;       /* amber-700 */
  --chatroom-status-error: #b91c1c;         /* red-700 */
  --chatroom-status-info: #1d4ed8;          /* blue-700 */
  --chatroom-status-purple: #7c3aed;        /* purple-600 */
  --chatroom-accent: #171717;               /* neutral-900 */
  --chatroom-accent-subtle: #f5f5f5;        /* neutral-100 */
}
```

### 2. Navigation Component (`apps/webapp/src/components/Navigation.tsx`)

**Current State:**
Uses hardcoded `zinc-950` background and `zinc-100` text colors.

**Modification:**
Replace with semantic tokens or theme-aware classes:

| Current | Replacement |
|---------|-------------|
| `bg-zinc-950/95` | `bg-background border-b border-border` or theme-aware variant |
| `text-zinc-100` | `text-foreground` |
| `text-zinc-300` | `text-muted-foreground` |

### 3. ChatroomDashboard Header (`apps/webapp/src/modules/chatroom/ChatroomDashboard.tsx`)

**Current State:**
Header portal content (lines 339-451) uses hardcoded zinc colors for buttons, inputs, and badges.

**Modification:**
Replace hardcoded colors with chatroom CSS variables:

| Current | Replacement |
|---------|-------------|
| `border-zinc-700` | `border-chatroom-border` |
| `text-zinc-400` | `text-chatroom-text-secondary` |
| `bg-zinc-800` | `bg-chatroom-bg-tertiary` |
| `text-zinc-100` | `text-chatroom-text-primary` |
| `hover:bg-zinc-800` | `hover:bg-chatroom-bg-hover` |

### 4. MessageFeed Prose Styling (`apps/webapp/src/modules/chatroom/components/MessageFeed.tsx`)

**Current State:**
Uses `prose prose-invert` unconditionally, forcing dark prose styling.

**Modification:**
Make prose styling theme-aware:
- Change `prose prose-invert` to `prose dark:prose-invert`
- Update prose-specific color overrides to use CSS variables

### 5. PromptModal Prose Styling (`apps/webapp/src/modules/chatroom/components/PromptModal.tsx`)

**Current State:**
Same issue as MessageFeed - uses `prose prose-invert` unconditionally.

**Modification:**
Apply same fix as MessageFeed - make prose styling theme-aware.

### 6. Optional: Callback Cards (`apps/webapp/src/components/CallbackSuccessCard.tsx`, `CallbackErrorCard.tsx`)

**Current State:**
Uses hardcoded green/red background colors.

**Modification (Low Priority):**
Consider using theme-aware semantic tokens for backgrounds while keeping status colors for icons/text per design guidelines.

## New Components

None - this plan modifies existing components only.

## New Contracts

None - this plan affects presentation layer styling only.

## Modified Contracts

None - no data structures or interfaces are changed.

## Data Flow Changes

None - theme information flows through the existing ThemeProvider context.

## Integration Changes

None - no external integrations are affected.

## Technical Considerations

### CSS Specificity

The light mode selector `:root:not(.dark) .chatroom-root` must have equal or higher specificity than the dark mode selector `.dark .chatroom-root` to ensure proper cascade.

### Theme Transition

The existing CSS transitions for theme changes (defined in globals.css) will automatically apply to chatroom components once they use CSS variables.

### Testing Strategy

1. **Visual Testing**: Manually verify each component in both light and dark modes
2. **Contrast Testing**: Use browser dev tools or accessibility tools to verify WCAG AA contrast ratios
3. **Transition Testing**: Verify smooth color transitions when toggling themes
