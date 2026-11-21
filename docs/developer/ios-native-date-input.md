# iOS Native Date/Time Input Width Overflow

Developer guide for diagnosing and fixing horizontal overflow of native HTML date/time inputs (`type="date"`, `datetime-local`, `time`, `month`, `week`) on iOS Safari — especially in dark mode.

---

## Recommendation

**Do not use native temporal HTML inputs in production UI.** Testing on iOS Safari has confirmed unreliable behavior even with the framework CSS fixes below:

- **Width:** Dark mode does not respect parent width constraints.
- **Text alignment:** Selected values are not properly centered vertically or horizontally.
- **Auto-modification:** Values may change without user interaction.

Use custom Popover + Calendar pickers (see the date-picker story in the Component Storybook at `/developer/components/date-picker`) instead. Native inputs in this doc are documented for diagnosis and regression comparison only.

---

## Enforcement

The policy is enforced in four layers:

- **CI** — `.github/workflows/ci.yml` runs `pnpm lint` and `pnpm typecheck` on pull requests to `master`. Whether a failure blocks a merge depends on branch protection requiring the `tests` check; branch protection has not been verified.
- **Raw inputs** — `react/forbid-elements` in `eslint.config.mjs` bans `<input>` elements in product code. Render inputs through `Input` from `@/components/ui/input`.
- **Imports** — `no-restricted-imports` bans `@base-ui/react/input`, the `Input` and `Field` exports of the `@base-ui/react` root barrel, and `@base-ui/react/field`, outside `input.tsx`. It also bans importing `NativeTemporalInput` from `@/components/ui/input` or any relative path that resolves to it, outside the developer harness. `NativeTemporalInput` is only for the developer harness and diagnostics and must not appear in product UI.
- **Temporal types** — `no-restricted-syntax` rejects literal temporal `type` values (`date`, `datetime-local`, `month`, `time`, `week`) on any JSX element, including the `type={'date'}` expression form. `Input`'s `type` union also excludes them at compile time. Use `DatePickerField` from `@/components/ui/date-picker` instead.

### Known gaps

- Dynamic tags (`const Tag = 'input'` then `<Tag />`) are not detected.
- `jsx('input', …)` from `react/jsx-runtime` is not detected.
- Third-party components that render their own `<input>` are outside these rules.
- `@ts-expect-error` or `as any` on `Input` defeats the compile-time type restriction.
- Imperative DOM changes (`ref.current.type = …`, `setAttribute`) bypass both lint and types.

---

## Symptoms

| Environment              | Typical behavior                                                 |
| ------------------------ | ---------------------------------------------------------------- |
| Desktop Chrome/Safari    | Input respects `width: 100%`                                     |
| iOS Simulator            | May render at ~half width or otherwise differ from a real device |
| Real iPhone (dark mode)  | Input overflows the viewport; horizontal scroll appears          |
| Real iPhone (light mode) | May work without extra CSS                                       |

**Do not rely on the iOS Simulator alone** for this bug. Always verify on a physical iPhone in dark mode.

---

## Root Cause

Two factors combine:

### 1. `color-scheme: dark` on `<html>`

`ThemeProvider` uses `next-themes` with `enableColorScheme`. In dark mode this sets `color-scheme: dark` on the document root. WebKit then renders native date/time controls with dark styling, which changes their **intrinsic minimum width**.

Relevant code: `apps/webapp/src/modules/theme/ThemeProvider.tsx` — `enableColorScheme` on `NextThemesProvider`.

### 2. WebKit ignores `width: 100%` on native temporal inputs

iOS Safari treats `input[type="date"]` and `input[type="datetime-local"]` as special controls. Standard Tailwind classes (`w-full`, `min-w-0`, `max-w-full`) on the `<input>` element are **not sufficient** — WebKit applies its own internal layout for the datetime edit fields and calendar picker indicator.

This is a long-standing WebKit quirk; see [Stack Overflow #26573346](https://stackoverflow.com/questions/26573346/ios-safari-messes-up-input-type-date).

---

## Framework Fix (this repo)

### `data-native-date-input` attribute

`NativeTemporalInput` (from `@/components/ui/input`) sets `data-native-date-input` when `type` is one of: `date`, `datetime-local`, `month`, `time`, `week`. `Input` no longer accepts temporal types.

File: `apps/webapp/src/components/ui/input.tsx`

### Global CSS rules

File: `apps/webapp/src/app/globals.css` (`@layer components`)

| Rule                                       | Purpose                                                                                 |
| ------------------------------------------ | --------------------------------------------------------------------------------------- |
| `display: block` + `width/max-width: 100%` | Baseline box sizing                                                                     |
| `min-width: 95%`                           | Prevents shrinking below viewport (Christina's SO answer)                               |
| `-webkit-appearance: textfield`            | Makes WebKit treat the control like a text field for sizing (Carter Medlin's SO answer) |
| `.ios-date-input-flex` wrapper             | Flex parent/child pattern forces full width (Razvan Grigore's SO answer)                |

### Usage in consuming apps

Use `DatePickerField` for date fields in product forms:

```tsx
<DatePickerField id="start" label="Start date" date={date} onSelect={setDate} />
```

Do **not** render native temporal inputs in product UI. The flex wrapper and `data-native-date-input` styles exist only for the developer harness and diagnostic comparisons.

---

## What We Tried and Reverted

These approaches were tested and **did not reliably fix** overflow on a real iPhone:

| Approach                                       | Why it failed or was rejected                          |
| ---------------------------------------------- | ------------------------------------------------------ |
| `dark:[color-scheme:light]` on inputs          | Hacky; changes native control appearance; inconsistent |
| `::-webkit-datetime-edit` pseudo-element rules | Partial fix; fragile across iOS versions               |
| `max-w-full` / `min-w-0` on Input only         | Insufficient without appearance + flex patterns        |
| `min-w-0` on AppShell / admin layout           | Layout symptom, not root fix                           |
| `-webkit-appearance: none`                     | **Removes** the native calendar/picker indicator       |

---

## What to Avoid

- **`-webkit-appearance: none`** — strips the native picker affordance; users lose the calendar icon.
- **Simulator-only testing** — behavior differs from real devices.
- **Assuming Base UI is the cause** — the overflow is WebKit + `color-scheme`, not `@base-ui/react/input`.

---

## Durable Alternative: Custom Date Picker

If native inputs remain problematic for a specific form, replace with a custom picker (e.g. the app's existing `DateRangePicker` / calendar component pattern). This trades native OS picker UX for fully controlled layout.

**Default to custom pickers.** Native temporal inputs should not be used in production forms. The framework CSS below may partially address width overflow but does not fix alignment or auto-selection issues.

---

## Verification Checklist

Use this checklist only when debugging legacy native temporal input usage — not for new features.

- [ ] Real iPhone, dark mode, narrow viewport (e.g. iPhone SE or standard size)
- [ ] Input fits within screen — no horizontal page scroll
- [ ] Native calendar/picker indicator still visible and tappable
- [ ] Light mode unchanged
- [ ] Desktop dark mode: inputs still functional
- [ ] Non-date inputs (text, email, etc.) unaffected

---

## References

- [Stack Overflow #26573346 — iOS Safari messes up input type=date](https://stackoverflow.com/questions/26573346/ios-safari-messes-up-input-type-date)
- [MDN: color-scheme](https://developer.mozilla.org/en-US/docs/Web/CSS/color-scheme)
- [next-themes enableColorScheme](https://github.com/pacocoursey/next-themes)
