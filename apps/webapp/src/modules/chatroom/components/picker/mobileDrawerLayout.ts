export const MOBILE_DRAWER_CONTENT_CLASSNAME =
  'bg-chatroom-bg-primary border-t border-chatroom-border p-0 max-h-[80dvh] rounded-t-none flex flex-col';

export const MOBILE_DRAWER_CHILDREN_WRAPPER_CLASSNAME = [
  'flex flex-col min-h-0 flex-1 overflow-hidden',
  '[&_[data-picker-scroll-body]]:flex-1',
  '[&_[data-picker-scroll-body]]:min-h-0',
  '[&_[data-picker-scroll-body]]:max-h-none',
].join(' ');

/** Desktop popover: flex column so PickerScrollBody can shrink and scroll within viewport. */
export const DESKTOP_PICKER_CHILDREN_WRAPPER_CLASSNAME = [
  'flex flex-col min-h-0 overflow-hidden',
  'max-h-[min(60vh,var(--radix-popover-content-available-height,60vh))]',
  '[&_[data-picker-scroll-body]]:flex-1',
  '[&_[data-picker-scroll-body]]:min-h-0',
].join(' ');
