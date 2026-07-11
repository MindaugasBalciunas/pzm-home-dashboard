// Visibility-aware polling. A kiosk webview spends hours with the screen
// blanked (HA companion app, Fully Kiosk screensaver) — polling through
// that burns radio/CPU for pixels nobody sees. `startPolling` runs `fn`
// immediately, then on an interval, but skips ticks while the document is
// hidden and fires a catch-up call the moment it becomes visible again so
// wake-up always shows fresh data.
export function startPolling(fn, intervalMs) {
  let stopped = false;
  const run = () => { if (!stopped && !document.hidden) fn(); };
  fn();
  const id = setInterval(run, intervalMs);
  const onVisible = () => { if (!stopped && !document.hidden) fn(); };
  document.addEventListener('visibilitychange', onVisible);
  return () => {
    stopped = true;
    clearInterval(id);
    document.removeEventListener('visibilitychange', onVisible);
  };
}
