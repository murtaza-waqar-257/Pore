// Vercel serverless function: when a product isn't in Open Beauty Facts, ask Claude to
// search the web for its ingredient list.
//   POST /api/web-ingredients  { brand, name }  or  { barcode }   (GET with the same query params works too, for testing)
// Claude must copy the list from a page it actually found; the function checks that the
// source URL came back in the search results, so a list typed "from memory" is rejected.
// Cost: about 1p per lookup (web search is $10 per 1,000 searches, plus a few tokens).

const MODEL = process.env.CLAUDE_MODEL || "claude-haiku-5-5";
const DAILY_LIMIT = Number(process.env.DAILY_WEB_LOOKUPS_PER_IP || 20);
const hits = new Map();
function overLimit(ip) {
  const key = ip + "|" + new Date().toISOString().slice(0, 10);
  const n = (hits.get(key) || 0) + 1;
  hits.set(key, n);
  if (hits.size > 5000) hits.clear();
  return n > DAILY_LIMIT;
}

function prompt({ brand, name, barcode }) {
  const what = barcode
    ? `the skincare or makeup product with barcode ${barcode} (find out which product it is first)`
    : `the skincare or makeup product "${[brand, name].filter(Boolean).join(" ")}"`;
  return `Find the full ingredient list (INCI list) for ${what}.

Search the web. Good sources: the brand's own website, INCIDecoder, Skinsort, CosDNA, and big retailers (Boots, Sephora, Cult Beauty, Olive Young, YesStyle, Lookfantastic).
Make sure the page is for this exact product, not a different product from the same range.

Rules:
- Copy the ingredient list exactly as it appears on a page you found in your searches, in the same order. Never write it from memory.
- If you can't find a page with the full list for this exact product, say so.

End your reply with only this JSON, nothing after it:
{"found": true or false, "brand": "...", "product_name": "...", "ingredients_text": "comma-separated list, exactly as on the page", "source_url": "the page you copied it from", "source_name": "site name"}`;
}

function lastJSON(text) {
  const matches = text.match(/\{[\s\S]*\}/g);
  if (!matches) return null;
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i];
    const start = m.lastIndexOf('{"found"');
    try { return JSON.parse(start >= 0 ? m.slice(start) : m); } catch {}
  }
  return null;
}

const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return ""; } };

async function callClaude(messages) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 3000,
      output_config: { effort: "low" },
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 4 }],
      messages,
    }),
  });
  const data = await r.json();
  if (!r.ok) throw Object.assign(new Error("Claude API " + r.status), { detail: data && data.error });
  return data;
}

export default async function handler(req, res) {
  if (req.method !== "POST" && req.method !== "GET") return res.status(405).json({ error: "Use POST." });
  if (!process.env.ANTHROPIC_API_KEY) return res.status(500).json({ error: "Web lookup isn't set up yet (missing API key)." });
  const ip = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (overLimit(ip)) return res.status(429).json({ error: "Daily web lookup limit reached. Photograph the ingredient list instead." });

  const body = req.method === "GET" ? (req.query || {}) : (req.body || {});
  const brand = String(body.brand || "").slice(0, 80).trim();
  const name = String(body.name || "").slice(0, 120).trim();
  const barcode = String(body.barcode || "").replace(/\D/g, "").slice(0, 14);
  if (!brand && !name && barcode.length < 8) return res.status(400).json({ error: "Send a product name or a barcode." });

  try {
    const messages = [{ role: "user", content: prompt({ brand, name, barcode }) }];
    let data = await callClaude(messages);
    const blocks = [...(data.content || [])];
    // The server-side search loop can pause; resume it a couple of times at most.
    for (let i = 0; i < 2 && data.stop_reason === "pause_turn"; i++) {
      data = await callClaude([...messages, { role: "assistant", content: blocks.slice() }]);
      blocks.push(...(data.content || []));
    }
    if (data.stop_reason === "refusal") return res.status(200).json({ found: false });

    // Every URL the search actually returned.
    const seenUrls = new Set();
    for (const b of blocks) {
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
        b.content.forEach((r) => r.url && seenUrls.add(r.url));
      }
      if (b.type === "text" && Array.isArray(b.citations)) b.citations.forEach((c) => c.url && seenUrls.add(c.url));
    }
    const text = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const out = lastJSON(text);
    const list = out && String(out.ingredients_text || "").trim();
    const src = out && String(out.source_url || "").trim();
    const srcOk = src && [...seenUrls].some((u) => u === src || host(u) === host(src));
    const listOk = list && list.split(",").length >= 4;

    if (!out || !out.found || !listOk || !srcOk) {
      return res.status(200).json({ found: false, searched: seenUrls.size });
    }
    return res.status(200).json({
      found: true,
      product: {
        brand: String(out.brand || brand).trim() || null,
        name: String(out.product_name || name).trim() || null,
        ingredients: list,
        url: src,
        sourceName: String(out.source_name || host(src)).trim(),
      },
      usage: data.usage,
    });
  } catch (err) {
    console.error(err, err.detail);
    return res.status(502).json({ error: "The web search didn't work just now. Photograph the ingredient list instead." });
  }
}
