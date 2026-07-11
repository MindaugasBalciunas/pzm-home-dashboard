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
