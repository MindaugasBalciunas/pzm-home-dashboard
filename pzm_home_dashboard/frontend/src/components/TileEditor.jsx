import { useEffect, useRef, useState } from 'react';
import IconPicker from './IconPicker.jsx';

// Modal shown after a long-press on a custom / template tile. Buttons get
// name + icon; numbers get name only. Delete removes the tile outright.
export default function TileEditor({ id, entry, onSave, onDelete, onCancel }) {
  const spec = entry?.spec || {};
  const [name, setName] = useState(spec.name || '');
  const [icon, setIcon] = useState(spec.icon || 'auto');
  // Guard against a synthetic click from the long-press touchend landing on
  // the scrim and instantly closing us. Ignore clicks in the first ~350 ms.
  const openedAtRef = useRef(Date.now());

  useEffect(() => {
    setName(spec.name || '');
    setIcon(spec.icon || 'auto');
    openedAtRef.current = Date.now();
  }, [id, spec.name, spec.icon]);

  const handleScrimClick = () => {
    if (Date.now() - openedAtRef.current < 350) return;
    onCancel();
  };

  const canSave = name.trim().length > 0;

  const save = () => {
    if (!canSave) return;
    const nextSpec = { ...spec, name: name.trim() };
    if (spec.kind === 'button') nextSpec.icon = icon;
    onSave(id, nextSpec);
  };

  return (
    <div className="picker-scrim" onClick={handleScrimClick}>
      <div className="picker" onClick={(e) => e.stopPropagation()}>
        <div className="picker-header">
          <span className="picker-title">
            Edit {spec.kind === 'button' ? 'button' : 'number'} tile
          </span>
          <button
            type="button"
            className="side-menu-close"
            onClick={onCancel}
            aria-label="Close"
          >×</button>
        </div>

        <div className="picker-form">
          <label htmlFor="tileedit-name">Display name</label>
          <input
            id="tileedit-name"
            type="text"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <label>Entity</label>
          <div className="picker-preview-id" style={{ padding: '0.35rem 0', maxWidth: '100%' }}>
            {spec.entityId || '—'}
          </div>

          {spec.kind === 'button' && (
            <>
              <label>Icon</label>
              <IconPicker
                value={icon}
                onChange={setIcon}
                domain={spec.domain}
              />
            </>
          )}
        </div>

        <div className="picker-actions" style={{ justifyContent: 'space-between' }}>
          <button
            type="button"
            className="side-menu-btn-ghost is-danger"
            onClick={() => {
              if (window.confirm('Delete this tile?')) onDelete(id);
            }}
          >Delete</button>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="side-menu-btn-ghost"
              onClick={onCancel}
            >Cancel</button>
            <button
              type="button"
              className="side-menu-btn-primary"
              disabled={!canSave}
              onClick={save}
            >Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}
