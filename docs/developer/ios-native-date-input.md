# iOS Native Date/Time Input Width Overflow

Developer guide for diagnosing and fixing horizontal overflow of native HTML date/time inputs (`type="date"`, `datetime-local`, `time`, `month`, `week`) on iOS Safari — especially in dark mode.

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

`Input` automatically sets `data-native-date-input` when `type` is one of: `date`, `datetime-local`, `month`, `time`, `week`.

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

Wrap constrained native date inputs in the flex utility when they sit inside flex/grid layouts or have a `max-w-*` parent:

```tsx
<div className="ios-date-input-flex w-full sm:max-w-md">
  <Input type="datetime-local" value={value} onChange={onChange} />
</div>
```

Do **not** put `max-w-*` directly on the `Input` — put it on the wrapper.

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

Use native inputs when OS picker UX matters; use a custom picker when layout control is critical.

---

## Verification Checklist

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
