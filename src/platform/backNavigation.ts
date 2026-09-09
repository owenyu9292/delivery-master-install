export type BackHandler = () => boolean | Promise<boolean>;

// Keep a second Back press from exiting while the first is closing an editor.
export function createBackDispatcher(handle: BackHandler, exit: () => Promise<void>, report: (error: unknown) => void) {
  let busy = false;
  let lastPress = -Infinity;
  return async () => {
    if (busy || Date.now() - lastPress < 300) return;
    busy = true;
    lastPress = Date.now();
    try {
      if (!await handle()) await exit();
    } catch (error) {
      report(error);
    } finally {
      busy = false;
    }
  };
}
