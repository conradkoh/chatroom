# Knip Baseline

This document records the initial knip findings when the tool was first integrated into the project. Downstream projects should use these findings as a reference to understand which files/dependencies are intentionally unused and should not be fixed.

**Baseline Generated:** 2026-05-10

## Unused Files (9)

These files exist but are not imported anywhere in the codebase. They may be:

- Placeholder/stub files for future features
- Deprecated files awaiting removal
- Files imported only dynamically or via configuration

```
apps/webapp/src/components/DateRangePicker.tsx
apps/webapp/src/components/ThemeToggle.tsx
apps/webapp/src/components/ui/alert.tsx
apps/webapp/src/components/ui/collapsible.tsx
apps/webapp/src/components/ui/fixed-size-dialog.tsx
apps/webapp/src/modules/checklist/checklist-empty-state.tsx
apps/webapp/src/test-utils.tsx
services/backend/convex/migrations.ts
services/backend/convex/sessions.ts
```

## Unused Dependencies (6)

These packages are installed but not used in the codebase:

```
@hookform/resolvers          apps/webapp/package.json:17:6
@radix-ui/react-collapsible  apps/webapp/package.json:21:6
@types/luxon                 apps/webapp/package.json:35:6
luxon                        apps/webapp/package.json:43:6
react-icons                  apps/webapp/package.json:49:6
tailwindcss-animate          apps/webapp/package.json:52:6
```

## Unused DevDependencies (8)

These dev packages are installed but not used:

```
@tailwindcss/typography  apps/webapp/package.json:58:6
bun                      apps/webapp/package.json:67:6
tailwindcss              apps/webapp/package.json:73:6
@eslint/eslintrc         package.json:34:6
eslint-config-next       package.json:39:6
eslint-config-prettier   package.json:40:6
convex-test              services/backend/package.json:26:6
vite                     services/backend/package.json:28:6
```

## Unresolved Imports (1)

```
../migration.js  services/backend/convex/_generated/api.d.ts:19:33
```

Note: This is a generated file reference that may be safely ignored.

## Unused Exports (28)

These exported symbols are defined but not used externally:

### alert-dialog.tsx

- AlertDialogPortal
- AlertDialogOverlay

### badge.tsx

- badgeVariants

### card.tsx

- CardAction

### dialog.tsx

- FullscreenDialogContent
- DialogClose
- DialogOverlay
- DialogPortal
- DialogTrigger

### dropdown-menu.tsx

- DropdownMenuPortal
- DropdownMenuGroup
- DropdownMenuCheckboxItem
- DropdownMenuRadioGroup
- DropdownMenuRadioItem
- DropdownMenuShortcut
- DropdownMenuSub
- DropdownMenuSubTrigger
- DropdownMenuSubContent

### popover.tsx

- PopoverAnchor

### scroll-area.tsx

- ScrollBar

### select.tsx

- SelectGroup
- SelectLabel
- SelectScrollDownButton
- SelectScrollUpButton
- SelectSeparator

### password-protection/index.ts

- generatePasswordHash
- verifyPassword

### password-protection/password-utils.ts

- generatePasswordHash

## Unused Exported Types (8)

These types/interfaces are defined but not used externally:

```
AppInfo                      interface  apps/webapp/src/modules/app/AppInfoProvider.tsx:10:18
AttendanceMode               type       apps/webapp/src/modules/attendance/types.ts:3:13
AttendanceRecord             interface  apps/webapp/src/modules/attendance/types.ts:10:18
ChecklistItemProps           interface  apps/webapp/src/modules/checklist/types.ts:76:18
ChecklistItemFormProps       interface  apps/webapp/src/modules/checklist/types.ts:87:18
PasswordProtectConfig        type       apps/webapp/src/modules/password-protection/index.ts:5:15
PasswordProtectContextValue  type       apps/webapp/src/modules/password-protection/index.ts:5:38
PasswordProtectConfig        interface  apps/webapp/src/modules/password-protection/PasswordProtectContext.tsx:8:18
```

## Configuration Hints (4)

These may be addressed or acknowledged as expected:

```
husky          knip.jsonc                     Remove from ignoreDependencies
lint-staged    knip.jsonc                     Remove from ignoreDependencies
index.js       package.json                   Package entry file not found
index.js       services/backend/package.json  Package entry file not found
```

---

**Note:** Exit code 1 from knip is expected when unused code is detected. This is normal behavior for the tool.
