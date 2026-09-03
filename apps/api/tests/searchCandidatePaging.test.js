import { describe, expect, test } from "@jest/globals";
import { paginateCandidates } from "../src/db/models/ProfileModel.js";

// A directory of `size` members, served in pages the way PostgREST ranges do.
const directory = (size) => {
  const calls = [];
  const fetchPage = async (from, to) => {
    calls.push([from, to]);
    const rows = [];
    for (let i = from; i <= to && i < size; i += 1) rows.push({ id: i });
    return rows;
  };
  return { fetchPage, calls };
};

describe("paginateCandidates", () => {
  test("a camp smaller than one page costs a single request", async () => {
    const { fetchPage, calls } = directory(358);
    const rows = await paginateCandidates(fetchPage, 25000, 1000);
    expect(rows).toHaveLength(358);
    expect(calls).toEqual([[0, 999]]);
  });

  test("returns every member of a camp larger than one page", async () => {
    const { fetchPage, calls } = directory(2500);
    const rows = await paginateCandidates(fetchPage, 25000, 1000);
    expect(rows).toHaveLength(2500);
    expect(calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999]
    ]);
    // No duplicates and nothing skipped.
    expect(new Set(rows.map((r) => r.id)).size).toBe(2500);
  });

  test("an exact multiple of the page size does not lose the last page", async () => {
    const { fetchPage } = directory(2000);
    const rows = await paginateCandidates(fetchPage, 25000, 1000);
    expect(rows).toHaveLength(2000);
  });

  test("never fetches beyond the requested limit", async () => {
    const { fetchPage, calls } = directory(10000);
    const rows = await paginateCandidates(fetchPage, 1500, 1000);
    expect(rows).toHaveLength(1500);
    expect(calls).toEqual([
      [0, 999],
      [1000, 1499]
    ]);
  });

  test("an empty directory returns nothing after one request", async () => {
    const { fetchPage, calls } = directory(0);
    const rows = await paginateCandidates(fetchPage, 25000, 1000);
    expect(rows).toEqual([]);
    expect(calls).toEqual([[0, 999]]);
  });

  test("the old single-page cap would have truncated; paging does not", async () => {
    const { fetchPage } = directory(1500);
    const capped = await paginateCandidates(fetchPage, 1000, 1000);
    const full = await paginateCandidates(directory(1500).fetchPage, 25000, 1000);
    expect(capped).toHaveLength(1000);
    expect(full).toHaveLength(1500);
  });
});
