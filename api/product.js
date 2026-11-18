// Vercel serverless function: looks a product up in Open Beauty Facts (free, open data, ODbL).
//   GET /api/product?barcode=3337875597197   -> one product by barcode
//   GET /api/product?q=cerave moisturising cream -> best text-search match with an ingredient list
// Open Beauty Facts asks apps to identify themselves with a User-Agent and keep to
// ~15 product reads and ~10 searches a minute.
import { cleanText } from "./_guard.js";

const UA = `pore/1.0 (${process.env.CONTACT_EMAIL || "pore-app@example.com"})`;
const BASE = "https://world.openbeautyfacts.org";
const FIELDS = "code,product_name,product_name_en,brands,ingredients_text,ingredients_text_en,ingredients_text_fr";

function pick(p) {
  if (!p) return null;
  const ingredients = p.ingredients_text_en || p.ingredients_text || p.ingredients_text_fr || "";
  return {
    barcode: p.code || null,
    name: cleanText(p.product_name_en || p.product_name, 120) || null,
    brand: cleanText((p.brands || "").split(",")[0], 80) || null,
    ingredients: String(ingredients).replace(/[\u0000-\u001f<>]/g, " ").trim().slice(0, 6000),
    url: /^\d{8,14}$/.test(String(p.code || "")) ? `${BASE}/product/${p.code}` : null,
  };
}

async function getJSON(url) {
  const r = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("Open Beauty Facts answered " + r.status);
  return r.json();
}

export default async function handler(req, res) {
  const barcode = String(req.query.barcode || "").replace(/\D/g, "");
  const q = cleanText(req.query.q, 120);
  // Cache good answers at Vercel's edge for a day; never cache errors.
  const ok = (body) => { res.setHeader("Cache-Control", "s-maxage=86400, stale-while-revalidate=604800"); return res.status(200).json(body); };
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET") return res.status(405).json({ error: "Use GET." });

  try {
    if (barcode) {
      if (barcode.length < 8 || barcode.length > 14) return res.status(400).json({ error: "That doesn't look like a product barcode (8–14 digits)." });
      const data = await getJSON(`${BASE}/api/v2/product/${barcode}.json?fields=${FIELDS}`);
      const p = data && data.status === 1 ? pick(data.product) : null;
      return ok({ found: !!(p && p.ingredients), product: p });
    }
    if (q) {
      const url = `${BASE}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=10&fields=${FIELDS}`;
      const data = await getJSON(url);
      const products = ((data && data.products) || []).map(pick).filter((p) => p && p.ingredients);
      return ok({ found: products.length > 0, product: products[0] || null });
    }
    return res.status(400).json({ error: "Send a barcode or a product name." });
  } catch (err) {
    console.error("product lookup failed", err && err.message);
    return res.status(502).json({ error: "The product database isn't answering right now. Try again, or photograph the ingredient list." });
  }
}
