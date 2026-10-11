import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(__dirname, "..", "db", "schema.sql");

const schema = readFileSync(schemaPath, "utf8");
await pool.query(schema);
console.log("Schema applied:", schemaPath);
await pool.end();
