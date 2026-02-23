import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import { corsOriginDelegate } from "./config/cors.js";
import publicRoutes from "./routes/public.js";
import tenantAuthRoutes from "./routes/tenantAuth.js";
import accessRoutes from "./routes/access.js";
import superAuthRoutes from "./routes/superAuth.js";
import profilesRoutes from "./routes/profiles.js";
import adminRoutes from "./routes/admin.js";
import superRoutes from "./routes/super.js";
import resumeRoutes from "./routes/resume.js";
import familyTreesRoutes from "./routes/familyTrees.js";
import searchRoutes from "./routes/search.js";
import tenantsRoutes from "./routes/tenants.js";
import stripeWebhookRoutes from "./routes/stripeWebhook.js";
import legacyCedarCompatRoutes from "./routes/legacyCedarCompat.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { patchExpressAsyncErrors } from "./utils/patchExpressAsyncErrors.js";
import { getEmailServiceStatus } from "./services/email.js";
import { getR2ServiceStatus } from "./services/objectStorage.js";

patchExpressAsyncErrors();

const app = express();
app.set("trust proxy", env.TRUST_PROXY_HOPS);

app.use(
  helmet({
    hsts:
      env.NODE_ENV === "production"
        ? {
            maxAge: 31536000,
            includeSubDomains: true,
            preload: true
          }
        : false
  })
);
app.use(
  cors({
    origin: corsOriginDelegate,
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Tenant-Slug"]
  })
);

app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store");
  }
  return next();
});

app.use("/api/webhooks/stripe", express.raw({ type: "application/json" }), stripeWebhookRoutes);
app.use(express.json({ limit: env.API_JSON_LIMIT }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 80,
  standardHeaders: true,
  legacyHeaders: false
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "pondbridge-api",
    integrations: {
      email: getEmailServiceStatus(),
      r2: getR2ServiceStatus()
    }
  });
});

app.use("/api/public", publicRoutes);
app.use("/api/auth", authLimiter, superAuthRoutes);
app.use("/api/t/:slug/auth", authLimiter, tenantAuthRoutes);
app.use("/api/t/:slug/access", authLimiter, accessRoutes);
app.use("/api/t/:slug/profiles", profilesRoutes);
app.use("/api/t/:slug/search", searchRoutes);
app.use("/api/t/:slug", legacyCedarCompatRoutes);
app.use("/api/t/:slug/admin", adminRoutes);
app.use("/api/t/:slug/resume", resumeRoutes);
app.use("/api/t/:slug/family-trees", familyTreesRoutes);
app.use("/api/super", superRoutes);
app.use("/api/tenants", tenantsRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
