import { Router } from "express";
import { requireAuth } from "../middleware/requireAuth.js";
import { requireTenant } from "../middleware/tenantContext.js";
import { ProfileModel } from "../db/models/index.js";
import { logTenantEvent } from "../services/analytics.js";

const router = Router({ mergeParams: true });

router.use(requireAuth, requireTenant);

router.get("/", async (req, res) => {
  if (req.tenant?.modules?.search === false) {
    return res.status(403).json({
      error: {
        code: "MODULE_DISABLED",
        message: "Search is disabled for this camp."
      }
    });
  }

  const q = String(req.query.q || "").trim();
  const roleAtCamp = String(req.query.roleAtCamp || "").trim();
  const industry = String(req.query.industry || "").trim();
  const cityState = String(req.query.cityState || "").trim();
  const limit = Math.min(Number(req.query.limit || 30), 100);

  const items = await ProfileModel.search(req.tenant._id, q, {
    roleAtCamp: roleAtCamp || null,
    industry: industry || null,
    cityState: cityState || null,
    limit
  });

  if (q) {
    await logTenantEvent({
      tenantId: req.tenant._id,
      userId: req.user.id,
      eventType: "directory_search",
      metadata: {
        term: q,
        resultCount: items.length
      }
    }).catch(() => {});
  }

  return res.json({
    total: items.length,
    items,
    query: {
      q,
      roleAtCamp,
      industry,
      cityState,
      limit
    }
  });
});

export default router;
