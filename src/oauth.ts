import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { pool } from "./db.js";
import { RateLimiter } from "./rate-limit.js";

// MCP OAuth one-click onboarding — spec THI-11 rev 2.
// This module is new auth surface: every change follows the protected-path
// discipline (spec link + explicit human approval in the PR description).
// PR 2 scope: RFC 9728/8414 discovery metadata + RFC 7591 dynamic client
// registration. The authorize/token/revoke endpoints land in later PRs.

const DCR_HOURLY_LIMIT = Number(process.env.OAUTH_DCR_HOURLY_LIMIT ?? 10);
const MAX_REDIRECT_URIS = 10;
const MAX_REDIRECT_URI_LEN = 2048;
const MAX_CLIENT_NAME_LEN = 200;
const MAX_CLIENT_URI_LEN = 2048;

/** The three loopback literals whose http redirect URIs are accepted (RFC 8252 §7.3). */
export const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Validates and canonicalizes one redirect URI at registration time
 * (spec §2.4): absolute https://, or absolute http:// whose host is a
 * loopback literal. Returns the normalized WHATWG href, or null if invalid.
 */
export function normalizeRedirectUri(raw: string): string | null {
  if (typeof raw !== "string" || raw.length > MAX_REDIRECT_URI_LEN) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const loopbackHttp = u.protocol === "http:" && LOOPBACK_HOSTNAMES.has(u.hostname);
  if (u.protocol !== "https:" && !loopbackHttp) return null;
  if (u.username || u.password || u.hash) return null; // no userinfo/fragments in redirect URIs (RFC 6749 §3.1.2)
  return u.href;
}

export function newClientId(): string {
  return `thgc_${crypto.randomBytes(16).toString("base64url")}`; // 22 b64url chars
}

/** Issuer/base URL: PUBLIC_BASE_URL when set, else the request origin (self-hosters, zero config). */
export function issuerFromRequest(req: Request): string {
  const base = process.env.PUBLIC_BASE_URL?.replace(/\/+$/, "");
  if (base) return base;
  return `${req.protocol}://${req.get("host") ?? "localhost"}`;
}

function protectedResourceDoc(issuer: string) {
  return { resource: `${issuer}/mcp`, authorization_servers: [issuer] };
}

function authorizationServerDoc(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["mcp"],
    authorization_response_iss_parameter_supported: true,
  };
}

interface RegistrationError extends Error {
  status: number;
  code: string;
}

function registrationError(code: string, description: string): RegistrationError {
  return Object.assign(new Error(description), { status: 400, code });
}

export interface ClientRegistration {
  redirect_uris: string[];
  client_name: string | null;
  client_uri: string | null;
}

/** RFC 7591 registration payload validation (spec §2.4). Unknown fields ignored. */
export function validateClientRegistration(body: unknown): ClientRegistration {
  if (typeof body !== "object" || body === null) {
    throw registrationError("invalid_client_metadata", "request body must be a JSON object");
  }
  const raw = body as Record<string, unknown>;

  if (!Array.isArray(raw.redirect_uris) || raw.redirect_uris.length < 1 || raw.redirect_uris.length > MAX_REDIRECT_URIS) {
    throw registrationError("invalid_redirect_uri", `redirect_uris must be an array of 1-${MAX_REDIRECT_URIS} URIs`);
  }
  const redirect_uris: string[] = [];
  for (const candidate of raw.redirect_uris) {
    const normalized = normalizeRedirectUri(candidate);
    if (normalized === null) {
      throw registrationError(
        "invalid_redirect_uri",
        "each redirect_uri must be absolute https://, or http:// on localhost/127.0.0.1/[::1]",
      );
    }
    redirect_uris.push(normalized);
  }

  let client_name: string | null = null;
  if (raw.client_name !== undefined) {
    if (typeof raw.client_name !== "string" || raw.client_name.length > MAX_CLIENT_NAME_LEN) {
      throw registrationError("invalid_client_metadata", `client_name must be a string of at most ${MAX_CLIENT_NAME_LEN} chars`);
    }
    client_name = raw.client_name;
  }

  let client_uri: string | null = null;
  if (raw.client_uri !== undefined) {
    if (typeof raw.client_uri !== "string" || raw.client_uri.length > MAX_CLIENT_URI_LEN) {
      throw registrationError("invalid_client_metadata", `client_uri must be a string of at most ${MAX_CLIENT_URI_LEN} chars`);
    }
    client_uri = raw.client_uri; // stored as data; never rendered as a link (spec §5 row 8)
  }

  return { redirect_uris, client_name, client_uri };
}

/** Mounts the OAuth authorization-server surface (spec §4.1). No CORS headers are ever set on /oauth/*. */
export function mountOauthRoutes(app: Express): void {
  const dcrLimiter = new RateLimiter(DCR_HOURLY_LIMIT, 60 * 60 * 1000);

  const wellKnown =
    (doc: (issuer: string) => unknown) => (req: Request, res: Response): void => {
      res
        .set("Cache-Control", "public, max-age=3600")
        .type("application/json")
        .json(doc(issuerFromRequest(req)));
    };

  app.get(
    ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"],
    wellKnown(protectedResourceDoc),
  );
  app.get(
    ["/.well-known/oauth-authorization-server", "/.well-known/oauth-authorization-server/mcp"],
    wellKnown(authorizationServerDoc),
  );

  app.post("/oauth/register", async (req: Request, res: Response) => {
    res.set("Cache-Control", "no-store");
    if (!dcrLimiter.allow(`dcr:${req.ip ?? "unknown"}`)) {
      res.status(429).json({ error: "rate_limited", retry_after_ms: 60 * 60 * 1000 });
      return;
    }
    let registration: ClientRegistration;
    try {
      registration = validateClientRegistration(req.body);
    } catch (e) {
      const err = e as RegistrationError;
      res.status(err.status).json({ error: err.code, error_description: err.message });
      return;
    }
    try {
      const client_id = newClientId();
      const { rows } = await pool.query<{ created_at: Date }>(
        `INSERT INTO oauth_clients (client_id, client_name, client_uri, redirect_uris)
         VALUES ($1, $2, $3, $4) RETURNING created_at`,
        [client_id, registration.client_name, registration.client_uri, registration.redirect_uris],
      );
      res.status(201).json({
        client_id,
        client_id_issued_at: Math.floor(rows[0].created_at.getTime() / 1000),
        client_name: registration.client_name,
        client_uri: registration.client_uri,
        redirect_uris: registration.redirect_uris,
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: "mcp",
      });
    } catch (e) {
      console.error("oauth: DCR failed:", (e as Error).message);
      res.status(500).json({ error: "server_error" });
    }
  });
}
