import type { Locator } from '@playwright/test';

type PMView = {
  state: {
    doc: {
      descendants: (
        fn: (node: { type: { name: string }; nodeSize: number }, pos: number) => boolean | void
      ) => void;
    };
    schema: { text: (text: string) => unknown };
    tr: {
      replaceWith: (from: number, to: number, node: unknown) => PMTransaction;
    };
    selection: { constructor: { create: (doc: unknown, pos: number) => unknown } };
  };
  dispatch: (tr: unknown) => void;
};

type PMTransaction = {
  doc: unknown;
  setSelection: (selection: unknown) => PMTransaction;
};

/** Replace the first code block text and place the ProseMirror cursor at its end. */
export async function setFirstCodeBlockTextAndFocusEnd(
  proseMirror: Locator,
  text: string
): Promise<void> {
  await proseMirror.click();
  await proseMirror.evaluate((root, content) => {
    // Playwright serializes this callback; module-level functions are unavailable here.
    let view: PMView | undefined;
    let current: HTMLElement | null = root as HTMLElement;
    while (current) {
      const candidate = (current as HTMLElement & { editor?: { view: PMView } }).editor?.view;
      if (candidate) {
        view = candidate;
        break;
      }
      current = current.parentElement;
    }
    if (!view) throw new Error('TipTap editor view not found on .ProseMirror');

    const { state, dispatch } = view;
    let codePos: number | null = null;
    let codeNode: { nodeSize: number } | null = null;

    state.doc.descendants((node, pos) => {
      if (node.type.name === 'codeBlock' && codePos === null) {
        codePos = pos;
        codeNode = node;
        return false;
      }
    });

    if (codePos === null || !codeNode) throw new Error('codeBlock not found in editor');

    const foundPos = codePos as number;
    const foundNode = codeNode as { nodeSize: number };
    const from = foundPos + 1;
    const to = foundPos + foundNode.nodeSize - 1;
    const endPos = from + content.length;
    let tr = state.tr.replaceWith(from, to, state.schema.text(content));
    tr = tr.setSelection(state.selection.constructor.create(tr.doc, endPos));
    dispatch(tr);
  }, text);
}
