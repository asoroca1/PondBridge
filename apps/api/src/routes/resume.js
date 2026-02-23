import { Router } from "express";
import multer from "multer";
import pdfParse from "pdf-parse";
import rateLimit from "express-rate-limit";
import { requireTenant } from "../middleware/tenantContext.js";
import { requireAuth } from "../middleware/requireAuth.js";
import { hasFeature } from "@pondbridge/shared";
import { parseResumeTextToProfile } from "../utils/resume.js";

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

router.post("/parse", resumeParseLimiter, requireAuth, requireTenant, upload.single("resume"), async (req, res) => {
  if (!hasFeature(req.tenant.planTier, "resumeParsing", req.tenant.addOns || [])) {
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

  const parsedPdf = await pdfParse(req.file.buffer);
  const profileData = await parseResumeTextToProfile(parsedPdf.text || "");

  return res.json({ profile: profileData });
});

export default router;
