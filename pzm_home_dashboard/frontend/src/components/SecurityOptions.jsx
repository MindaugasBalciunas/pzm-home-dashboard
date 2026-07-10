import { useRef } from 'react';

// Modal opened by tapping the Security tile in layout-edit mode. Hosts the
// card's display options (Zones / PIR sections on-off); changes apply and
// persist immediately via the shared layout, so Done just closes.
export default function SecurityOptions({ showZones, showPir, onChange, onClose }) {
  // Same guard as TileEditor: a synthetic click from the opening tap can
  // land on the scrim and instantly close the dialog.
  const openedAtRef = useRef(Date.now());
  const handleScrimClick = () => {
    if (Date.now() - openedAtRef.current < 350) return;
    onClose();
  };

  const Row = ({ label, hint, value, patch }) => (
    <button
      type="button"
      className={`sec-opt-row ${value ? 'is-on' : ''}`}
      onClick={() => onChange(patch(!value))}
    >
      <span className="sec-opt-main">
        <span className="sec-opt-label">{label}</span>
        <span className="sec-opt-hint">{hint}</span>
      </span>
      <span className="sec-opt-state">{value ? 'Shown' : 'Hidden'}</span>
    </button>
  );

  return (
    <div className="picker-scrim" onClick={handleScrimClick}>
      <div className="picker" onClick={(e) => e.stopPropagation()}>
        <div className="picker-header">
          <span className="picker-title">Security card</span>
          <button
            type="button"
            className="side-menu-close"
            onClick={onClose}
            aria-label="Close"
          >×</button>
        </div>

        <div className="picker-form">
          <label>Sections</label>
          <div className="sec-opt-rows">
            <Row
              label="Zones"
              hint="Door / window / fire / gas contacts"
              value={showZones}
              patch={(v) => ({ showZones: v })}
            />
            <Row
              label="PIR"
              hint="Motion sensors per room"
              value={showPir}
              patch={(v) => ({ showPir: v })}
            />
          </div>
        </div>

        <div className="picker-actions">
          <button
            type="button"
            className="side-menu-btn-primary"
            onClick={onClose}
          >Done</button>
        </div>
      </div>
    </div>
  );
}
