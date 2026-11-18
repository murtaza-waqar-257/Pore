// Ingredient matching. No AI: plain text rules against data.js.
(function (root) {
  function norm(s) {
    return String(s)
      .toLowerCase()
      .normalize("NFKD").replace(/[̀-ͯ]/g, "")
      .replace(/[*†‡®™]/g, "")
      .replace(/\bdioctyl\b/g, "diethylhexyl")
      .replace(/\boctyl (?=[a-z])/g, "ethylhexyl ")
      .replace(/\bc\.?\s?i\.?\s?(\d{5})\b/g, "ci $1")
      .replace(/[‐-―]/g, "-")
      .replace(/\s*-\s*/g, "-")
      .replace(/[.;:]+$/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }
  // Looser key: also drops "seed"/"fruit" and spacing around slashes.
  function loose(s) {
    return norm(s).replace(/\b(seed|fruit)\b/g, " ").replace(/\s*\/\s*/g, "/").replace(/\s+/g, " ").trim();
  }

  function buildIndex(data) {
    const exact = new Map();
    const looseMap = new Map();
    const add = (key, entry) => {
      const k = norm(key), l = loose(key);
      if (k && !exact.has(k)) exact.set(k, entry);
      if (l && !looseMap.has(l)) looseMap.set(l, entry);
    };
    data.W.forEach((r) => {
      const e = { kind: "watch", name: r[0], rating: r[1], risk: r[2], aliases: r[3], type: r[4], evidence: r[5], note: r[6], acne: r[7] };
      [e.name, ...e.aliases].forEach((a) => add(a, e));
    });
    data.F.forEach((r) => {
      const e = { kind: "fine", name: r[0], rating: r[1], evidence: r[2], note: r[3], aliases: r[4] };
      [e.name, ...e.aliases].forEach((a) => add(a, e));
    });
    return { exact, looseMap };
  }

  // Split a pasted or read ingredient list into items, keeping label order.
  function splitList(text) {
    let t = String(text || "")
      .replace(/\r/g, "\n")
      .replace(/^\s*(ingredients|ingrédients|inci|composition)\s*[:\-]?/i, "")
      .replace(/[\[\]]/g, ",")
      .replace(/\(\s*\+\/-\s*\)|\+\/-/g, ",")
      .replace(/\b(may contain|peut contenir)\b\s*:?/gi, ",");
    // Split on commas, semicolons, bullets and newlines, but not inside brackets.
    const out = [];
    let depth = 0, cur = "";
    for (const ch of t) {
      if (ch === "(" || ch === "[") depth++;
      if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
      if (depth === 0 && /[,;\n•·]/.test(ch)) { out.push(cur); cur = ""; continue; }
      cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.replace(/^[\s:\-–—]+/, "").replace(/[\s.:]+$/, "").replace(/\s+/g, " ").trim()).filter((s) => s && s.length < 120 && /[a-z]/i.test(s));
  }

  // Ways a single label item might be written: "Cocos Nucifera (Coconut) Oil",
  // "Water/Aqua/Eau", "Parfum (Fragrance)", "Titanium Dioxide (CI 77891)".
  function variants(item) {
    const v = new Set([item]);
    const noParen = item.replace(/\([^)]*\)|\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
    v.add(noParen);
    (item.match(/\(([^)]*)\)/g) || []).forEach((p) => v.add(p.slice(1, -1)));
    [...v].forEach((x) => { if (x.includes("/") && !/caprylate\/caprate|dicaprylate|\/dicaprate|stearyl\/|cetyl\//i.test(x)) x.split("/").forEach((y) => v.add(y)); });
    return [...v].map((x) => x.trim()).filter(Boolean);
  }

  function lookup(index, item) {
    const vs = variants(item);
    for (const x of vs) { const e = index.exact.get(norm(x)); if (e) return e; }
    for (const x of vs) { const e = index.looseMap.get(loose(x)); if (e) return e; }
    const ci = norm(item).match(/ci (\d{5})/g);
    if (ci) for (const c of ci) { const e = index.exact.get(c); if (e) return e; }
    return null;
  }

  const FUNGAL_SAFE = /\b(squalane|mineral oil|paraffinum liquidum|caprylic\/capric triglyceride|petrolatum)\b/;
  const FUNGAL_RULES = [
    [/\b(lauric|myristic|palmitic|stearic|oleic|linoleic|isostearic|arachidic|behenic|eicosanoic) acid\b/, "Fatty acid that Malassezia yeast feeds on"],
    [/\b(laurate|myristate|palmitate|stearate|oleate|linoleate|isostearate|behenate|lanolate)\b/, "Ester of a fatty acid the yeast can break down"],
    [/\bpolysorbate/, "Polysorbates are made from fatty acids"],
    [/\b(oil|butter)\b/, "Plant oils and butters are split into fatty acids by the yeast"],
    [/\b(lanolin|lecithin|beeswax|cera alba)\b/, "Commonly flagged fungal acne trigger"],
    [/\bferment\b/, "Ferment filtrates are flagged by some databases (weaker evidence)"],
  ];
  function fungal(item) {
    const n = norm(item);
    if (FUNGAL_SAFE.test(n)) return null;
    for (const [re, why] of FUNGAL_RULES) if (re.test(n)) return why;
    return null;
  }

  function analyse(index, text) {
    const items = splitList(text);
    return items.map((label, i) => {
      const entry = lookup(index, label);
      return { label, position: i + 1, entry, fungal: fungal(label) };
    });
  }

  const api = { norm, loose, buildIndex, splitList, variants, lookup, analyse, fungal };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PoreMatch = api;
})(typeof window !== "undefined" ? window : globalThis);
