// Item image storage: files on disk (uploads/items/…), URLs in the items.images array.
// Self-hosted and dependency-free; swap for object storage at federation scale.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pool } from "./db.js";

const EXTENSION_BY_MEDIA_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB per image

export function extensionForMediaType(mediaType: string): string | null {
  return EXTENSION_BY_MEDIA_TYPE[mediaType.toLowerCase()] ?? null;
}

export function uploadsDir(): string {
  return process.env.UPLOADS_DIR ?? path.resolve(process.cwd(), "uploads");
}

/** Strips an optional data-URL prefix ("data:image/png;base64,….") from base64 input. */
export function stripDataUrl(base64: string): string {
  return base64.startsWith("data:") ? base64.slice(base64.indexOf(",") + 1) : base64;
}

/** Validates, stores one image for an item (owner-checked), appends the URL to images[]. */
export async function addItemImage(
  sellerId: string,
  itemId: string,
  data: Buffer,
  mediaType: string,
): Promise<{ url: string } | { error: string }> {
  const ext = extensionForMediaType(mediaType);
  if (!ext) return { error: `unsupported media type '${mediaType}' (use jpeg, png, webp or gif)` };
  if (data.length === 0) return { error: "empty image" };
  if (data.length > MAX_IMAGE_BYTES) return { error: "image too large (max 5 MB)" };

  const owned = await pool.query(`SELECT 1 FROM items WHERE id = $1 AND seller_id = $2`, [itemId, sellerId]);
  if (!owned.rows[0]) return { error: "item not found or not owned by this seller" };

  const dir = path.join(uploadsDir(), "items");
  await mkdir(dir, { recursive: true });
  const name = `${itemId}-${Date.now().toString(36)}.${ext}`;
  await writeFile(path.join(dir, name), data);

  const url = `/img/items/${name}`;
  await pool.query(`UPDATE items SET images = images || $2 WHERE id = $1`, [itemId, [url]]);
  return { url };
}

/** Decodes base64 input (with optional data-URL prefix) and stores it. */
export async function addItemImageBase64(
  sellerId: string,
  itemId: string,
  base64: string,
  mediaType: string,
): Promise<{ url: string } | { error: string }> {
  let data: Buffer;
  try {
    data = Buffer.from(stripDataUrl(base64), "base64");
  } catch {
    return { error: "invalid base64 image data" };
  }
  return addItemImage(sellerId, itemId, data, mediaType);
}
