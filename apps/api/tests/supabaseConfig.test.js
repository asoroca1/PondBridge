import {
  assertMatchingSupabaseProject,
  getSupabaseProjectRefFromApiUrl,
  getSupabaseProjectRefFromDatabaseUrl
} from "../src/utils/supabaseConfig.js";

describe("Supabase environment wiring", () => {
  test("extracts project references from API, direct DB, and pooler URLs", () => {
    expect(getSupabaseProjectRefFromApiUrl("https://sampleproject.supabase.co"))
      .toBe("sampleproject");
    expect(getSupabaseProjectRefFromDatabaseUrl(
      "postgresql://postgres:password@db.sampleproject.supabase.co:5432/postgres"
    )).toBe("sampleproject");
    expect(getSupabaseProjectRefFromDatabaseUrl(
      "postgresql://postgres.sampleproject:password@aws-0-us-east-1.pooler.supabase.com:6543/postgres"
    )).toBe("sampleproject");
  });

  test("rejects API and database URLs for different projects", () => {
    expect(() => assertMatchingSupabaseProject({
      apiUrl: "https://firstproject.supabase.co",
      databaseUrl: "postgresql://postgres:password@db.secondproject.supabase.co/postgres"
    })).toThrow(/different Supabase projects/);
  });

  test("allows a matching project and local development URLs", () => {
    expect(assertMatchingSupabaseProject({
      apiUrl: "https://sameproject.supabase.co",
      databaseUrl: "postgresql://postgres.sameproject:password@pooler.supabase.com/postgres"
    })).toEqual({ apiRef: "sameproject", databaseRef: "sameproject", verified: true });
    expect(assertMatchingSupabaseProject({
      apiUrl: "http://127.0.0.1:54321",
      databaseUrl: "postgresql://postgres:postgres@127.0.0.1:54322/postgres"
    }).verified).toBe(false);
  });
});
