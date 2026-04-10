import { Router } from "express";
import { processClerkWebhookRequest } from "../services/clerkWebhooks.js";

const router = Router();

router.post("/", async (req, res, next) => {
  try {
    const result = await processClerkWebhookRequest(req);
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

export default router;
