function parseUrl(value) {
  try {
    return new URL(String(value || "").trim());
  } catch {
    return null;
  }
}

export function getSupabaseProjectRefFromApiUrl(value) {
  const parsed = parseUrl(value);
  if (!parsed) return "";
  const parts = parsed.hostname.toLowerCase().split(".");
  if (parts.length >= 3 && parts.at(-2) === "supabase" && parts.at(-1) === "co") {
    return parts[0] === "db" ? parts[1] || "" : parts[0] || "";
  }
  return "";
}

export function getSupabaseProjectRefFromDatabaseUrl(value) {
  const parsed = parseUrl(value);
  if (!parsed) return "";
  const hostParts = parsed.hostname.toLowerCase().split(".");
  if (
    hostParts[0] === "db" &&
    hostParts.at(-2) === "supabase" &&
    hostParts.at(-1) === "co"
  ) {
    return hostParts[1] || "";
  }

  const username = decodeURIComponent(parsed.username || "");
  if (username.startsWith("postgres.")) return username.slice("postgres.".length);
  return "";
}

export function assertMatchingSupabaseProject({ apiUrl, databaseUrl } = {}) {
  const apiRef = getSupabaseProjectRefFromApiUrl(apiUrl);
  const databaseRef = getSupabaseProjectRefFromDatabaseUrl(databaseUrl);
  if (apiRef && databaseRef && apiRef !== databaseRef) {
    throw new Error(
      "FATAL: SUPABASE_URL and SUPABASE_DB_URL point to different Supabase projects. " +
        "Use one reviewed project per environment before starting the API or running migrations."
    );
  }
  return { apiRef, databaseRef, verified: Boolean(apiRef && databaseRef) };
}
