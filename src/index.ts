#!/usr/bin/env node
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { buildServer } from "./server.js";
import { sellerFromRequest, sellerFromApiKey } from "./auth.js";
import { RateLimiter } from "./rate-limit.js";
import { pool } from "./db.js";
import { api } from "./routes.js";
import { browsePage, itemPage } from "./web-pages.js";
import { uploadsDir } from "./images.js";
import { securityHeaders } from "./security-headers.js";
import { VERSION } from "./version.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 3000);

/**
 * Two ways to run Thingery:
 *   TRANSPORT=http   (default) — express server: /mcp (Streamable HTTP), website, healthz
 *   TRANSPORT=stdio  — local MCP server over stdin/stdout, for `npx thingery` and
 *                     MCP clients that spawn servers (Claude Desktop, etc.).
 *                     Seller auth in stdio mode comes from the THINGERY_API_KEY env var.
 */
async function runStdio(): Promise<void> {
  const apiKey = process.env.THINGERY_API_KEY;
  const seller = apiKey ? await sellerFromApiKey(apiKey).catch(() => null) : null;
  if (apiKey && !seller) {
    console.error("Warning: THINGERY_API_KEY set but not found in the database — write tools disabled.");
  }
  const server = buildServer({ seller });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Thingery MCP server running on stdio (${seller ? `seller: ${seller.display_name}` : "read-only"})`);
}

function runHttp(): void {
  // Authenticated sellers get a generous bucket; anonymous callers a smaller one.
  const authedLimiter = new RateLimiter(120, 60_000);
  const anonLimiter = new RateLimiter(30, 60_000);

  const app = express();

  // Baseline security headers on every response, before any route (upstream #9).
  app.disable("x-powered-by");
  app.use(securityHeaders);

  // /mcp must be registered before any body-parsing middleware: the SDK
  // consumes the raw request stream itself.
  app.post("/mcp", async (req, res) => {
    const seller = await sellerFromRequest(req).catch(() => null);
    const limitKey = seller ? `key:${seller.id}` : `ip:${req.ip ?? "unknown"}`;
    const limiter = seller ? authedLimiter : anonLimiter;
    if (!limiter.allow(limitKey)) {
      res.status(429).json({ error: "rate limited", retry_after_ms: 60_000 });
      return;
    }

    try {
      const server = buildServer({ seller });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res);
    } catch (e) {
      res.status(500).json({ error: `MCP handling failed: ${(e as Error).message}` });
    }
  });

  // Stateless HTTP transport: only POST is supported.
  app.get("/mcp", (_req, res) => {
    res.status(405).json({ error: "Method not allowed. Use POST with JSON-RPC. Stateles HTTP transport." });
  });
  app.delete("/mcp", (_req, res) => {
    res.status(405).json({ error: "Method not allowed. Stateless HTTP transport." });
  });

  // Browser API (accounts + chat). /mcp above consumes the raw body stream,
  // so the JSON parser starts here and never touches MCP traffic.
  app.use(express.json({ limit: "256kb" }));
  app.use("/api", api);

  app.get("/healthz", async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      res.json({ ok: true, service: "thingery", version: VERSION });
    } catch {
      res.status(503).json({ ok: false, db: "unreachable" });
    }
  });

  app.get("/item/:id", itemPage);
  app.get("/browse", browsePage);

  // Uploaded item images (files under UPLOADS_DIR, served at /img/...)
  app.use("/img", express.static(uploadsDir(), { maxAge: "30d", immutable: true }));

  // Static website + discovery files (llms.txt, robots.txt, .well-known/)
  const websiteDir = path.resolve(__dirname, "..", "website");
  app.use(express.static(websiteDir, { extensions: ["html"] }));

  app.listen(PORT, () => {
    console.log(`Thingery MCP server listening on http://localhost:${PORT}`);
    console.log(`  MCP endpoint:     http://localhost:${PORT}/mcp`);
    console.log(`  Health check:     http://localhost:${PORT}/healthz`);
    console.log(`  Embeddings:       ${process.env.EMBED_API_KEY ? "enabled" : "keyword-only mode"}`);
  });
}

if (process.env.TRANSPORT === "stdio") {
  await runStdio();
} else {
  runHttp();
}
