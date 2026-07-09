import { useEffect, useMemo, useState } from 'react';

// Domains that make sense for each tile kind. The backend accepts any but the
// UI hides irrelevant entities so the list stays manageable.
const DOMAINS_FOR_KIND = {
  button: 'switch,input_boolean,light,fan,cover,button,input_button,script,scene,automation,lock',
  number: 'sensor,input_number,number,counter',
};

export default function EntityPicker({ kind, onCancel, onConfirm }) {
  const [entities, setEntities] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [name, setName] = useState('');

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

  const canSubmit = !!selected && name.trim().length > 0;

  const submit = () => {
    if (!canSubmit) return;
    onConfirm({
      kind,
      entityId: selected.entityId,
      domain: selected.domain,
      name: name.trim(),
      unit: selected.unit || null,
    });
  };

  return (
    <div className="picker-scrim" onClick={onCancel}>
      <div className="picker" onClick={(e) => e.stopPropagation()}>
        <div className="picker-header">
          <span className="picker-title">
            Add {kind === 'button' ? 'button' : 'number'} tile
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
