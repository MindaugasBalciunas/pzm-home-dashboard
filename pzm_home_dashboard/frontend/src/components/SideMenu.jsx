import { useEffect, useRef, useState } from 'react';
import EntityPicker from './EntityPicker.jsx';

// Slide-in drawer. Opens via the hamburger button or a swipe that starts
// within `.side-menu-edge` (a thin strip anchored to the left viewport edge).
// Closes on backdrop tap, swipe-left, or the ✕ button.
export default function SideMenu({
  editMode,
  onToggleEdit,
  onResetLayout,
  onAddTile,
  bgDemo,
  onToggleBgDemo,
}) {
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragDx, setDragDx] = useState(0);
  const [pickerOpen, setPickerOpen] = useState(null); // null | 'button' | 'number'
  const menuRef = useRef(null);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const startedInMenuRef = useRef(false);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const menuWidth = () => {
    const el = menuRef.current;
    return el ? el.getBoundingClientRect().width : 320;
  };

  const onEdgeTouchStart = (e) => {
    if (open) return;
    const t = e.touches[0];
    startXRef.current = t.clientX;
    startYRef.current = t.clientY;
    startedInMenuRef.current = false;
    setDragging(true);
    setDragDx(-menuWidth());
  };
  const onMenuTouchStart = (e) => {
    if (!open) return;
    const t = e.touches[0];
    startXRef.current = t.clientX;
    startYRef.current = t.clientY;
    startedInMenuRef.current = true;
    setDragging(true);
    setDragDx(0);
  };
  const onTouchMove = (e) => {
    if (!dragging) return;
    const t = e.touches[0];
    const dx = t.clientX - startXRef.current;
    const dy = t.clientY - startYRef.current;
    // If gesture is clearly vertical, cancel — let the page scroll instead.
    if (Math.abs(dy) > Math.abs(dx) * 1.3 && Math.abs(dy) > 8) {
      setDragging(false);
      setDragDx(startedInMenuRef.current ? 0 : -menuWidth());
      return;
    }
    if (startedInMenuRef.current) {
      // Only follow leftward drags to close.
      setDragDx(Math.min(0, dx));
    } else {
      // Drag from edge — clamp between fully closed and fully open.
      const w = menuWidth();
      setDragDx(Math.max(-w, Math.min(0, -w + dx)));
    }
  };
  const onTouchEnd = () => {
    if (!dragging) return;
    setDragging(false);
    const w = menuWidth();
    if (startedInMenuRef.current) {
      setOpen(dragDx > -w * 0.35);
    } else {
      setOpen(dragDx > -w * 0.5);
    }
    setDragDx(0);
  };

  const style = dragging
    ? {
        transform: `translateX(${dragDx}px)`,
      }
    : undefined;

  const backdropStyle = dragging
    ? { opacity: Math.max(0, 1 + dragDx / menuWidth()) }
    : undefined;

  return (
    <>
      <button
        type="button"
        className="side-menu-btn"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        title="Menu"
      >
        <svg viewBox="0 0 24 24" aria-hidden>
          <path fill="currentColor" d="M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z" />
        </svg>
      </button>

      {/* Edge swipe hit area. Doesn't get in the way of taps because it's
          narrow and only listens for touchstart. */}
      <div
        className="side-menu-edge"
        onTouchStart={onEdgeTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      />

      <div
        className={`side-menu-backdrop ${open ? 'is-open' : ''}`}
        style={backdropStyle}
        onClick={() => setOpen(false)}
      />

      <aside
        ref={menuRef}
        className={`side-menu ${open ? 'is-open' : ''} ${dragging ? 'is-dragging' : ''}`}
        style={style}
        onTouchStart={onMenuTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        aria-hidden={!open}
      >
        <header className="side-menu-header">
          <span className="side-menu-title">PZM Home</span>
          <button
            type="button"
            className="side-menu-close"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
          >×</button>
        </header>
        <div className="side-menu-body">
          <section className="side-menu-section">
            <div className="side-menu-section-title">Layout</div>
            <div className="side-menu-row">
              <button
                type="button"
                className={`side-menu-btn-primary ${editMode ? 'is-active' : ''}`}
                onClick={() => onToggleEdit()}
              >{editMode ? 'Done editing' : 'Edit layout'}</button>
              <button
                type="button"
                className="side-menu-btn-ghost is-danger"
                onClick={() => {
                  if (window.confirm('Reset the dashboard layout for everyone?')) {
                    onResetLayout();
                    setOpen(false);
                  }
                }}
              >Reset</button>
            </div>
            <div className="side-menu-note">
              Hold a tile to lift it, then drag to move; drag the corner
              handle to resize. Tap a custom or the Security tile to
              configure it. Edits are shared with every browser viewing
              this dashboard.
            </div>
          </section>

          <section className="side-menu-section">
            <div className="side-menu-section-title">Add tile</div>
            <div className="side-menu-row">
              <button
                type="button"
                className="side-menu-btn-primary"
                onClick={() => setPickerOpen('button')}
              >Button</button>
              <button
                type="button"
                className="side-menu-btn-primary"
                onClick={() => setPickerOpen('number')}
              >Number</button>
            </div>
            <div className="side-menu-note">
              Buttons trigger an entity (switch, script, button, cover, light).
              Numbers display a live sensor reading.
            </div>
          </section>

          <section className="side-menu-section">
            <div className="side-menu-section-title">Experiments</div>
            <div className="side-menu-row">
              <button
                type="button"
                className={`side-menu-btn-primary ${bgDemo ? 'is-active' : ''}`}
                onClick={() => onToggleBgDemo?.()}
              >{bgDemo ? 'Stop BG demo' : 'BG demo loop'}</button>
            </div>
            <div className="side-menu-note">
              Cycles the Electricity house photo through every season and
              time-of-day variant. Live mode picks one by the wall clock.
            </div>
          </section>
        </div>
      </aside>

      {pickerOpen && (
        <EntityPicker
          kind={pickerOpen}
          onCancel={() => setPickerOpen(null)}
          onConfirm={(spec) => {
            onAddTile(spec);
            setPickerOpen(null);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}
