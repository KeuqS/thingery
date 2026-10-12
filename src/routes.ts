// HTTP API for the browser pages: account signup/login and the chat endpoint.
// Mounted after the raw-body /mcp route; express.json() applies from here on.

import express, { type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import {
  accountByEmail,
  createAccount,
  sellerFromSession,
  sessionCookieOptions,
  signSession,
  verifyPassword,
  SESSION_COOKIE,
} from "./auth.js";
import { chatTurn, chatConfigured, type ChatMessage } from "./chat.js";
import { RateLimiter } from "./rate-limit.js";

const authAttemptLimiter = new RateLimiter(10, 60 * 60_000); // 10 signups/logins per IP per hour
const chatAnonLimiter = new RateLimiter(10, 60 * 60_000); // 10 anonymous chats per IP per hour
const chatAuthedLimiter = new RateLimiter(60, 60 * 60_000); // 60 logged-in chats per hour

function clientIp(req: Request): string {
  return req.ip ?? "unknown";
}

export const api = express.Router();

// --- accounts --------------------------------------------------------------

const signupSchema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(8).max(200),
  name: z.string().min(1).max(80).optional(),
});

api.post("/signup", async (req: Request, res: Response) => {
  if (!authAttemptLimiter.allow(`ip:${clientIp(req)}`)) {
    res.status(429).json({ error: "Too many attempts. Try again later." });
    return;
  }
  const parsed = signupSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Valid email and a password of at least 8 characters are required." });
    return;
  }
  const email = parsed.data.email.toLowerCase();
  if (await accountByEmail(email)) {
    res.status(409).json({ error: "An account with this email already exists." });
    return;
  }
  try {
    const account = await createAccount(email, parsed.data.password, parsed.data.name ?? email.split("@")[0]);
    res.cookie(SESSION_COOKIE, signSession(account.id), sessionCookieOptions());
    res.json({ seller: { name: account.display_name, email: account.email, api_key: account.api_key } });
  } catch (e) {
    res.status(500).json({ error: `Signup failed: ${(e as Error).message}` });
  }
});

api.post("/login", async (req: Request, res: Response) => {
  if (!authAttemptLimiter.allow(`ip:${clientIp(req)}`)) {
    res.status(429).json({ error: "Too many attempts. Try again later." });
    return;
  }
  const { email, password } = req.body as { email?: string; password?: string };
  const account = email ? await accountByEmail(email.toLowerCase()) : null;
  if (!account || !verifyPassword(password ?? "", (account as { password_hash?: string }).password_hash ?? null)) {
    res.status(401).json({ error: "Wrong email or password." });
    return;
  }
  res.cookie(SESSION_COOKIE, signSession(account.id), sessionCookieOptions());
  res.json({ seller: { name: account.display_name, email: account.email, api_key: account.api_key } });
});

api.post("/logout", (_req: Request, res: Response) => {
  res.clearCookie(SESSION_COOKIE, sessionCookieOptions());
  res.json({ ok: true });
});

api.get("/me", async (req: Request, res: Response) => {
  const seller = await sellerFromSession(req).catch(() => null);
  if (!seller) {
    res.json({ seller: null });
    return;
  }
  res.json({ seller: { name: seller.display_name, api_key: seller.api_key } });
});

// --- chat -------------------------------------------------------------------

const chatSchema = z.object({
  message: z.string().min(1).max(4000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(8000) }))
    .max(24)
    .default([]),
});

api.post("/chat", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const seller = await sellerFromSession(req).catch(() => null);
    const limiter = seller ? chatAuthedLimiter : chatAnonLimiter;
    const key = seller ? `seller:${seller.id}` : `ip:${clientIp(req)}`;
    if (!limiter.allow(key)) {
      res.status(429).json({
        error: seller
          ? "Chat limit reached for this hour."
          : "Anonymous chat limit reached — create an account (free) to keep going.",
      });
      return;
    }
    if (!chatConfigured()) {
      res.status(503).json({
        error: "Chat is not configured on this server yet. The MCP endpoint at /mcp works as usual.",
      });
      return;
    }
    const parsed = chatSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Message required (max 4000 characters)." });
      return;
    }
    const reply = await chatTurn(parsed.data.history as ChatMessage[], parsed.data.message, seller);
    res.json({ reply });
  } catch (e) {
    next(e);
  }
});

api.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("api error:", err.message);
  res.status(500).json({ error: "Something went wrong. Please try again." });
});
