export function normalizeIpAddress(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  const first = raw.split(",")[0].trim();
  if (!first) return "";
  if (first === "::1") return "127.0.0.1";
  if (first.startsWith("::ffff:")) return first.slice(7);
  return first;
}
