# Industrial Design System Technical Specification

## Overview

This design system combines modern, sleek aesthetics with utilitarian industrial principles and subtle brutalist influences. The system prioritizes information density, functional clarity, and restrained use of color while maintaining visual interest through typography and structure.

## Design Philosophy

### Core Principles

1. **Utilitarian First** - Every element serves a functional purpose
2. **Information Dense** - Maximize data visibility without sacrificing readability
3. **Color as Signal** - Color indicates status and meaning, never decoration
4. **Brutalist Structure** - Bold typography and geometric elements create hierarchy
5. **Modern Refinement** - Contemporary aesthetics with professional polish

### Visual Language

- Bold, geometric typography with wide tracking
- Sharp, unrounded corners and edges
- Thick borders (2px) for strong visual separation
- Monospaced fonts for technical data
- Uppercase text for labels and headers
- Square indicators and blocks over circles

## Color System

### Philosophy

Color is used sparingly and purposefully. Large visual elements (backgrounds, bars, cards) remain neutral. Color appears only on small elements like indicators, status text, and metrics.

### Semantic Color Usage

**Success/Healthy State**

- Green (emerald-400 / green-400 / green-700)
- Indicates: operational status, positive metrics, healthy systems

**Warning/Attention**

- Amber/Yellow (amber-400 / yellow-400 / amber-700)
- Indicates: degraded performance, high resource usage, non-critical issues

**Error/Critical**

- Red (red-400 / rose-400 / red-700)
- Indicates: failures, critical alerts, system errors

**Informational**

- Blue (blue-400 / cyan-400 / blue-700)
- Indicates: neutral status, informational messages

### Color Application Rules

**DO:**

- Apply color to small text labels (10-12px)
- Use color on status indicators (dots, badges)
- Color numeric metrics when indicating state
- Apply color to small icons

**DON'T:**

- Color large backgrounds or surfaces
- Use colored borders on cards/panels
- Apply color to progress bars (keep neutral)
- Color large text blocks

## Typography

### Font Hierarchy

**Primary Font Stack**

- System sans-serif (default Tailwind stack)
- Clean, modern, highly legible

**Monospace Font**

- Used for: IDs, metrics, timestamps, technical data
- Enables proper alignment with `tabular-nums` class

### Type Scale

```
Headers (Section):     text-sm (14px) - font-bold uppercase tracking-wider
Headers (Main):        text-2xl (24px) - font-bold uppercase tracking-tight
Body Text:            text-xs (12px) - font-medium/font-bold
Labels:               text-[10px] (10px) - font-bold uppercase tracking-wider
Micro Text:           text-[9px] (9px) - font-mono font-bold
Metrics (Large):      text-lg (18px) - font-bold tracking-tight tabular-nums
```

### Typography Rules

- All section headers: UPPERCASE with wide tracking (tracking-wider)
- All labels: UPPERCASE with bold weight
- Numeric data: Always use `tabular-nums` for alignment
- Process/item names: UPPERCASE with wide tracking for industrial feel
- Use font-bold liberally for hierarchy

## Theme Variants

### Dark Steel (Primary Recommendation)

A sophisticated dark theme that balances professionalism with industrial character.

**Colors:**

```css
Background:        #09090b (zinc-950)
Surface:           rgba(24, 24, 27, 0.5) (zinc-900/50) + backdrop-blur
Text Primary:      #fafafa (zinc-100)
Text Muted:        #71717a (zinc-500)
Accent:            #fafafa (zinc-100) on #09090b (zinc-950)
Accent Subtle:     #27272a (zinc-800) on #fafafa (zinc-100)

Status Colors:
Success:           #34d399 (emerald-400)
Warning:           #fbbf24 (amber-400)
Error:             #f87171 (red-400)
Info:              #60a5fa (blue-400)
```

**Use Cases:**

- Primary dashboard interface
- Data-heavy applications
- 24/7 monitoring systems
- Professional tools requiring extended viewing

**Characteristics:**

- Excellent for low-light environments
- High contrast for readability
- Reduces eye strain during extended use
- Premium, modern aesthetic

### Neutral Glass (Secondary Recommendation)

A light theme with subtle glassmorphism effects, ideal for daytime use.

**Colors:**

```css
Background:        #f5f5f5 (neutral-100)
Surface:           rgba(255, 255, 255, 0.6) (white/60) + backdrop-blur
Text Primary:      #171717 (neutral-900)
Text Muted:        #737373 (neutral-500)
Accent:            #171717 (neutral-900) on #fafafa (neutral-50)
Accent Subtle:     #f5f5f5 (neutral-100) on #171717 (neutral-900)

Status Colors:
Success:           #15803d (green-700)
Warning:           #b45309 (amber-700)
Error:             #b91c1c (red-700)
Info:              #1d4ed8 (blue-700)
```

**Use Cases:**

- Daytime office environments
- Client-facing dashboards
- Presentations and demos
- Well-lit workspaces

**Characteristics:**

- Clean, professional appearance
- Excellent readability in bright environments
- Softer, less intense than pure white
- Subtle depth through glassmorphism

## Layout & Spacing

### Grid System

**Primary Grid:**

- 12-column grid for main layout
- 8-column grid for metric cards
- 4-column breakpoint for dense data display

**Spacing Scale:**

```
Gap between cards:     0.75rem (gap-3)
Card padding:          1rem (p-4)
Section margin:        0.75rem (mb-3)
Tight spacing:         0.5rem (gap-2)
```

### Component Spacing

**Metrics Cards:**

- Padding: 0.75rem (p-3)
- Grid gap: 0.5rem (gap-2)
- Internal spacing: 0.375rem (gap-1.5)

**Data Tables/Lists:**

- Row padding: 0.5rem vertical (py-2)
- Column gap: 0.75-1rem (gap-3/gap-4)
- Border: 2px bottom (border-b-2)

## Components

### Status Indicators

**Format:** Small dots or squares with color

```html
<!-- Dot indicator -->
<div class="w-1.5 h-1.5 bg-emerald-400"></div>

<!-- Square indicator -->
<div class="w-1.5 h-1.5 bg-amber-400"></div>
```

### Metric Cards

**Structure:**

- Icon + change percentage (top)
- Label in uppercase (middle)
- Large value + unit (bottom)

**Typography:**

- Label: text-[10px] uppercase tracking-wider font-bold
- Value: text-lg font-bold tabular-nums
- Unit: text-[10px] font-bold
- Change: text-[10px] font-mono font-bold (colored)

### Progress Bars

**Style:**

- Height: 1.5px (h-1.5)
- No rounded corners
- Background: theme.accentSubtle
- Fill: theme.accent
- No color coding (remain neutral)

### Data Tables

**Row Structure:**

- 2px bottom border
- Hover state with subtle background
- Negative margin expansion on hover

**Column Layout:**

- Fixed-width numeric columns (w-10, w-12)
- Flexible name column (flex-1)
- Right-aligned numbers with tabular-nums

### Alert/Status Lists

**Format:**

- Small colored label (INFO/WARN/ERROR)
- Message text
- Timestamp in muted text
- 2px bottom border separator

## Borders & Dividers

### Border Weight

- Standard dividers: 2px (border-b-2)
- Surface borders: 1px (border)
- Reduced opacity: 10% (border-opacity-10)

### Usage

- Section headers: thick bottom border
- Table rows: thick bottom border
- Cards: thin border with low opacity
- Action bar: thick top border

## Interactive States

### Hover States

**Buttons:**

- Primary: opacity-90
- Secondary: opacity-80
- Transition: transition-opacity

**Table Rows:**

- Background: theme.accentSubtle
- Padding expansion: px-2, -mx-2
- Transition: transition-all duration-100

### Active States

**Selected Theme:**

- Uses theme.accent colors
- Font: font-bold uppercase

**Default State:**

- Uses theme.accentSubtle colors
- Font: font-bold uppercase

## Accessibility

### Contrast Requirements

- All text meets WCAG AA standards
- Status colors tested against backgrounds
- Muted text maintains 4.5:1 ratio minimum

### Typography Accessibility

- Minimum text size: 10px (only for labels)
- Body text: 12px minimum
- Tabular numbers for scanability
- High contrast between text weights

## Implementation Guidelines

### Tailwind Classes

**Common Patterns:**

```css
/* Headers */
.section-header {
  @apply text-xs font-bold uppercase tracking-wider;
}

/* Labels */
.label {
  @apply text-[10px] font-bold uppercase tracking-wider text-muted;
}

/* Metrics */
.metric-value {
  @apply text-lg font-bold tracking-tight tabular-nums;
}

/* Status Text */
.status-success {
  @apply text-emerald-400 text-[10px] font-bold font-mono;
}
.status-warning {
  @apply text-amber-400 text-[10px] font-bold font-mono;
}
```

### Component Examples

**Metric Card:**

```jsx
<div className="bg-surface p-3 border border-subtle">
  <div className="flex items-center justify-between mb-1.5">
    <Icon className="w-3.5 h-3.5 text-muted" strokeWidth={2} />
    <span className="text-[10px] font-mono font-bold text-success">+12.3%</span>
  </div>
  <div className="text-[10px] text-muted uppercase tracking-wider font-bold mb-0.5">
    Throughput
  </div>
  <div className="flex items-baseline gap-0.5">
    <span className="text-lg font-bold tracking-tight tabular-nums">12.4K</span>
    <span className="text-[10px] text-muted font-bold">/s</span>
  </div>
</div>
```

**Status Indicator:**

```jsx
<div className="flex items-center gap-2">
  <div className="w-1.5 h-1.5 bg-emerald-400"></div>
  <span className="text-xs font-bold uppercase tracking-wide">Database</span>
  <span className="text-emerald-400 text-[10px] font-bold font-mono">
    OPERATIONAL
  </span>
</div>
```

## Design Tokens

### Spacing Tokens

```js
const spacing = {
  cardPadding: "1rem", // p-4
  tightPadding: "0.75rem", // p-3
  gridGap: "0.75rem", // gap-3
  rowGap: "0.5rem", // gap-2
  iconSize: "0.875rem", // w-3.5 h-3.5
  indicatorSize: "0.375rem", // w-1.5 h-1.5
};
```

### Typography Tokens

```js
const typography = {
  header: {
    fontSize: "0.875rem", // text-sm
    fontWeight: "700", // font-bold
    textTransform: "uppercase",
    letterSpacing: "0.05em", // tracking-wider
  },
  label: {
    fontSize: "10px",
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  metric: {
    fontSize: "1.125rem", // text-lg
    fontWeight: "700",
    fontVariantNumeric: "tabular-nums",
  },
};
```

## Best Practices

### Do's

1. Use uppercase for all labels and headers
2. Apply tabular-nums to all numeric data
3. Keep colors on small elements only
4. Use 2px borders for strong separation
5. Maintain high information density
6. Use font-bold for hierarchy
7. Apply wide tracking to uppercase text

### Don'ts

1. Don't color large backgrounds
2. Don't use rounded corners on bars/indicators
3. Don't mix font weights randomly
4. Don't use color for decoration
5. Don't add unnecessary spacing
6. Don't use circles (use squares)
7. Don't soften borders below 2px for dividers

## Responsive Behavior

### Breakpoints

- Mobile: Single column, stacked metrics
- Tablet: 2-column metrics, adjusted sidebar
- Desktop: Full 8-column metric grid, 12-column layout

### Adaptive Density

- Mobile: Slightly reduced density, essential data only
- Desktop: Full density with all metrics visible
- Always maintain readability at minimum size

## Future Considerations

### Potential Additions

- Dark mode toggle animation
- Additional theme variants (slate-carbon, monochrome-pro)
- Extended color palette for data visualization
- Animation guidelines for state changes
- Extended component library

### Scalability

This system is designed to scale across:

- Multiple dashboard types
- Various data densities
- Different application contexts
- Team collaboration tools
- Monitoring and analytics platforms
