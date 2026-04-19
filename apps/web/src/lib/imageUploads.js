import { requestJson } from "./http.js";

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml"
]);

function inferImageType(file = null) {
  const explicitType = String(file?.type || "").trim().toLowerCase();
  if (ALLOWED_IMAGE_TYPES.has(explicitType)) return explicitType;

  const extension = String(file?.name || "")
    .trim()
    .split(".")
    .pop()
    ?.toLowerCase();

  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "gif") return "image/gif";
  if (extension === "webp") return "image/webp";
  if (extension === "svg") return "image/svg+xml";
  return "";
}

export async function uploadTenantImage({ slug = "", token = "", file = null, scope = "avatar" } = {}) {
  const safeSlug = String(slug || "").trim().toLowerCase();
  if (!safeSlug) {
    throw new Error("Missing tenant context for upload.");
  }
  if (!file) {
    throw new Error("Select an image to upload.");
  }

  const fileType = inferImageType(file);
  if (!fileType) {
    throw new Error("Please upload a PNG, JPG, WebP, GIF, or SVG image.");
  }

  const presign = await requestJson(`/api/t/${safeSlug}/uploads/presign`, {
    method: "POST",
    token,
    body: {
      fileName: file.name || `upload-${Date.now()}`,
      fileType,
      fileSize: Number(file.size || 0),
      scope
    }
  });

  const headers = presign?.headers && typeof presign.headers === "object" ? presign.headers : undefined;
  const uploadResponse = await fetch(String(presign?.uploadUrl || ""), {
    method: "PUT",
    ...(headers ? { headers } : {}),
    body: file
  });

  if (!uploadResponse.ok) {
    throw new Error("Image upload failed.");
  }

  const objectUrl = String(presign?.objectUrl || presign?.publicUrl || "").trim();
  if (!objectUrl) {
    throw new Error("Upload finished but no image URL was returned.");
  }

  return objectUrl;
}
