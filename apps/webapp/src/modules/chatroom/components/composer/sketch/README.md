# Sketch editor module

Layered canvas editor for chatroom sketch attachments. Files are grouped by responsibility; UI building blocks live under `sketch/`, pure logic and hooks stay alongside in `composer/`.

## Layer map

| Layer                    | Location                                                                                                                                                          | Role                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| **Entry**                | `SketchDialog.tsx`                                                                                                                                                | Dialog shell + open/dismiss wiring. Only import this from product code (e.g. `MessageInput`).            |
| **Session UI**           | `sketch/SketchEditorSession.tsx`                                                                                                                                  | Composes tools, canvas, inspector, footer; owns local tool/brush state and hook orchestration.           |
| **Presentational UI**    | `sketch/SketchEditor*.tsx`, `SketchToolRail.tsx`, `SketchLayersPanel.tsx`, `SketchColorPicker.tsx`, `SketchBrushSizeControl.tsx`, `SketchDiscardDialog.tsx`       | Stateless (or lightly stateful) panels; safe to reuse in Storybook or alternate layouts.                 |
| **React hooks**          | `useSketchDocument.ts`, `useSketchSelection.ts`, `useSketchManipulation.ts`, `useSketchClipboardPaste.ts`, `useSketchBrushCursor.ts`, `useSketchToolShortcuts.ts` | Side effects and pointer/keyboard controllers. Pass refs and document commands from `useSketchDocument`. |
| **Document model**       | `sketchDocument.ts`                                                                                                                                               | Pure layer/selection/floating state transitions and invariants.                                          |
| **Canvas math**          | `sketchCanvas*.ts`, `sketchTransform.ts`, `sketchCanvasComposite.ts`                                                                                              | Drawing, selection geometry, compositing, transforms — no React.                                         |
| **Constants / registry** | `sketchConstants.ts`, `sketchTools.ts`, `sketchFileName.ts`                                                                                                       | Shared sizes, colors, tool metadata.                                                                     |

## Reusing components

### Full attachment flow (recommended)

```tsx
import { SketchDialog } from '@/modules/chatroom/components/composer/SketchDialog';

<SketchDialog open={open} onOpenChange={setOpen} onSave={attachPngFile} />;
```

### Custom layout with the same engine

Use `SketchEditorSession` inside your own dialog, or compose lower-level pieces:

```tsx
import { SketchEditorSession } from '@/modules/chatroom/components/composer/sketch/SketchEditorSession';
import { SketchEditorCanvasPanel } from '@/modules/chatroom/components/composer/sketch/SketchEditorCanvasPanel';
import { SketchEditorProperties } from '@/modules/chatroom/components/composer/sketch/SketchEditorProperties';
import { SketchEditorFooter } from '@/modules/chatroom/components/composer/sketch/SketchEditorFooter';
```

`SketchEditorProperties` is tool-aware: pass `activeTool`, `selection`, `floating`, and the delete/apply/cancel callbacks from `useSketchDocument` / `useSketchSelection`.

`SketchLayersPanel` is fully controlled:

```tsx
<SketchLayersPanel
  layersTopFirst={[...layers].reverse()}
  activeLayerId={activeLayerId}
  disabled={layersDisabled}
  onActiveLayerChange={setActiveLayerId}
/>
```

`SketchToolRail` is controlled via `activeTool`, `enabledTools`, and `onToolChange`.

### Hooks without the dialog

`useSketchDocument` is the single source of truth for layer bitmaps, compositing, floating transactions, paste import, and export:

```tsx
const doc = useSketchDocument({ brushColor, brushSize, disabled, eraserMode });
// doc.canvasRef + doc.canvasBindings for drawing
// doc.exportPngFile() for PNG export
```

Pair with `useSketchSelection`, `useSketchManipulation`, and `useSketchClipboardPaste` as `SketchEditorSession` does.

## Adding a tool

1. Register in `sketchTools.ts` (`SKETCH_TOOLS`, `SKETCH_ENABLED_TOOL_IDS`, icon in `SketchToolRail`).
2. Add a branch in `SketchEditorProperties` for inspector copy/controls.
3. Wire pointer bindings in `SketchEditorSession` (canvas binding switch in `SketchEditorCanvasPanel` already routes by `activeTool`).
4. Extend `useSketchDocument` only if the tool mutates layer pixels or floating state.

## Tests

- `SketchDialog.test.tsx` — integration smoke for the public dialog.
- Colocated `*.test.ts(x)` next to each hook, pure module, and UI panel.
- E2E: `tests/e2e/specs/downstream/sketch-canvas-harness.spec.ts`.

## Conventions

- **`Sketch*`** — React components (PascalCase file).
- **`sketch*`** — pure functions, constants, or hooks (`useSketch*`).
- **`sketch/`** — editor layout UI extracted from the monolithic dialog; import components directly from this folder when composing custom editors.
