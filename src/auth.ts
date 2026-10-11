import type { Request } from "express";
import crypto from "node:crypto";
import { pool, type SellerRow } from "./db.js";

export function newApiKey(): string {
  return `thg_${crypto.randomBytes(24).toString("base64url")}`;
}

export async function createSeller(displayName: string, apiKey: string): Promise<SellerRow> {
  const { rows } = await pool.query<SellerRow>(
    `INSERT INTO sellers (api_key, display_name) VALUES ($1, $2) RETURNING id, api_key, display_name`,
    [apiKey, displayName],
  );
  return rows[0];
}

/** Resolves the caller's seller from an Authorization: Bearer thg_... header. */
export async function sellerFromRequest(req: Request): Promise<SellerRow | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  const key = header.slice("Bearer ".length).trim();
  if (!key.startsWith("thg_")) return null;
  const { rows } = await pool.query<SellerRow>(
    `SELECT id, api_key, display_name FROM sellers WHERE api_key = $1`,
    [key],
  );
  return rows[0] ?? null;
}
