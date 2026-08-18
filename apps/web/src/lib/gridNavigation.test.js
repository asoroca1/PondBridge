import { describe, expect, test } from "vitest";
import { nextGridCell } from "./gridNavigation.js";

const sheet = { rowCount: 5, columnCount: 3 };

describe("nextGridCell", () => {
  test("steps rows on up and down from any column", () => {
    expect(nextGridCell({ ...sheet, key: "ArrowDown", row: 1, column: 2 }))
      .toEqual({ row: 2, column: 2 });
    expect(nextGridCell({ ...sheet, key: "ArrowUp", row: 1, column: 0 }))
      .toEqual({ row: 0, column: 0 });
  });

  test("stays put when the caret still has text to travel through", () => {
    // Mid-word: the arrow belongs to the text, not the grid.
    expect(nextGridCell({ ...sheet, key: "ArrowLeft", row: 1, column: 1, atStart: false }))
      .toBeNull();
    expect(nextGridCell({ ...sheet, key: "ArrowRight", row: 1, column: 1, atEnd: false }))
      .toBeNull();
  });

  test("crosses columns once the caret reaches the edge of the cell", () => {
    expect(nextGridCell({ ...sheet, key: "ArrowLeft", row: 1, column: 1, atStart: true }))
      .toEqual({ row: 1, column: 0 });
    expect(nextGridCell({ ...sheet, key: "ArrowRight", row: 1, column: 1, atEnd: true }))
      .toEqual({ row: 1, column: 2 });
  });

  test("wraps to the neighbouring row at either end of a row", () => {
    expect(nextGridCell({ ...sheet, key: "ArrowRight", row: 1, column: 2, atEnd: true }))
      .toEqual({ row: 2, column: 0 });
    expect(nextGridCell({ ...sheet, key: "ArrowLeft", row: 1, column: 0, atStart: true }))
      .toEqual({ row: 0, column: 2 });
  });

  test("refuses to leave the sheet at its edges", () => {
    expect(nextGridCell({ ...sheet, key: "ArrowUp", row: 0, column: 1 })).toBeNull();
    expect(nextGridCell({ ...sheet, key: "ArrowDown", row: 4, column: 1 })).toBeNull();
    // Wrapping off the last cell would need a sixth row that does not exist.
    expect(nextGridCell({ ...sheet, key: "ArrowRight", row: 4, column: 2, atEnd: true }))
      .toBeNull();
    expect(nextGridCell({ ...sheet, key: "ArrowLeft", row: 0, column: 0, atStart: true }))
      .toBeNull();
  });

  test("ignores keys that are not a move", () => {
    expect(nextGridCell({ ...sheet, key: "a", row: 1, column: 1 })).toBeNull();
    expect(nextGridCell({ ...sheet, key: "Enter", row: 1, column: 1 })).toBeNull();
    expect(nextGridCell({ ...sheet, key: "Tab", row: 1, column: 1, atEnd: true })).toBeNull();
  });

  test("handles an empty sheet without moving anywhere", () => {
    expect(nextGridCell({ key: "ArrowDown", row: 0, column: 0, rowCount: 0, columnCount: 3 }))
      .toBeNull();
  });
});
