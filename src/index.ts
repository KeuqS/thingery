import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer } from "./server.js";
import { sellerFromRequest } from "./auth.js";
import { RateLimiter } from "./rate-limit.js";
import { pool } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT ?? 3000);

// Authenticated sellers get a generous bucket; anonymous callers a smaller one.
const authedLimiter = new RateLimiter(120, 60_000);
const anonLimiter = new RateLimiter(30, 60_000);

const app = express();

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

app.get("/healthz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, service: "thingery", version: "0.1.0" });
  } catch {
    res.status(503).json({ ok: false, db: "unreachable" });
  }
});

app.get("/item/:id", (req, res) => {
  // Lightweight redirect page; agents use get_item for the full record.
  res.redirect(`/index.html#item-${req.params.id}`);
});

// Static website + discovery files (llms.txt, robots.txt, .well-known/)
const websiteDir = path.resolve(__dirname, "..", "website");
app.use(express.static(websiteDir, { extensions: ["html"] }));

app.listen(PORT, () => {
  console.log(`Thingery MCP server listening on http://localhost:${PORT}`);
  console.log(`  MCP endpoint:     http://localhost:${PORT}/mcp`);
  console.log(`  Health check:     http://localhost:${PORT}/healthz`);
  console.log(`  Embeddings:       ${process.env.EMBED_API_KEY ? "enabled" : "keyword-only mode"}`);
});
