import { Router } from "express";
import { UserModel } from "../db/models/index.js";
import { comparePassword, sanitizeUser, signToken } from "../utils/auth.js";
import { clearAuthCookie, setAuthCookie } from "../utils/authCookie.js";

const router = Router();

router.post("/super/login", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (!email || !password) {
    return res.status(400).json({
      error: { code: "INVALID_INPUT", message: "Email and password are required" }
    });
  }

  const user = await UserModel.findSuperAdmin(email);
  if (!user) {
    return res.status(401).json({
      error: { code: "AUTH_FAILED", message: "Invalid credentials" }
    });
  }

  const matches = await comparePassword(password, user.passwordHash);
  if (!matches) {
    return res.status(401).json({
      error: { code: "AUTH_FAILED", message: "Invalid credentials" }
    });
  }

  const token = signToken(user);
  setAuthCookie(res, token);
  return res.json({ token, user: sanitizeUser(user) });
});

router.post("/super/logout", async (_req, res) => {
  clearAuthCookie(res);
  return res.json({ ok: true });
});

export default router;
