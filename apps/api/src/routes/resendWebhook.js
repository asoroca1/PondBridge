import { Router } from "express";
import { processResendWebhookRequest } from "../services/resendWebhooks.js";

const router = Router();

router.post("/", async (req, res, next) => {
  try {
    const result = await processResendWebhookRequest(req);
    return res.json(result);
  } catch (error) {
    return next(error);
  }
});

export default router;

