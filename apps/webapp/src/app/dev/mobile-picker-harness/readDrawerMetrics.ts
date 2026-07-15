export type DrawerMetrics = {
  paddingLeft: string;
  paddingRight: string;
  paddingBottom: string;
  maxHeight: string;
  scrollBodyHeight: number;
  scrollBodyScrollHeight: number;
  lastOptionVisible: boolean;
};

function isLastOptionVisible(drawer: HTMLElement, lastOption: HTMLElement | null): boolean {
  if (!lastOption) return false;
  const drawerRect = drawer.getBoundingClientRect();
  const lastRect = lastOption.getBoundingClientRect();
  return (
    lastRect.left >= drawerRect.left &&
    lastRect.right <= drawerRect.right &&
    lastRect.bottom <= drawerRect.bottom
  );
}

// fallow-ignore-next-line complexity
export function readDrawerMetrics(): DrawerMetrics | null {
  const drawer = document.querySelector('[data-slot="drawer-content"]') as HTMLElement | null;
  if (!drawer) return null;

  const scrollBody = drawer.querySelector('[data-picker-scroll-body]') as HTMLElement | null;
  const lastOption = drawer.querySelector(
    '[data-testid="picker-last-option"]'
  ) as HTMLElement | null;
  const style = drawer.style;

  return {
    paddingLeft: style.paddingLeft,
    paddingRight: style.paddingRight,
    paddingBottom: style.paddingBottom,
    maxHeight: style.maxHeight,
    scrollBodyHeight: scrollBody?.clientHeight ?? 0,
    scrollBodyScrollHeight: scrollBody?.scrollHeight ?? 0,
    lastOptionVisible: isLastOptionVisible(drawer, lastOption),
  };
}
