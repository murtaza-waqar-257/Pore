(function () {
  const app = document.getElementById("app");
  const index = PoreMatch.buildIndex(window.PORE_DATA);
  const BASE = window.PORE_API || "";
  const RISK_ORDER = { High: 0, Medium: 1, Low: 2, Disputed: 3, Unverified: 4 };
  const RISK_WORD = { High: "High risk", Medium: "Medium risk", Low: "Low risk", Disputed: "Disputed", Unverified: "Unverified" };

  const store = {
    get(k, d) { try { const v = localStorage.getItem("pore." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem("pore." + k, JSON.stringify(v)); } catch {} },
  };
  const state = { text: "", product: null, strict: store.get("strict", false), fungal: store.get("fungal", false), scanner: null };

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  function stopScanner() {
    if (state.scanner) { try { state.scanner.stop(); } catch {} state.scanner = null; }
    if (state.timer) { clearInterval(state.timer); state.timer = null; }
  }

  // Loading screen: just a quiet spinner and what we're checking.
  function loader(title) {
    return `${bar()}
      <div class="loading" role="status" aria-live="polite">
        <span class="spinner" aria-hidden="true"></span>
        <p>${title ? `Checking <strong>${esc(title)}</strong>` : "Checking…"}</p>
      </div>`;
  }
  function advanceSteps() {}

  const render = (html, keep) => { stopScanner(); const y = window.scrollY; app.innerHTML = html; window.scrollTo(0, keep ? y : 0); };

  const productTitle = (p) => [p && p.brand, p && p.name].filter(Boolean).join(" ");

  async function api(path, opts) {
    const r = await fetch(BASE + path, opts);
    const body = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(body.error || "Something went wrong."), { fromServer: !!body.error });
    return body;
  }
  const friendly = (err, fallback) => (err && err.fromServer ? err.message : fallback);

  // ---------- Home ----------
  function home() {
    state.product = null;
    render(`
      <h1 class="mark">pore</h1>
      <p class="lede">Find the ingredients in your skincare and makeup that may clog pores.</p>
      <div class="ways">
        <button class="way primary" data-go="barcode">
          <strong>Scan the barcode</strong>
          <span>Point your camera at the barcode on the pack</span>
        </button>
        <label class="way">
          <strong>Photograph the product</strong>
          <span>The front of the pack or the ingredient list. Take a photo or choose one.</span>
          <input type="file" accept="image/*" data-photo>
        </label>
        <button class="way" data-go="type">
          <strong>Type ingredients</strong>
          <span>Paste a list or type a single ingredient</span>
        </button>
      </div>
      <p class="foot">Ratings come from lab studies, mostly on rabbit skin. They show what <em>may</em> clog pores, not what will. Not medical advice; patch-test new products.</p>
    `);
    wirePhoto();
    app.querySelector("[data-go=type]").addEventListener("click", () => { state.product = null; edit(""); });
    app.querySelector("[data-go=barcode]").addEventListener("click", barcode);
  }

  function bar() {
    return `<header class="bar"><span class="mark small">pore</span><button class="link-btn" data-home>Start again</button></header>`;
  }
  function wireBar() { const b = app.querySelector("[data-home]"); if (b) b.addEventListener("click", home); }
  function wirePhoto() {
    app.querySelectorAll("[data-photo]").forEach((inp) => inp.addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) readPhoto(f);
    }));
  }
  function wireType() { app.querySelectorAll("[data-type]").forEach((b) => b.addEventListener("click", () => edit(""))); }

  // ---------- Barcode ----------
  function barcode() {
    render(`${bar()}
      <h1 class="title">Scan the barcode</h1>
      <p class="sub" id="scanmsg">Hold the barcode inside the frame. It scans by itself.</p>
      <div class="viewfinder"><video id="cam" playsinline muted></video><span class="guide" aria-hidden="true"></span></div>
      <label class="btn ghost">Use a photo of the barcode<input type="file" accept="image/*" data-barcode-photo hidden></label>
      <form class="code-form" data-code-form>
        <label for="code">Or type the numbers under the barcode</label>
        <div class="code-row"><input id="code" inputmode="numeric" autocomplete="off" placeholder="8 to 14 digits" pattern="[0-9 ]*"><button class="btn small" type="submit">Look up</button></div>
      </form>`);
    wireBar();
    const msg = app.querySelector("#scanmsg");
    app.querySelector("[data-code-form]").addEventListener("submit", (e) => {
      e.preventDefault();
      const code = app.querySelector("#code").value.replace(/\D/g, "");
      if (code.length < 8) { msg.textContent = "Barcodes have 8 to 14 digits. Check the number and try again."; return; }
      lookupBarcode(code);
    });
    app.querySelector("[data-barcode-photo]").addEventListener("change", async (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      msg.textContent = "Reading the barcode in your photo…";
      const url = URL.createObjectURL(f);
      try {
        const result = await new ZXingBrowser.BrowserMultiFormatReader().decodeFromImageUrl(url);
        lookupBarcode(result.getText());
      } catch {
        msg.textContent = "No barcode found in that photo. Try a closer, sharper photo, or type the numbers.";
      } finally { URL.revokeObjectURL(url); }
    });

    const video = app.querySelector("#cam");
    if (!window.ZXingBrowser || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      app.querySelector(".viewfinder").remove();
      msg.textContent = "Live scanning isn't available in this browser. Use a photo of the barcode, or type the numbers.";
      return;
    }
    const reader = new ZXingBrowser.BrowserMultiFormatReader();
    let got = false;
    reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } } }, video, (result, err, controls) => {
      if (result && !got) {
        got = true;
        controls.stop();
        if (navigator.vibrate) { try { navigator.vibrate(60); } catch {} }
        lookupBarcode(result.getText());
      }
    }).then((controls) => { state.scanner = controls; })
      .catch(() => {
        const vf = app.querySelector(".viewfinder"); if (vf) vf.remove();
        msg.textContent = "The camera couldn't start. Allow camera access in your browser settings, or use a photo of the barcode instead.";
      });
  }

  async function lookupBarcode(code, seen) {
    code = String(code).replace(/\D/g, "");
    render(loader(""));
    wireBar();
    try {
      const body = await api(`/api/product?barcode=${encodeURIComponent(code)}`);
      if (body.found) {
        state.product = { ...body.product, source: "barcode" };
        state.text = body.product.ingredients;
        return results();
      }
      const p = body.product;
      if (seen && (seen.brand || seen.name)) return searchProduct(seen);
      if (p && productTitle(p)) return webLookup({ brand: p.brand, name: p.name });
      webLookup({ barcode: code });
    } catch (err) {
      notFound(friendly(err, "The product database couldn't be reached."));
    }
  }

  function notFound(msg) {
    render(`${bar()}
      <h1 class="title">No ingredient list found</h1>
      <div class="error">${esc(msg)} Photograph the ingredient list on the pack and we'll read it.</div>
      <label class="btn">Photograph the ingredient list<input type="file" accept="image/*" data-photo hidden></label>
      <button class="btn ghost" data-type>Type the ingredients</button>`);
    wireBar(); wirePhoto(); wireType();
  }

  // ---------- Photo ----------
  async function shrink(file, max = 1400) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", 0.85);
    } finally { URL.revokeObjectURL(url); }
  }

  async function readPhoto(file) {
    state.product = null;
    let dataUrl;
    try { dataUrl = await shrink(file); }
    catch { return photoError(null, "That file couldn't be opened as an image. Try another photo, or type the ingredients."); }
    render(loader(""));
    wireBar();
    let body;
    try {
      body = await api("/api/read-label", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image: dataUrl }) });
    } catch (err) {
      return photoError(dataUrl, friendly(err, "Photo reading isn't available right now. Type or paste the ingredients instead."));
    }
    const seen = { brand: body.brand, name: body.product_name };
    if (body.ingredients && body.ingredients.length) {
      state.product = (seen.brand || seen.name) ? { ...seen, source: "photo" } : null;
      return edit(body.ingredients.join(", "), true);
    }
    if (body.barcode) return lookupBarcode(body.barcode, seen);
    if (seen.brand || seen.name) return searchProduct(seen);
    photoError(dataUrl, body.message || "We couldn't see an ingredient list, a barcode or a product name in this photo. Try a closer photo.");
  }

  async function searchProduct(seen) {
    const q = productTitle(seen);
    render(loader(niceName(q)));
    wireBar();
    try {
      const body = await api(`/api/product?q=${encodeURIComponent(q)}`);
      const p = body.found && body.product;
      // Only trust the database hit if it's clearly the same product; otherwise search the web.
      if (!p || nameMatch(q, productTitle(p)) < 0.75) return webLookup(seen);
      showProduct({ ...p, source: "search" });
    } catch (err) {
      webLookup(seen);
    }
  }

  async function webLookup(seen) {
    const q = seen.barcode ? `barcode ${seen.barcode}` : productTitle(seen);
    render(loader(seen.barcode ? "" : niceName(q)));
    wireBar();
    try {
      const body = await api("/api/web-ingredients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(seen) });
      if (!body.found) return notFound(`We couldn't find the ingredient list for ${q}.`);
      showProduct({ ...body.product, source: "web" });
    } catch (err) {
      notFound(friendly(err, `We couldn't find the ingredient list for ${q}.`));
    }
  }

  function showProduct(p) {
    state.product = p;
    state.text = p.ingredients;
    results();
  }

  // "anua HEARTLEAF pore control" -> "Anua Heartleaf Pore Control"
  function niceName(q) {
    return String(q).toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase());
  }
  // Share of the words we read that also appear in the database product's name.
  function nameMatch(a, b) {
    const words = (x) => String(x).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2);
    const want = words(a), have = new Set(words(b));
    if (!want.length) return 0;
    return want.filter((w) => have.has(w)).length / want.length;
  }

  function photoError(dataUrl, msg) {
    render(`${bar()}
      ${dataUrl ? `<img class="photo" src="${dataUrl}" alt="Your photo">` : ""}
      <div class="error">${esc(msg)}</div>
      <label class="btn">Try another photo<input type="file" accept="image/*" data-photo hidden></label>
      <button class="btn ghost" data-type>Type the ingredients</button>`);
    wireBar(); wirePhoto(); wireType();
  }

  // ---------- Check / type list ----------
  function edit(text, fromPhoto) {
    state.text = text;
    if (!fromPhoto) state.product = null;
    render(`${bar()}
      <h1 class="title">${fromPhoto === "edit" ? "Edit the list" : fromPhoto ? "Check the list" : "Type ingredients"}</h1>
      <p class="sub">${fromPhoto === "edit" ? "Change or add ingredients, then check again." : fromPhoto ? "This is what we read from your photo. Fix any word that looks wrong, then check it." : "Paste the full list from the pack, or type one ingredient. Separate them with commas."}</p>
      <textarea id="list" placeholder="Aqua, Glycerin, Isopropyl Palmitate, Cocos Nucifera Oil…" aria-label="Ingredient list">${esc(text)}</textarea>
      <button class="btn" data-check ${text.trim() ? "" : "disabled"}>Check ingredients</button>`);
    wireBar();
    const ta = app.querySelector("#list"), btn = app.querySelector("[data-check]");
    ta.addEventListener("input", () => { btn.disabled = !ta.value.trim(); });
    btn.addEventListener("click", () => { state.text = ta.value; results(); });
    if (!fromPhoto) ta.focus();
  }

  // ---------- Results ----------
  function itemHTML(x) {
    const e = x.entry;
    const dotClass = !e ? "none" : e.kind === "fine" ? "fine" : e.risk;
    const score = e && e.rating != null ? `<span class="pill ${dotClass}">${e.rating}/5</span>` : "";
    const sameName = e && PoreMatch.norm(e.name) === PoreMatch.norm(x.label);
    const top = e && e.kind === "watch" && x.position <= 7 ? `<span class="top">Near the top of the label (No. ${x.position})</span>` : "";
    const rows = [];
    if (e) {
      if (e.kind === "watch") rows.push(["Risk", RISK_WORD[e.risk]]);
      if (e.type) rows.push(["Type", e.type]);
      rows.push(["Evidence", e.evidence]);
      if (e.note) rows.push(["Note", e.note]);
      if (e.acne) rows.push(["Acne.org", e.acne]);
    }
    if (x.fungal && state.fungal) rows.push(["Fungal acne", x.fungal]);
    rows.push(["On the label", `No. ${x.position}`]);
    return `<details class="item">
      <summary><span class="dot ${dotClass}" aria-hidden="true"></span>
        <span class="iname">${esc(e ? e.name : x.label)}${e && !sameName ? `<small>Listed as ${esc(x.label)}</small>` : ""}${top}</span>
        <span class="score">${score}</span></summary>
      <div class="more"><dl>${rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl></div>
    </details>`;
  }

  function productHeader() {
    const p = state.product;
    if (!p || !productTitle(p)) return "";
    const src = p.source === "web"
      ? `Ingredients from <a href="${esc(p.url)}">${esc(p.sourceName || "a product page")}</a>.`
      : (p.source === "barcode" || p.source === "search")
        ? `Ingredients from <a href="${esc(p.url || "https://world.openbeautyfacts.org")}">Open Beauty Facts</a>.`
        : "";
    return `<div class="product">
      <strong>${esc(niceName(productTitle(p)))}</strong>
      ${src ? `<span>${src} Formulas change, so check they match your pack. <label class="inline-link">Not right? Photograph the ingredient list<input type="file" accept="image/*" data-photo hidden></label></span>` : ""}
    </div>`;
  }

  // The colour groups on the results page, in the order they're shown.
  const GROUPS = {
    clog:    { label: "May clog pores",   cls: "g-clog",  hint: "Lab tests found these can clog pores. Tap one to see why." },
    weak:    { label: "Weak warnings",    cls: "g-weak",  hint: "Some lists say these clog pores, but there's no solid study behind it. Worth knowing if your skin reacts to them." },
    fungal:  { label: "Fungal acne",      cls: "g-fungal", hint: "Can feed the yeast behind fungal acne. That's a different problem from clogged pores." },
    safe:    { label: "Safe for pores",   cls: "g-safe",  hint: "Tested and rated 0–1 out of 5, or known to be harmless. These won't clog pores." },
    unknown: { label: "No rating yet",    cls: "g-unknown", hint: "Nobody has tested these for pore-clogging. That doesn't mean they're bad." },
  };

  function group(key, items, body) {
    if (!items.length) return "";
    const g = GROUPS[key];
    return `<section class="group ${g.cls}">
      <h2><span class="swatch" aria-hidden="true"></span>${g.label}<span class="count">${items.length}</span></h2>
      <p class="hint">${g.hint}</p>
      ${body || items.map(itemHTML).join("")}
    </section>`;
  }

  function results(keep) {
    const all = PoreMatch.analyse(index, state.text);
    const byRisk = (a, b) => (RISK_ORDER[a.entry.risk] - RISK_ORDER[b.entry.risk]) || ((b.entry.rating ?? 0) - (a.entry.rating ?? 0)) || (a.position - b.position);
    const watch = all.filter((x) => x.entry && x.entry.kind === "watch");
    const proven = watch.filter((x) => ["High", "Medium", "Low"].includes(x.entry.risk)).sort(byRisk);
    const weak = watch.filter((x) => ["Disputed", "Unverified"].includes(x.entry.risk)).sort(byRisk);
    const clog = state.strict ? [...proven, ...weak] : proven;
    const weakShown = state.strict ? [] : weak;
    const safe = all.filter((x) => x.entry && x.entry.kind === "fine");
    const unknown = all.filter((x) => !x.entry);
    const fungal = all.filter((x) => x.fungal);
    const n = clog.length;

    const headline = n === 0
      ? (weak.length ? "Nothing proven to clog pores. A few ingredients have weak warnings." : "Nothing in this product is known to clog pores.")
      : `${n === 1 ? "ingredient" : "ingredients"} may clog pores${clog.some((x) => x.position <= 7) ? ", including some near the top of the label, where there's more of them" : ""}.`;

    // At-a-glance bar: one coloured block per group, sized by count.
    const parts = [["clog", clog.length], ["weak", weakShown.length], ["safe", safe.length], ["unknown", unknown.length]].filter(([, c]) => c);
    const total = parts.reduce((t, [, c]) => t + c, 0) || 1;
    const glance = `<div class="glance" aria-label="Summary">
      <div class="bar">${parts.map(([k, c]) => `<span class="${GROUPS[k].cls}" style="flex:${c}"></span>`).join("")}</div>
      <ul class="legend">${parts.map(([k, c]) => `<li class="${GROUPS[k].cls}"><span class="swatch"></span>${c} ${GROUPS[k].label.toLowerCase()}</li>`).join("")}</ul>
    </div>`;

    render(`${bar()}
      ${productHeader()}
      <div class="verdict ${n ? "" : "clear"}">
        <div class="num">${n}</div>
        <p>${esc(headline)}</p>
      </div>
      ${total > 1 || parts.length ? glance : ""}
      <div class="toggles">
        <label class="toggle"><input type="checkbox" data-t="strict" ${state.strict ? "checked" : ""}>Strict mode<small>Count weak warnings too</small></label>
        <label class="toggle"><input type="checkbox" data-t="fungal" ${state.fungal ? "checked" : ""}>Fungal acne<small>Show yeast triggers</small></label>
      </div>
      ${group("clog", clog)}
      ${group("weak", weakShown)}
      ${state.fungal ? (fungal.length ? group("fungal", fungal) : `<section class="group g-fungal"><h2><span class="swatch" aria-hidden="true"></span>Fungal acne<span class="count">0</span></h2><p class="hint">No fungal acne triggers found.</p></section>`) : ""}
      ${group("safe", safe)}
      ${group("unknown", unknown, `<ul class="plain">${unknown.map((x) => `<li>${esc(x.label)}</li>`).join("")}</ul>`)}
      <div class="again"><button class="btn" data-again>Check another product</button>
      <button class="btn ghost" data-editlist>Edit this list</button></div>
      <p class="foot">Ratings mostly come from rabbit-ear tests of single ingredients at full strength. A whole product can behave differently. Not medical advice; patch-test new products.</p>`, keep);
    wireBar(); wirePhoto();
    app.querySelectorAll("[data-t]").forEach((t) => t.addEventListener("change", () => {
      state[t.dataset.t] = t.checked; store.set(t.dataset.t, t.checked); results(true);
    }));
    app.querySelector("[data-again]").addEventListener("click", home);
    app.querySelector("[data-editlist]").addEventListener("click", () => edit(state.text, "edit"));
  }

  home();
})();
