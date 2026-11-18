// Shared safety checks for the API functions. Files starting with "_" are not deployed as routes.

// The caller's IP. Vercel sets x-real-ip itself, so it can't be faked by the client.
export function clientIp(req) {
  return String(req.headers["x-real-ip"] || (req.headers["x-forwarded-for"] || "").split(",").pop() || "unknown").trim();
}

// Block other websites from calling our paid endpoints from their pages.
// (A script outside a browser can still call them; the daily limits below cover that.)
export function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // same-origin GETs and non-browser clients send none
  try {
    const o = new URL(origin).host;
    const extra = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
    return o === req.headers.host || extra.some((e) => { try { return new URL(e).host === o; } catch { return e === o; } });
  } catch { return false; }
}

// Daily limits: per person (IP) and in total for this server instance.
// In-memory, so they reset when Vercel starts a fresh instance. They stop casual abuse;
// the hard money cap is the monthly spend limit you set in the Claude Console.
export function makeLimiter(perIp, total) {
  const hits = new Map();
  let day = "", count = 0;
  return function overLimit(ip) {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== day) { day = today; count = 0; hits.clear(); }
    if (hits.size > 20000) hits.clear();
    const n = (hits.get(ip) || 0) + 1;
    hits.set(ip, n);
    count++;
    return n > perIp || count > total;
  };
}

// Plain text only: no control characters, quotes or angle brackets, trimmed to a length.
export function cleanText(v, max) {
  return String(v ?? "").replace(/[\u0000-\u001f\u007f"<>`\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function isWebUrl(u) {
  try { const x = new URL(u); return x.protocol === "https:" || x.protocol === "http:"; } catch { return false; }
}

export function noStore(res) { res.setHeader("Cache-Control", "no-store"); }
