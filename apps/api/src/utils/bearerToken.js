// Keep authentication and CSRF exemption parsing identical. HTTP auth schemes
// are case-insensitive; a missing credential must still use cookie protection.
export function readBearerToken(req) {
  const header = String(req?.headers?.authorization || "").trim();
  const match = /^Bearer[ \t]+([^\s]+)$/i.exec(header);
  return match ? match[1] : "";
}
