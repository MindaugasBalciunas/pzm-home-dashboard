import { useEffect, useRef, useState } from 'react';

// Pull-to-refresh. Watches touchstart at the very top of the viewport and,
// if the user drags down past a threshold, triggers a full reload so every
// tile re-fetches (cameras, HA snapshot, layout, SSE reconnect).
//
// Also renders a visible affordance in the top-center that follows the
// finger — a chevron that rotates to a spinner when the release threshold
// is passed. Never activates unless the page is already scrolled to top.

const START_THRESHOLD_PX = 8;
const TRIGGER_PX = 80;
const MAX_PULL_PX = 140;

export default function PullToRefresh() {
  const [dy, setDy] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startYRef = useRef(0);
  const activeRef = useRef(false);

  useEffect(() => {
    const onStart = (e) => {
      // Only start the gesture when the viewport is at the top — otherwise
      // this fights normal vertical scrolling inside the grid.
      if (window.scrollY > 0) return;
      const t = e.touches?.[0];
      if (!t) return;
      startYRef.current = t.clientY;
      activeRef.current = true;
      setDy(0);
    };
    const onMove = (e) => {
      if (!activeRef.current || refreshing) return;
      const t = e.touches?.[0];
      if (!t) return;
      const raw = t.clientY - startYRef.current;
      if (raw <= START_THRESHOLD_PX) {
        if (dy !== 0) setDy(0);
        return;
      }
      // Rubber-band the pull past the trigger for a natural feel.
      const eased = raw < TRIGGER_PX
        ? raw
        : TRIGGER_PX + (raw - TRIGGER_PX) * 0.35;
      setDy(Math.min(MAX_PULL_PX, eased));
      // Only preventDefault once we're clearly in a pull, otherwise regular
      // scrolls at the top get eaten.
      if (raw > START_THRESHOLD_PX * 2 && e.cancelable) e.preventDefault();
    };
    const onEnd = () => {
      if (!activeRef.current) return;
      activeRef.current = false;
      const passed = dy >= TRIGGER_PX;
      if (passed && !refreshing) {
        setRefreshing(true);
        setDy(TRIGGER_PX);
        // Small delay so the user sees the spinner engage before the reload.
        setTimeout(() => {
          try { window.location.reload(); } catch { /* ignore */ }
        }, 150);
      } else {
        setDy(0);
      }
    };

    // passive:false so preventDefault works to stop the browser's own pull.
    window.addEventListener('touchstart', onStart, { passive: true });
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onEnd, { passive: true });
    window.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onStart);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onEnd);
      window.removeEventListener('touchcancel', onEnd);
    };
  }, [dy, refreshing]);

  const visible = dy > 0 || refreshing;
  const armed = refreshing || dy >= TRIGGER_PX;
  const progress = Math.min(1, dy / TRIGGER_PX);
  const style = {
    transform: `translate(-50%, ${Math.max(-40, dy - 40)}px)`,
    opacity: visible ? 1 : 0,
  };
  const rot = refreshing ? 0 : progress * 180;

  return (
    <div
      className={`ptr ${armed ? 'is-armed' : ''} ${refreshing ? 'is-refreshing' : ''}`}
      style={style}
      aria-hidden={!visible}
    >
      {refreshing ? (
        <svg className="ptr-spinner" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="42 60" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" style={{ transform: `rotate(${rot}deg)`, transition: 'transform 0.05s linear' }}>
          <path fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            d="M6 10l6 6 6-6" />
        </svg>
      )}
    </div>
  );
}
