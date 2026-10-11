import { pool } from "../src/db.js";
import { createSeller, newApiKey } from "../src/auth.js";
import { createItem } from "../src/items.js";

const key = process.env.DEMO_SELLER_KEY || newApiKey();
const seller = await createSeller("Demo Seller", key);

const seedItems = [
  {
    title: "Nike Air Max 90, size 43, barely worn",
    description: "White/grey colorway, worn about 10 times. Minor scuff on left toe, soles clean. Original box included.",
    category: "sneakers",
    condition: "like_new",
    brand: "Nike",
    price_cents: 8500,
    location: "Milan, IT",
    weight_grams: 1200,
    dimensions_mm: "330x230x130",
    shipping_tier: "locker",
    images: [],
    attributes: { size_eu: 43, colorway: "white/grey", has_original_box: true },
  },
  {
    title: "Fjällräven Kånken backpack, 20L, red",
    description: "Classic Kånken in faded red. Zipper runs smooth, one small repair stitch on the strap. Great daily driver.",
    category: "sports",
    condition: "good",
    brand: "Fjällräven",
    price_cents: 4000,
    location: "Berlin, DE",
    weight_grams: 350,
    dimensions_mm: "380x270x170",
    shipping_tier: "locker",
    images: [],
    attributes: { sport: "outdoor", color: "red", volume_liters: 20 },
  },
  {
    title: "Sony A6400 body + 16-50mm kit lens",
    description: "Shutter count ~12k. Screen protector since day one. Includes box, charger, one battery. Sensor clean.",
    category: "electronics",
    condition: "good",
    brand: "Sony",
    price_cents: 52000,
    location: "Barcelona, ES",
    weight_grams: 720,
    dimensions_mm: "200x130x90",
    shipping_tier: "parcel",
    images: [],
    attributes: { model: "A6400", warranty_months: 0, shutter_count: 12000, includes_kit_lens: true },
  },
];

for (const item of seedItems) {
  await createItem({ seller_id: seller.id, currency: "EUR", ...item });
}

console.log(`Seeded ${seedItems.length} items for seller "${seller.display_name}".`);
console.log(`API key: ${key}`);
console.log("Use it as: Authorization: Bearer <key>");
await pool.end();
