export function createViewportLayout(root: HTMLElement, options: { nativeInsets?: boolean } = {}): { update(): void } {
  let observed: HTMLElement | null = null;
  let frame = 0;
  const sync = () => {
    const nav = root.querySelector<HTMLElement>(".tabbar");
    const height = nav ? Math.ceil(nav.getBoundingClientRect().height) : 0;
    document.documentElement.style.setProperty("--app-nav-height", `${height}px`);
    const viewport = window.visualViewport;
    // Android already resizes the physical WebView above IME in MainActivity.
    const inset = !options.nativeInsets && viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
    document.documentElement.style.setProperty("--app-keyboard-inset", `${Math.ceil(inset)}px`);
    document.documentElement.style.setProperty("--app-visible-height", `${options.nativeInsets ? window.innerHeight : viewport?.height ?? window.innerHeight}px`);
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const input = document.activeElement;
      if (!(input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement || input instanceof HTMLSelectElement) || !root.contains(input)) return;
      const dialog = input.closest<HTMLDialogElement>("dialog[open]");
      const bottom = dialog ? dialog.getBoundingClientRect().bottom - 12 : (nav?.getBoundingClientRect().top ?? window.innerHeight) - 12;
      const rect = input.getBoundingClientRect();
      if (rect.bottom > bottom || rect.top < (dialog?.getBoundingClientRect().top ?? 0)) input.scrollIntoView({block:"center", behavior:"instant"});
    });
  };
  const observer = new ResizeObserver(sync);
  window.addEventListener("resize", sync);
  window.visualViewport?.addEventListener("resize", sync);
  root.addEventListener("focusin", sync);
  return { update() {
    const nav = root.querySelector<HTMLElement>(".tabbar");
    if (nav !== observed) {
      observer.disconnect();
      observed = nav;
      if (nav) observer.observe(nav, {box:"border-box"});
    }
    sync();
  } };
}
