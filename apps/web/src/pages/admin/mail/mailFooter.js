// Signature / footer helpers shared by the composer and the signature editor.

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeFooterField(value = "", max = 140, { trimMode = "both" } = {}) {
  const clipped = String(value || "").slice(0, max);
  if (trimMode === "none") return clipped;
  if (trimMode === "start") return clipped.trimStart();
  if (trimMode === "end") return clipped.trimEnd();
  return clipped.trim();
}

export function normalizeFooter(value = {}, fallback = {}) {
  const source = value && typeof value === "object" ? value : {};
  const base = fallback && typeof fallback === "object" ? fallback : {};
  const senderEmailRaw = normalizeFooterField(source.senderEmail ?? base.senderEmail ?? "", 160).toLowerCase();
  return {
    headerTagline: normalizeFooterField(source.headerTagline ?? base.headerTagline ?? "Community update", 72) || "Community update",
    signOff: normalizeFooterField(source.signOff ?? base.signOff ?? "Warmly,", 80) || "Warmly,",
    // Names keep leading whitespace while typing so the caret does not jump.
    senderName: normalizeFooterField(source.senderName ?? base.senderName ?? "", 120, { trimMode: "start" }),
    senderRole: normalizeFooterField(source.senderRole ?? base.senderRole ?? "Director", 120, { trimMode: "start" }),
    senderEmail: EMAIL_REGEX.test(senderEmailRaw) ? senderEmailRaw : "",
    senderPhone: normalizeFooterField(source.senderPhone ?? base.senderPhone ?? "", 48),
    showLogo: source.showLogo !== undefined ? Boolean(source.showLogo) : base.showLogo !== false,
    logoUrl: normalizeFooterField(source.logoUrl ?? base.logoUrl ?? "", 1200)
  };
}

export function normalizeFooterPresets(presets = [], fallbackFooter = {}) {
  const source = Array.isArray(presets) ? presets : [];
  const fallback = normalizeFooter(fallbackFooter, {});
  const normalized = [];
  const seen = new Set();
  for (let index = 0; index < source.length; index += 1) {
    const item = source[index] || {};
    const id = String(item?.id || "").trim().slice(0, 90) || `footer_${index + 1}`;
    const name = String(item?.name || "").trim().slice(0, 72);
    if (!name || seen.has(id)) continue;
    seen.add(id);
    normalized.push({ id, name, footer: normalizeFooter(item?.footer || {}, fallback), updatedAt: String(item?.updatedAt || "") });
    if (normalized.length >= 20) break;
  }
  if (!normalized.length) {
    normalized.push({ id: "default_footer", name: "Default signature", footer: fallback, updatedAt: "" });
  }
  return normalized;
}

function composeName(value = {}) {
  const full = [String(value?.firstName || "").trim(), String(value?.lastName || "").trim()]
    .filter(Boolean)
    .join(" ")
    .trim();
  return full || String(value?.name || "").trim();
}

export function createFallbackFooter({ tenant = null, user = null } = {}) {
  const isDirector = Array.isArray(user?.roles)
    && user.roles.some((role) => String(role || "").toLowerCase() === "tenant_admin");
  return normalizeFooter(
    {
      signOff: "Warmly,",
      headerTagline: "Community update",
      senderName: composeName(user),
      senderRole: isDirector ? "Director" : "Admin",
      senderEmail: String(user?.email || tenant?.content?.contactEmail || "").trim().toLowerCase(),
      senderPhone: "",
      showLogo: true,
      logoUrl: String(tenant?.theme?.logoUrl || "").trim()
    },
    {}
  );
}
