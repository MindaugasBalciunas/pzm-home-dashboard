import { useEffect, useMemo, useRef, useState } from 'react';
import IconPicker from './IconPicker.jsx';

// Domains that make sense for each tile kind. The backend accepts any but the
// UI hides irrelevant entities so the list stays manageable.
const DOMAINS_FOR_KIND = {
  button: 'switch,input_boolean,light,fan,cover,button,input_button,script,scene,automation,lock',
  number: 'sensor,input_number,number,counter',
  // Scene/pattern chips only make sense for lights with an effect list.
  lightfx: 'light',
};

const KIND_LABELS = {
  button: 'button',
  number: 'number',
  lightfx: 'light scenes',
};

export default function EntityPicker({ kind, onCancel, onConfirm }) {
  const [entities, setEntities] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [name, setName] = useState('');
  const [icon, setIcon] = useState('auto');
  const [livePreview, setLivePreview] = useState(null);
  const previewTimerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    const domains = DOMAINS_FOR_KIND[kind] || '';
    const url = `api/ha/entities?limit=1000${domains ? `&domains=${encodeURIComponent(domains)}` : ''}`;
    fetch(url)
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((data) => { if (!cancelled) setEntities(Array.isArray(data) ? data : []); })
      .catch((e) => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [kind]);

  const filtered = useMemo(() => {
    if (!entities) return [];
    const q = query.trim().toLowerCase();
    if (!q) return entities.slice(0, 300);
    return entities.filter((e) =>
      e.entityId.toLowerCase().includes(q)
      || (e.friendlyName || '').toLowerCase().includes(q)
    ).slice(0, 300);
  }, [entities, query]);

  const selected = entities?.find((e) => e.entityId === selectedId) || null;

  useEffect(() => {
    // Default the display name to the entity's friendly name when the user
    // picks a new one, but don't overwrite anything they've typed.
    if (selected && !name) setName(selected.friendlyName || selected.entityId);
  }, [selected, name]);

  // Live-poll the selected entity so the preview panel reflects reality even
  // if the initial /entities snapshot is stale.
  useEffect(() => {
    if (previewTimerRef.current) {
      clearInterval(previewTimerRef.current);
      previewTimerRef.current = null;
    }
    setLivePreview(null);
    if (!selected) return undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const r = await fetch('api/ha/entity/state', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [selected.entityId] }),
        });
        if (!r.ok) return;
        const data = await r.json();
        const first = Array.isArray(data) ? data[0] : null;
        if (!cancelled && first) setLivePreview(first);
      } catch { /* transient */ }
    };
    load();
    previewTimerRef.current = setInterval(load, 3000);
    return () => {
      cancelled = true;
      if (previewTimerRef.current) clearInterval(previewTimerRef.current);
    };
  }, [selected]);

  const canSubmit = !!selected && name.trim().length > 0;

  const submit = () => {
    if (!canSubmit) return;
    // No `unit` here on purpose: tiles read the live unit from HA each
    // poll. Baking in the snapshot unit made stale/wrong units (e.g. '%')
    // stick forever; the tile editor's Unit field is the explicit override.
    onConfirm({
      kind,
      entityId: selected.entityId,
      domain: selected.domain,
      name: name.trim(),
      icon,
    });
  };

  return (
    <div className="picker-scrim" onClick={onCancel}>
      <div className="picker picker-wide" onClick={(e) => e.stopPropagation()}>
        <div className="picker-header">
          <span className="picker-title">
            Add {KIND_LABELS[kind] || kind} tile
          </span>
          <button
            type="button"
            className="side-menu-close"
            onClick={onCancel}
            aria-label="Close"
          >×</button>
        </div>

        <div className="picker-form">
          <label htmlFor="picker-search">Search</label>
          <input
            id="picker-search"
            type="search"
            autoFocus
            placeholder="entity id or name"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />

          <label htmlFor="picker-name">Display name</label>
          <input
            id="picker-name"
            type="text"
            placeholder="e.g. Living Room Light"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />

          <label>Icon</label>
          <IconPicker
            value={icon}
            onChange={setIcon}
            domain={selected?.domain}
          />
        </div>

        <div className="picker-list">
          {error && (
            <div className="picker-entity" style={{ color: 'var(--danger)' }}>
              Failed to load entities: {error}
            </div>
          )}
          {!error && entities === null && (
            <div className="picker-entity">Loading entities…</div>
          )}
          {!error && entities && filtered.length === 0 && (
            <div className="picker-entity">No entities match.</div>
          )}
          {filtered.map((e) => (
            <div
              key={e.entityId}
              className={`picker-entity ${selectedId === e.entityId ? 'is-selected' : ''}`}
              onClick={() => {
                setSelectedId(e.entityId);
                if (!name) setName(e.friendlyName || e.entityId);
              }}
            >
              <div className="picker-entity-main">
                <div className="picker-entity-name">
                  {e.friendlyName || e.entityId}
                </div>
                <div className="picker-entity-id">{e.entityId}</div>
              </div>
              <div className="picker-entity-state">
                {e.state ?? '—'}{e.unit ? ` ${e.unit}` : ''}
              </div>
            </div>
          ))}
        </div>

        {selected && (
          <div className="picker-preview">
            <div className="picker-preview-header">
              <span className="picker-preview-label">Preview</span>
              <code className="picker-preview-id">{selected.entityId}</code>
            </div>
            <div className="picker-preview-body">
              <div className="picker-preview-name">
                {(name || selected.friendlyName || selected.entityId)}
              </div>
              <div className="picker-preview-value">
                <span className="n">
                  {livePreview?.state ?? selected.state ?? '—'}
                </span>
                {(livePreview?.unit || selected.unit) && (
                  <span className="u">{livePreview?.unit || selected.unit}</span>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="picker-actions">
          <button
            type="button"
            className="side-menu-btn-ghost"
            onClick={onCancel}
          >Cancel</button>
          <button
            type="button"
            className="side-menu-btn-primary"
            disabled={!canSubmit}
            onClick={submit}
          >Add</button>
        </div>
      </div>
    </div>
  );
}
