// Vercel serverless function: reads a product photo with Claude.
// Returns the ingredient list if one is printed, plus the brand, product name and barcode digits if visible.
// Needs the environment variable ANTHROPIC_API_KEY (set it in Vercel, never in the page).
// Optional: CLAUDE_MODEL (defaults to claude-haiku-5-5, the cheapest model).

import { clientIp, sameOrigin, makeLimiter, cleanText, noStore } from "./_guard.js";

const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-5-5";
const MAX_IMAGE_CHARS = 6_000_000; // ~4.5 MB of base64; the page sends ~300 KB
const DAILY_LIMIT = Number(process.env.DAILY_SCANS_PER_IP || 40);

const overLimit = makeLimiter(DAILY_LIMIT, Number(process.env.DAILY_SCANS_TOTAL || 3000));

const SCHEMA = {
  type: "object",
  properties: {
    found: { type: "boolean" },
    ingredients: { type: "array", items: { type: "string" } },
    brand: { type: "string" },
    product_name: { type: "string" },
    barcode: { type: "string" },
  },
  required: ["found", "ingredients", "brand", "product_name", "barcode"],
  additionalProperties: false,
};

const PROMPT = `This photo shows a skincare or makeup product: either its ingredient list, or the front or back of the pack.
1. If an ingredient list is readable, copy every ingredient name exactly as printed, in order, one per array item, and set found to true.
   Keep INCI names as written, including brackets like "Cocos Nucifera (Coconut) Oil" and colour codes like "CI 77891".
   Include items after "may contain" or "+/-". Leave out marketing text, directions, warnings and percentages.
   If the list is printed in several languages, use the INCI/English one only.
   If no ingredient list is readable, set found to false and return an empty array. Never guess ingredients that aren't printed.
2. Copy the brand and product name exactly as printed on the pack (for example brand "CeraVe", product_name "Moisturising Cream"). Use "" if not visible.
3. If a barcode's digits are printed and fully readable, copy them with no spaces. Otherwise use "".`;

export default async function handler(req, res) {
  noStore(res);
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!sameOrigin(req)) return res.status(403).json({ error: "Not allowed." });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "Photo reading isn't set up yet (missing API key)." });

  if (overLimit(clientIp(req))) return res.status(429).json({ error: "Daily scan limit reached. Type the ingredients instead, or try again tomorrow." });

  const image = req.body && req.body.image;
  const m = typeof image === "string" && image.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return res.status(400).json({ error: "Send the photo as a JPEG, PNG, WebP or GIF." });
  if (image.length > MAX_IMAGE_CHARS) return res.status(413).json({ error: "That photo is too large. Try again with a smaller one." });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        thinking: { type: "disabled" },
        output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
        messages: [{
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: m[1], data: m[2] } },
            { type: "text", text: PROMPT },
          ],
        }],
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      console.error("Claude API error", r.status, data && data.error);
      return res.status(502).json({ error: "The label couldn't be read right now. Type the ingredients instead." });
    }
    if (data.stop_reason === "refusal") return res.status(200).json({ ingredients: [], brand: "", product_name: "", barcode: "", message: "This photo couldn't be read. Try a closer photo." });
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    let parsed;
    try { parsed = JSON.parse(text); } catch { parsed = { found: false, ingredients: [] }; }
    const ingredients = (Array.isArray(parsed.ingredients) ? parsed.ingredients : []).map((s) => cleanText(s, 120)).filter(Boolean).slice(0, 150);
    const barcode = String(parsed.barcode || "").replace(/\D/g, "");
    return res.status(200).json({
      ingredients: parsed.found ? ingredients : [],
      brand: cleanText(parsed.brand, 80),
      product_name: cleanText(parsed.product_name, 120),
      barcode: barcode.length >= 8 && barcode.length <= 14 ? barcode : "",
    });
  } catch (err) {
    console.error("read-label failed", err && err.message);
    return res.status(502).json({ error: "The label couldn't be read right now. Type the ingredients instead." });
  }
}
