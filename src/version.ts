import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolves in dev (src/../), in the Docker image (/app/../), and in the npm package.
export const VERSION: string = (
  JSON.parse(
    readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8"),
  ) as { version: string }
).version;
