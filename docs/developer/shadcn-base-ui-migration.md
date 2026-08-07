# Migrating shadcn/ui from Radix UI to Base UI

Developer guide for migrating the project's shadcn/ui component library from Radix UI primitives to the new Base UI backend. Based on the community migration guide at [github.com/shadcn-ui/ui/discussions/9562](https://github.com/shadcn-ui/ui/discussions/9562).

---

## Background

shadcn/ui originally built its headless primitives on **Radix UI**. The library now offers an alternative backend called **Base UI** (`@base-ui/react`) — developed by the MUI team — which provides similar primitives with a slightly different API surface.

The migration is **opt-in**: your existing Radix-based components continue to work; you migrate components one at a time.

**Why migrate?**

- Base UI is actively developed and positions as the long-term direction for shadcn/ui
- Smaller runtime footprint per-primitive
- More explicit positioning API via Floating UI (replaces Radix's internal positioning)

---

## Current State (post-migration)

| Item           | Value                                             |
| -------------- | ------------------------------------------------- |
| Style          | `base-vega` (Base UI backend)                     |
| Components     | 26 components in `apps/webapp/src/components/ui/` |
| Base UI        | `@base-ui/react`                                  |
| Radix retained | None — all icons use `lucide-react`               |

> **Pre-migration** this project used `new-york` style with 16 `@radix-ui/react-*` primitive packages.

---

## Migration Strategy

> **Do NOT do a big-bang replacement.** The Radix UI and Base UI APIs differ in ways that require per-component adaptation. Migrate components individually, in dependency order.

### Recommended Order

1. **Independent atomic components** — no internal dependencies (e.g., Button, Badge, Skeleton)
2. **Composite components** — depend on other local UI components (e.g., Card, Alert)
3. **Business components** — built on top of local UI (e.g., fixed-size-dialog)
4. **Native Radix extensions** — components that extend Radix APIs directly (e.g., AlertDialog, DropdownMenu)
5. **Global regression** — test all components in light/dark/system mode

---

## Method A: CLI (Recommended)

### Step 1: Update `components.json`

In `apps/webapp/components.json`, change the style:

```json
{
  "style": "base-vega"
}
```

### Step 2: Overwrite components via CLI

```bash
cd apps/webapp

# Overwrite all components at once
pnpm dlx shadcn@latest add --all --overwrite

# Or overwrite specific components
pnpm dlx shadcn@latest add button --overwrite
pnpm dlx shadcn@latest add dialog --overwrite
```

> The CLI fetches the Base UI version of each component from the shadcn registry and overwrites the existing file.

---

## Method B: Manual Migration

1. Install the Base UI package:

   ```bash
   cd apps/webapp && pnpm add @base-ui/react
   ```

2. Copy the Base UI component code from [ui.shadcn.com](https://ui.shadcn.com/) into the corresponding `src/components/ui/<component>.tsx` files.

---

## Key API Changes to Watch For

### Remove `asChild` prop

Base UI renders differently from Radix. **Globally remove `asChild`** from all component usages:

```tsx
// Before (Radix)
<Button asChild>
  <Link href="/app">Go</Link>
</Button>

// After (Base UI) — compose directly
<Link href="/app" className={buttonVariants()}>Go</Link>
```

### Checkbox — type and indeterminate

```tsx
// Before
checked={someBoolean | "indeterminate"}

// After
checked={someBoolean}   // boolean only
indeterminate={true}    // separate prop for partial selection
```

### ToggleGroup — value and selection mode

```tsx
// Before (Radix) — value is string or string[]
<ToggleGroup value="a">

// After (Base UI) — value must always be array; use `multiple` for multi-select
<ToggleGroup value={["a"]} multiple={false}>
```

### Form components — migrate to `Field`

Base UI introduces a `Field` component to replace the existing `Form` system. This is the largest breaking change and affects any component built on top of `react-hook-form`'s shadcn `Form`. Refer to the [official docs](https://base-ui.com/react/components/field) for the migration path.

### Positioning — Floating UI replaces Radix positioning

Any component that positions a floating element (Popover, DropdownMenu, Select, Tooltip) now uses **Floating UI** internally. Custom positioning code that references Radix's `data-[side=...]` selectors needs updating:

```css
/* Before (Radix) */
[data-state=open].radix-popper { ... }

/* After (Base UI / Floating UI) */
[data-open] { ... }
```

---

## Migration Playbook for Older Apps

Older apps with heavy customization will hit more friction than greenfield projects. This section documents the **common struggle areas** and how to resolve them, based on this repo's migration experience.

### Pre-migration audit

Run these searches before changing any code. Save the output as your migration checklist:

```bash
cd apps/webapp

# asChild usages (must refactor)
rg 'asChild' src/

# Direct Radix imports (manual migration required)
rg '@radix-ui/react-' src/ package.json

# Radix state selectors in CSS/Tailwind (will silently break animations)
rg 'data-\[state=' src/

# Customized UI components (CLI --overwrite will destroy these)
git diff origin/main -- src/components/ui/

# pnpm/npm overrides for Radix (may be obsolete after migration)
rg 'radix-ui' package.json pnpm-lock.yaml ../package.json
```

### Difficulty tiers

| App profile                                               | Typical effort | Strategy                                 |
| --------------------------------------------------------- | -------------- | ---------------------------------------- |
| Fresh shadcn app, stock components                        | Days           | CLI `--all --overwrite` + consumer fixes |
| Medium app, some `asChild`, few custom extensions         | 1–2 weeks      | Component-by-component + RTL tests       |
| Large legacy app, heavy Radix usage, forms, nested modals | Weeks–months   | Audit-first, never big-bang              |

---

### 1. Removing `asChild`

**Problem:** Radix's `asChild` merged props onto a child element. Base UI does not support it. This is the most common consumer-level break.

**Find:** `rg 'asChild' src/`

#### Pattern A: Button wrapping a link or custom element

```tsx
// Before (Radix)
<Button asChild>
  <Link href="/app">Go</Link>
</Button>;

// After (Base UI)
import { buttonVariants } from '@/components/ui/button';

<Link href="/app" className={buttonVariants()}>
  Go
</Link>;
```

#### Pattern B: Trigger components (Dialog, Dropdown, Popover, Tooltip)

Apply `buttonVariants()` directly on the trigger, or pass styling via `className`:

```tsx
// Before (Radix)
<DropdownMenuTrigger asChild>
  <Button variant="outline" size="sm">Actions</Button>
</DropdownMenuTrigger>

// After (Base UI) — real example from checklist.tsx
<DropdownMenuTrigger className={buttonVariants({ variant: 'ghost', size: 'sm' })}>
  Actions
</DropdownMenuTrigger>
```

```tsx
// Before (Radix)
<AlertDialogTrigger asChild>
  <Button variant="outline">Regenerate</Button>
</AlertDialogTrigger>

// After (Base UI) — real example from profile/page.tsx
<AlertDialogTrigger
  className={cn(buttonVariants({ variant: 'outline' }), 'flex items-center gap-2')}
>
  <RefreshCw className="h-4 w-4" />
  Regenerate
</AlertDialogTrigger>
```

#### Pattern C: Tooltip on a non-button element

```tsx
// Before (Radix)
<TooltipTrigger asChild>
  <button className="custom-classes">...</button>
</TooltipTrigger>

// After (Base UI) — real example from AnonymousLoginButton.tsx
<TooltipTrigger
  className={cn(buttonVariants({ variant: 'outline' }), className)}
  disabled={isLoading}
>
  ...
</TooltipTrigger>
```

#### Pattern D: Next.js `Link` as a button

```tsx
// Before
<Button asChild><Link href="/settings">Settings</Link></Button>

// After
<Link href="/settings" className={buttonVariants({ variant: 'ghost' })}>
  Settings
</Link>
```

**Tip:** Import `buttonVariants` from `@/components/ui/button` — it is exported alongside `Button` in the Base UI version.

---

### 2. Preserving customized shadcn components

**Problem:** `pnpm dlx shadcn@latest add --all --overwrite` **replaces entire files**, destroying local edits (custom animations, `modal` defaults, iOS fixes, etc.).

**Strategy:**

1. **Commit or branch** before running the CLI.
2. For each customized file, prefer **single-component overwrite**:

   ```bash
   pnpm dlx shadcn@latest add dialog --overwrite
   ```

3. **Diff immediately** and re-apply customizations:

   ```bash
   git diff src/components/ui/dialog.tsx
   ```

4. For heavily customized components, use **Method B (manual)** — copy the Base UI version from [ui.shadcn.com](https://ui.shadcn.com/) and port your changes by hand.

**In this repo**, `dialog.tsx`, `popover.tsx`, and `dropdown-menu.tsx` had `modal={true}` defaults and iOS-related fixes that had to be preserved after CLI overwrite.

---

### 3. Migrating custom Radix extensions

**Problem:** Components that import `@radix-ui/react-*` directly (not via shadcn wrappers) have **no CLI path** — they need manual rewrite.

**Find:** `rg '@radix-ui/react-' src/`

**Example:** `fixed-size-dialog.tsx` imported `@radix-ui/react-dialog` and extended `DialogPrimitive.Content` with custom layout.

**Steps:**

1. Replace Radix import with Base UI equivalent:

   ```tsx
   // Before
   import * as DialogPrimitive from '@radix-ui/react-dialog';

   // After
   import { Dialog as DialogPrimitive } from '@base-ui/react/dialog';
   import { DialogOverlay, DialogPortal } from './dialog';
   ```

2. Update prop types to Base UI shapes (`DialogPrimitive.Root.Props`, etc.).
3. Replace Radix-specific props:
   - `onEscapeKeyDown` → removed (Base UI handles escape internally)
   - `onPointerDownOutside` → check Base UI `onOpenChange` / dismiss APIs
4. Update CSS selectors (see section 4).
5. Add an RTL test (`fixed-size-dialog.test.tsx` in this repo).

---

### 4. Updating CSS and data-attribute selectors

**Problem:** Radix uses `data-[state=open]` / `data-[state=closed]`. Base UI uses `data-open` / `data-closed`. Custom Tailwind and global CSS targeting Radix attributes will **silently stop working**.

**Find:** `rg 'data-\[state=' src/`

```tsx
// Before (Radix) — in component className strings
'data-[state=open]:animate-in data-[state=closed]:animate-out';

// After (Base UI) — real pattern from tooltip.tsx
'data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0';
```

| Radix attribute          | Base UI equivalent   |
| ------------------------ | -------------------- |
| `data-[state=open]`      | `data-open`          |
| `data-[state=closed]`    | `data-closed`        |
| `data-[state=checked]`   | `data-checked`       |
| `data-[state=unchecked]` | `data-unchecked`     |
| `data-[state=active]`    | `data-active` (tabs) |

**Also check:** `globals.css`, Storybook styles, and e2e selectors.

---

### 5. Migrating react-hook-form `Form` to Base UI `Field`

**Problem:** This is the **largest breaking change** for form-heavy apps. Base UI introduces a `Field` component that replaces shadcn's `Form`/`FormField`/`FormItem` pattern.

**Find:** `rg "from '@/components/ui/form'" src/`

**Approach:**

1. Read [Base UI Field docs](https://base-ui.com/react/components/field).
2. Migrate one form at a time — do not attempt a global replace.
3. Typical mapping:

   ```tsx
   // Before (shadcn Form)
   <FormField
     control={form.control}
     name="email"
     render={({ field }) => (
       <FormItem>
         <FormLabel>Email</FormLabel>
         <FormControl><Input {...field} /></FormControl>
         <FormMessage />
       </FormItem>
     )}
   />

   // After (Base UI Field) — conceptual; check latest shadcn Form component
   <Field name="email">
     <FieldLabel>Email</FieldLabel>
     <Input />
     <FieldError />
   </Field>
   ```

4. If your app has extensive form infrastructure, **defer Form migration** until atomic components are stable. Radix-based Form can coexist temporarily if you migrate component-by-component.

> This starter app did not heavily use shadcn `Form` — most apps with complex CRUD will feel this pain most acutely.

---

### 6. Nested modals and floating UI stacks

**Problem:** Patterns like **DropdownMenu → Dialog → Popover/Calendar** cause focus traps, `pointer-events: none` stuck on `<body>`, and iOS-specific failures.

**Test page:** `apps/webapp/src/app/test/shadcn-modal/page.tsx` documents known issues and fixes.

**Mitigations:**

1. Ensure `modal={true}` on Popover/Dialog/DropdownMenu (Base UI default in regenerated components).
2. Test the full interaction chain manually on **desktop and iOS Safari**.
3. Avoid opening a Popover inside a Dialog unless necessary — restructure UI if possible.
4. Watch for `pointer-events: none` remaining on `body` after close — indicates a focus/dismiss layer leak.

**Regression test checklist for nested flows:**

- [ ] Open dropdown → open dialog → close dialog → page still clickable
- [ ] Open dialog → open date picker → select date → both close cleanly
- [ ] Repeat on iOS Safari (calendar/popover inside modal)

---

### 7. Type and prop API changes

**Problem:** TypeScript will catch some breaks; JavaScript codebases won't.

#### Select `onValueChange` — value can be `null`

```tsx
// Before — value is always string
onValueChange={(val) => handleChange(val)}

// After — guard against null (real example from discussion-conclusion.tsx)
onValueChange={(val) => val !== null && handleTagChange(conclusion.id, val)}
```

#### Calendar `initialFocus` — removed

```tsx
// Before
<Calendar initialFocus mode="range" ... />

// After — remove prop; focus behavior is handled by react-day-picker v10
<Calendar mode="range" ... />
```

#### Calendar classname key — `table` → `month_grid`

In `calendar.tsx` classNames config (react-day-picker v10):

```tsx
// Before
table: 'w-full border-collapse';

// After
month_grid: 'w-full border-collapse';
```

#### Tabs / RadioGroup `onValueChange`

Handlers may receive `string | null`. Add guards or narrow types as needed.

---

### 8. Dependency and lockfile cleanup

**Problem:** Older monorepos accumulate Radix transitive deps, pnpm overrides, and root-level Radix packages that are no longer imported.

**Steps:**

1. Remove all `@radix-ui/react-*` from `apps/webapp/package.json`.
2. Check **root** `package.json` too — this repo had an unused `@radix-ui/react-tooltip` at the root.
3. Remove obsolete **pnpm overrides** (e.g. `@radix-ui/react-dismissable-layer` version pinning).
4. Regenerate lockfile:

   ```bash
   pnpm install
   ```

5. Verify no Radix imports remain:

   ```bash
   rg '@radix-ui/react-' src/ package.json
   ```

6. Remove unused packages flagged by your dead-code tool (e.g. `date-fns` was unused in this repo).

---

### 9. Recommended test strategy

Older apps should add tests **before** migrating consumers:

1. **RTL smoke test per component** — render open/closed states (this repo added 37 test files).
2. **`waitForOpenContent` helper** — for async portal content (see `apps/webapp/src/test-utils.tsx`).
3. **Typecheck in CI** — catches `onValueChange` null, removed props.
4. **Manual QA matrix** — light/dark/system × desktop/iOS × keyboard navigation.

```bash
pnpm typecheck
pnpm test
```

---

## Cleanup

Once all components are verified and stable, remove the legacy Radix packages:

```bash
cd apps/webapp
pnpm remove \
  @radix-ui/react-alert-dialog \
  @radix-ui/react-checkbox \
  @radix-ui/react-collapsible \
  @radix-ui/react-dialog \
  @radix-ui/react-dropdown-menu \
  @radix-ui/react-label \
  @radix-ui/react-popover \
  @radix-ui/react-progress \
  @radix-ui/react-radio-group \
  @radix-ui/react-scroll-area \
  @radix-ui/react-select \
  @radix-ui/react-separator \
  @radix-ui/react-slot \
  @radix-ui/react-switch \
  @radix-ui/react-tabs \
  @radix-ui/react-tooltip
```

> Keep icon imports on `lucide-react` (the project `iconLibrary` in `components.json`).

---

## Testing Checklist

After migrating each component, verify:

- [ ] Component renders correctly in **light mode**
- [ ] Component renders correctly in **dark mode**
- [ ] Component renders correctly in **system mode**
- [ ] Keyboard navigation works
- [ ] Animations/transitions work (open/close states)
- [ ] TypeScript compiles without errors (`pnpm typecheck`)
- [ ] Existing tests pass (`pnpm test`)

---

## Reference

- [GitHub Discussion: Shadcn UI Migration Guide — Radix UI to Base UI](https://github.com/shadcn-ui/ui/discussions/9562)
- [Base UI Official Docs](https://base-ui.com/react/overview)
- [Floating UI Docs](https://floating-ui.com)
- [Reference migration project (Vite)](https://github.com/yluiop123/vite-shadcn) — compare `radix-ui` vs `main` branches
