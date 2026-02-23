import { Router } from "express";
import { constructStripeEventFromRequest, processStripeEvent } from "../services/billing.js";

const router = Router();

router.post("/", async (req, res, next) => {
  try {
    const event = await constructStripeEventFromRequest(req);
    await processStripeEvent(event);

    return res.json({
      received: true,
      eventId: event.id,
      type: event.type
    });
  } catch (error) {
    return next(error);
  }
});

export default router;
