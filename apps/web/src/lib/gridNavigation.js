/**
 * Where an arrow key should land in a sheet of inputs.
 *
 * Up and down always step rows. Left and right only leave a cell once the
 * caret has run out of text to travel through, so arrowing through a name
 * behaves normally and only crosses columns at the edges. Running off either
 * side continues on the neighbouring row, so a whole sheet can be crossed
 * without reaching for the mouse.
 *
 * Returns null when the key is not a move, or when the move would leave the
 * sheet — the caller then leaves the event alone.
 */
export function nextGridCell({
  key,
  row,
  column,
  rowCount,
  columnCount,
  atStart = false,
  atEnd = false
} = {}) {
  if (!(rowCount > 0) || !(columnCount > 0)) return null;
  if (row < 0 || row > rowCount - 1 || column < 0 || column > columnCount - 1) return null;

  let nextRow = row;
  let nextColumn = column;

  if (key === "ArrowDown") {
    nextRow += 1;
  } else if (key === "ArrowUp") {
    nextRow -= 1;
  } else if (key === "ArrowLeft") {
    if (!atStart) return null;
    nextColumn -= 1;
  } else if (key === "ArrowRight") {
    if (!atEnd) return null;
    nextColumn += 1;
  } else {
    return null;
  }

  if (nextColumn < 0) {
    nextColumn = columnCount - 1;
    nextRow -= 1;
  } else if (nextColumn > columnCount - 1) {
    nextColumn = 0;
    nextRow += 1;
  }

  if (nextRow < 0 || nextRow > rowCount - 1) return null;
  return { row: nextRow, column: nextColumn };
}
