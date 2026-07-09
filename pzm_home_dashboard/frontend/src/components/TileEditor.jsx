import { useEffect, useState } from 'react';
import { TILE_ICON_KEYS, TileIcon } from './SimpleTile.jsx';

// Modal shown after a long-press on a custom / template tile. Buttons get
// name + icon; numbers get name only. Delete removes the tile outright.
export default function TileEditor({ id, entry, onSave, onDelete, onCancel }) {
  const spec = entry?.spec || {};
  const [name, setName] = useState(spec.name || '');
  const [icon, setIcon] = useState(spec.icon || 'auto');

  useEffect(() => {
    setName(spec.name || '');
    setIcon(spec.icon || 'auto');
  }, [id, spec.name, spec.icon]);

  const canSave = name.trim().length > 0;

  const save = () => {
    if (!canSave) return;
    const nextSpec = { ...spec, name: name.trim() };
    if (spec.kind === 'button') nextSpec.icon = icon;
    onSave(id, nextSpec);
  };

  return (
    <div className="picker-scrim" onClick={onCancel}>
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
              <div className="icon-picker">
                {TILE_ICON_KEYS.map((k) => (
                  <button
                    key={k}
                    type="button"
                    className={`icon-picker-btn ${icon === k ? 'is-active' : ''}`}
                    onClick={() => setIcon(k)}
                    title={k}
                    aria-label={`Icon: ${k}`}
                  >
                    {k === 'auto' ? (
                      <span className="icon-picker-auto">Auto</span>
                    ) : (
                      <TileIcon iconKey={k} domain={spec.domain} on={true} />
                    )}
                  </button>
                ))}
              </div>
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
