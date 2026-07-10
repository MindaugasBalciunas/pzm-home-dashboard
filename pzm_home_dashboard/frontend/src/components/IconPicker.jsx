import { useMemo, useState } from 'react';
import { TILE_ICONS, TileIcon } from './SimpleTile.jsx';

// Shared icon picker used by both the "add tile" (EntityPicker) and
// "edit tile" (TileEditor) modals. Includes a text filter over icon key
// + aliases so the catalog can grow without becoming unwieldy.
export default function IconPicker({ value, onChange, domain }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return TILE_ICONS;
    return TILE_ICONS.filter((i) => {
      if (i.key === 'auto') return true;
      return i.key.toLowerCase().includes(q)
        || (i.aliases || '').toLowerCase().includes(q);
    });
  }, [query]);

  return (
    <div className="icon-picker-wrap">
      <input
        type="search"
        className="icon-picker-search"
        placeholder="Search icons…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Filter icons"
      />
      <div className="icon-picker">
        {filtered.map(({ key }) => (
          <button
            key={key}
            type="button"
            className={`icon-picker-btn ${value === key ? 'is-active' : ''}`}
            onClick={() => onChange(key)}
            title={key}
            aria-label={`Icon: ${key}`}
          >
            {key === 'auto' ? (
              <span className="icon-picker-auto">Auto</span>
            ) : (
              <TileIcon iconKey={key} domain={domain} on={true} />
            )}
          </button>
        ))}
        {filtered.length === 0 && (
          <div className="icon-picker-empty">No icons match “{query}”.</div>
        )}
      </div>
    </div>
  );
}
