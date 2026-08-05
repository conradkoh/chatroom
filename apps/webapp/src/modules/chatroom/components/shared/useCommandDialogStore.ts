'use client';

// Base UI does not export useDialogRootContext publicly; required to read
// mounted/transitionStatus for exit animations and title/description IDs for ARIA.

import { useDialogRootContext } from '@base-ui/react/dialog/root/DialogRootContext';

export function useCommandDialogStore() {
  const { store } = useDialogRootContext();
  const mounted = store.useState('mounted');
  const open = store.useState('open');
  const transitionStatus = store.useState('transitionStatus');
  const titleElementId = store.useState('titleElementId');
  const descriptionElementId = store.useState('descriptionElementId');
  const setPopupElement = store.useStateSetter('popupElement');
  return {
    store,
    mounted,
    open,
    transitionStatus,
    titleElementId,
    descriptionElementId,
    setPopupElement,
    popupRef: store.context.popupRef,
  };
}
