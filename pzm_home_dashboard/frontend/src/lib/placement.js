// Tile placement. Integer col/row/spans place the tile as a CSS-grid item
// (the classic snap-to-grid dashboard). Any fractional value switches the
// tile to absolute positioning computed from the same --cell / --gap
// variables the grid uses, so a tile at col 5.0 renders in exactly the
// same spot either way — dragging with "Snap to grid" off just unlocks
// the quantisation. Free tiles get a small z-index so they layer on top
// of grid-flow cards (Electricity, cameras) they're dropped onto.
const UNIT = 'calc(var(--cell) + var(--gap))';

export function isFreePlacement(col, row, colSpan, rowSpan) {
  return !(Number.isInteger(col) && Number.isInteger(row)
    && Number.isInteger(colSpan) && Number.isInteger(rowSpan));
}

export function tilePlacementStyle(col, row, colSpan, rowSpan) {
  if (!isFreePlacement(col, row, colSpan, rowSpan)) {
    return {
      gridColumn: `${col} / span ${colSpan}`,
      gridRow: `${row} / span ${rowSpan}`,
    };
  }
  return {
    position: 'absolute',
    left: `calc(var(--gap) + (${col} - 1) * ${UNIT})`,
    top: `calc(var(--gap) + (${row} - 1) * ${UNIT})`,
    width: `calc(${colSpan} * var(--cell) + (${colSpan} - 1) * var(--gap))`,
    height: `calc(${rowSpan} * var(--cell) + (${rowSpan} - 1) * var(--gap))`,
    zIndex: 3,
  };
}

// Find a free spot for a new tile, size wxh, scanning the grid top-to-bottom.
export function findFreeSpot(overrides, w, h, gridCols = 48) {
  const occupied = new Map(); // row -> Set<col>
  // Floor/ceil so free-placed (fractional) tiles still block every grid
  // cell they touch — the integer scan below only probes whole cells.
  const mark = (col, row, colSpan, rowSpan) => {
    for (let r = Math.floor(row); r < Math.ceil(row + rowSpan); r++) {
      let set = occupied.get(r);
      if (!set) { set = new Set(); occupied.set(r, set); }
      for (let c = Math.floor(col); c < Math.ceil(col + colSpan); c++) set.add(c);
    }
  };
  for (const v of Object.values(overrides)) {
    if (!v || v.hidden) continue;
    if (v.col && v.row && v.colSpan && v.rowSpan) mark(v.col, v.row, v.colSpan, v.rowSpan);
  }
  for (let row = 1; row < 200; row++) {
    for (let col = 1; col <= gridCols - w + 1; col++) {
      let free = true;
      outer: for (let r = row; r < row + h; r++) {
        const set = occupied.get(r);
        if (!set) continue;
        for (let c = col; c < col + w; c++) {
          if (set.has(c)) { free = false; break outer; }
        }
      }
      if (free) return { col, row };
    }
  }
  return { col: 1, row: 1 };
}
