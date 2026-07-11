// Visibility-aware polling. A kiosk webview spends hours with the screen
// blanked (HA companion app, Fully Kiosk screensaver) — polling through
// that burns radio/CPU for pixels nobody sees. `startPolling` runs `fn`
// immediately, then on an interval, but skips ticks while the document is
// hidden and fires a catch-up call the moment it becomes visible again so
// wake-up always shows fresh data.
export function startPolling(fn, intervalMs) {
  let stopped = false;
  const run = () => { if (!stopped && !document.hidden) fn(); };
  // Skip the mount fetch while the screen is blanked — the catch-up call on
  // the next visibilitychange fetches fresh data the moment it's shown.
  if (!document.hidden) fn();
  const id = setInterval(run, intervalMs);
  const onVisible = () => { if (!stopped && !document.hidden) fn(); };
  // Pull-to-refresh (and any manual refresh) fans out through this event so
  // every card re-fetches in place without a page reload.
  const onRefresh = () => { if (!stopped && !document.hidden) fn(); };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pzm:refresh', onRefresh);
  return () => {
    stopped = true;
    clearInterval(id);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('pzm:refresh', onRefresh);
  };
}
