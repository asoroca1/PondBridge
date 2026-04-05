import crypto from "crypto";
import { TenantModel } from "../db/models/index.js";

const MOBILE_APP_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MOBILE_APP_CODE_LENGTH = 6;

function randomMobileAppCode(length = MOBILE_APP_CODE_LENGTH) {
  const bytes = crypto.randomBytes(length);
  let result = "";
  for (let index = 0; index < length; index += 1) {
    result += MOBILE_APP_CODE_ALPHABET[bytes[index] % MOBILE_APP_CODE_ALPHABET.length];
  }
  return result;
}

export async function generateUniqueMobileAppCode() {
  const tenants = await TenantModel.find(
    {},
    {
      select: ["settings"],
      limit: 2000
    }
  );

  const existingCodes = new Set(
    tenants
      .map((tenant) => String(tenant?.settings?.mobileAppCodeLookup || "").trim().toUpperCase())
      .filter(Boolean)
  );

  for (let attempt = 0; attempt < 25; attempt += 1) {
    const candidate = randomMobileAppCode();
    if (!existingCodes.has(candidate)) {
      return candidate;
    }
  }

  return `${randomMobileAppCode(4)}${Date.now().toString(36).slice(-2).toUpperCase()}`;
}

export async function ensureTenantMobileAppCode(tenant = null) {
  if (!tenant?._id) return tenant;

  const currentCode = String(tenant?.settings?.mobileAppCodeLookup || "").trim().toUpperCase();
  if (currentCode) return tenant;

  const nextCode = await generateUniqueMobileAppCode();
  const nextSettings = {
    ...(tenant?.settings && typeof tenant.settings === "object" ? tenant.settings : {}),
    mobileAppCodeLookup: nextCode,
    mobileAppCodeHint: `Generated (${new Date().toLocaleDateString("en-US")})`
  };

  return TenantModel.update(tenant._id, {
    settings: nextSettings
  });
}
