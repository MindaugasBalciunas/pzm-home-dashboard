import { useMemo, useState } from 'react';
import { TILE_ICONS, TileIcon } from './SimpleTile.jsx';

// Themed packs in catalog order — each icon carries a `pack` tag, so the
// chips row below is derived rather than hand-maintained.
const PACKS = (() => {
  const seen = [];
  for (const i of TILE_ICONS) {
    if (i.pack && !seen.includes(i.pack)) seen.push(i.pack);
  }
  return seen;
})();

const packLabel = (p) => p.charAt(0).toUpperCase() + p.slice(1);

// Shared icon picker used by both the "add tile" (EntityPicker) and
// "edit tile" (TileEditor) modals. A pack chips row narrows the catalog
// to one theme; the text filter searches key + aliases within it.
export default function IconPicker({ value, onChange, domain }) {
  const [query, setQuery] = useState('');
  const [pack, setPack] = useState('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return TILE_ICONS.filter((i) => {
      if (i.key === 'auto') return true;
      if (pack !== 'all' && i.pack !== pack) return false;
      if (!q) return true;
      return i.key.toLowerCase().includes(q)
        || (i.aliases || '').toLowerCase().includes(q);
    });
  }, [query, pack]);

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
      <div className="icon-picker-packs" role="tablist" aria-label="Icon packs">
        {['all', ...PACKS].map((p) => (
          <button
            key={p}
            type="button"
            className={`icon-pack-chip ${pack === p ? 'is-active' : ''}`}
            onClick={() => setPack(p)}
          >
            {p === 'all' ? 'All' : packLabel(p)}
          </button>
        ))}
      </div>
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
