import cors from "cors";
import compression from "compression";
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
import eventsRoutes from "./routes/events.js";
import givingRoutes from "./routes/giving.js";
import mobileNotificationsRoutes from "./routes/mobileNotifications.js";
import adminRoutes from "./routes/admin.js";
import adminEventsRoutes from "./routes/adminEvents.js";
import adminGivingRoutes from "./routes/adminGiving.js";
import adminTiersRoutes from "./routes/adminTiers.js";
import superRoutes from "./routes/super.js";
import resumeRoutes from "./routes/resume.js";
import familyTreesRoutes from "./routes/familyTrees.js";
import searchRoutes from "./routes/search.js";
import geoRoutes from "./routes/geo.js";
import tenantsRoutes from "./routes/tenants.js";
import stripeWebhookRoutes from "./routes/stripeWebhook.js";
import resendWebhookRoutes from "./routes/resendWebhook.js";
import clerkWebhookRoutes from "./routes/clerkWebhook.js";
import cloudflareStreamWebhookRoutes from "./routes/cloudflareStreamWebhook.js";
import legacyCedarCompatRoutes from "./routes/legacyCedarCompat.js";
import memberSafetyRoutes from "./routes/memberSafety.js";
import directorCopilotRoutes from "./routes/directorCopilot.js";
import directorEmailAgentRoutes from "./routes/directorEmailAgent.js";
import superCopilotRoutes from "./routes/superCopilot.js";
import { csrfProtection } from "./middleware/csrfProtection.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { attachRequestContext } from "./middleware/requestContext.js";
import { attachRequestLogging } from "./middleware/requestLogging.js";
import { augmentErrorResponses } from "./middleware/responseErrorAugment.js";
import { patchExpressAsyncErrors } from "./utils/patchExpressAsyncErrors.js";
import { getEmailServiceStatus } from "./services/email.js";
import { createReadinessProbe } from "./services/readiness.js";
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
app.use(
  compression({
    threshold: 1024
  })
);

app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store");
  }
  return next();
});
app.use(attachRequestContext);
app.use(augmentErrorResponses);
app.use(attachRequestLogging);

app.use("/api/stripe/webhook", express.raw({ type: "application/json" }), stripeWebhookRoutes);
app.use("/api/webhooks/stripe", express.raw({ type: "application/json" }), stripeWebhookRoutes);
app.use("/api/webhooks/resend", express.raw({ type: "application/json" }), resendWebhookRoutes);
app.use("/api/webhooks/clerk", express.raw({ type: "application/json" }), clerkWebhookRoutes);
app.use(
  "/api/webhooks/cloudflare-stream",
  express.raw({ type: "application/json" }),
  cloudflareStreamWebhookRoutes
);
app.use(express.json({ limit: env.API_JSON_LIMIT }));
app.use(csrfProtection);

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 80,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) =>
    [
      "auth",
      String(req.ip || ""),
      String(req.params?.slug || "global"),
      String(req.path || "")
    ].join(":")
});

const checkReadiness = createReadinessProbe();

// Kept for anything already pointing at it. It reports configuration, which is
// a different question from whether this process can serve a request — use
// /livez and /readyz for that.
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

// Liveness: the event loop is turning. Never touches the database, so a slow
// or unreachable database cannot get a healthy process killed and restarted.
app.get("/livez", (_req, res) => {
  res.json({ ok: true, service: "pondbridge-api", uptimeSeconds: Math.round(process.uptime()) });
});

// Readiness: this process can actually answer. Fails with 503 so the platform
// stops routing to it, without restarting it.
app.get("/readyz", async (_req, res) => {
  const database = await checkReadiness();
  const ok = database.ready;
  res.status(ok ? 200 : 503).json({
    ok,
    service: "pondbridge-api",
    checks: {
      database: {
        ready: database.ready,
        durationMs: database.durationMs,
        ...(database.error ? { error: database.error } : {})
      }
    }
  });
});

app.use("/api/public", publicRoutes);
app.use("/api/auth", authLimiter, superAuthRoutes);
app.use("/api/t/:slug/auth", authLimiter, tenantAuthRoutes);
app.use("/api/t/:slug/access", authLimiter, accessRoutes);
app.use("/api/t/:slug/profiles", profilesRoutes);
app.use("/api/t/:slug/search", searchRoutes);
app.use("/api/t/:slug/geo", geoRoutes);
app.use("/api/t/:slug/events", eventsRoutes);
app.use("/api/t/:slug/giving", givingRoutes);
app.use("/api/t/:slug/mobile-notifications", mobileNotificationsRoutes);
app.use("/api/t/:slug/safety", memberSafetyRoutes);
app.use("/api/t/:slug/admin/copilot", directorCopilotRoutes);
app.use("/api/t/:slug/admin/email-agent", directorEmailAgentRoutes);
app.use("/api/t/:slug", legacyCedarCompatRoutes);
app.use("/api/t/:slug/admin/events", adminEventsRoutes);
app.use("/api/t/:slug/admin/giving", adminGivingRoutes);
app.use("/api/t/:slug/admin/tiers", adminTiersRoutes);
app.use("/api/t/:slug/admin", adminRoutes);
app.use("/api/t/:slug/resume", resumeRoutes);
app.use("/api/t/:slug/family-trees", familyTreesRoutes);
app.use("/api/super/copilot", superCopilotRoutes);
app.use("/api/super", superRoutes);
app.use("/api/tenants", tenantsRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
