# Plan 001: Dark/Light Mode Theme Fix

## Summary

Fix the broken dark/light mode theming across the chatroom application. Currently, the chatroom module uses hardcoded dark-only CSS variables that don't respond to theme changes, and several components use hardcoded color values instead of semantic tokens.

## Goals

1. **Enable proper light mode support** - All chatroom components should adapt their colors based on the current theme setting (light/dark/system)
2. **Maintain design system consistency** - Follow the established design guidelines in `docs/design/theme.md` which defines the "Dark Steel" (dark) and "Neutral Glass" (light) theme variants
3. **Preserve the industrial design aesthetic** - Keep the brutalist, utilitarian design philosophy intact across both themes
4. **Ensure WCAG AA accessibility** - Both themes must meet contrast requirements

## Non-Goals

1. **Adding new themes** - This plan only fixes the existing light/dark mode support, not adding additional theme variants
2. **Redesigning components** - The visual design and layout of components remains unchanged
3. **Refactoring component architecture** - Focus is purely on theming, not structural changes
4. **Mobile-specific theme changes** - Mobile styling remains as-is, only color theming is addressed
