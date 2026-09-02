import { Router } from "express";
import multer from "multer";
import pdfParse from "pdf-parse";
import rateLimit from "express-rate-limit";
import { requireTenantAuthScope } from "../middleware/tenantAccess.js";
import { hasFeature } from "@pondbridge/shared";
import { getResumeParserDisclosure, parseProfilePdfTextToProfile } from "../utils/resume.js";
import { resolveTenantFeatureTier } from "../services/billingState.js";

const router = Router({ mergeParams: true });
const resumeParseLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: {
      code: "RATE_LIMITED",
      message: "Too many resume parsing attempts. Please try again later."
    }
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const isPdf =
      file.mimetype === "application/pdf" || file.originalname.toLowerCase().endsWith(".pdf");
    if (!isPdf) return cb(new Error("PDF files only"));
    return cb(null, true);
  }
});

function hasPdfSignature(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 5) return false;
  return buffer.subarray(0, Math.min(buffer.length, 1024)).includes(Buffer.from("%PDF-"));
}

router.post(
  "/parse",
  resumeParseLimiter,
  ...requireTenantAuthScope,
  upload.single("resume"),
  async (req, res, next) => {
  try {
  if (!hasFeature(resolveTenantFeatureTier(req.tenant), "resumeParsing", req.tenant.addOns || [])) {
    return res.status(403).json({
      error: {
        code: "FEATURE_BLOCKED_BY_PLAN",
        message: "Resume parsing is a Premium feature"
      }
    });
  }

  if (!req.file?.buffer) {
    return res.status(400).json({
      error: {
        code: "FILE_REQUIRED",
        message: "Upload a PDF file under field 'resume'"
      }
    });
  }

  if (!hasPdfSignature(req.file.buffer)) {
    return res.status(400).json({
      error: {
        code: "INVALID_PDF",
        message: "That file is not a valid PDF. Export the LinkedIn profile or resume as a PDF and try again."
      }
    });
  }

  const parsedPdf = await pdfParse(req.file.buffer);
  const pageCount = Math.max(0, Math.trunc(Number(parsedPdf?.numpages || 0)));
  if (pageCount > 40) {
    return res.status(400).json({
      error: {
        code: "PROFILE_PDF_TOO_LONG",
        message: "Use a LinkedIn profile or resume PDF with 40 pages or fewer."
      }
    });
  }
  const result = await parseProfilePdfTextToProfile(parsedPdf.text || "", {
    documentType: req.body?.documentType || "auto",
    context: {
      tenantId: String(req.tenant?._id || ""),
      actorUserId: String(req.user?.id || ""),
      requestId: String(req.requestId || "")
    }
  });

  return res.json({
    profile: result.profile,
    document: {
      type: result.documentType,
      pageCount,
      parserEngine: result.parserEngine,
      degraded: Boolean(result.degraded)
    },
    ai: result.parserEngine === "openai"
      ? { generationId: result.generationId, usage: result.usage }
      : null,
    processing: getResumeParserDisclosure({ parserEngine: result.parserEngine })
  });
  } catch (error) {
    return next(error);
  }
  }
);

export default router;
