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
  function stopScanner() { if (state.scanner) { try { state.scanner.stop(); } catch {} state.scanner = null; } }
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
    render(`${bar()}<div class="reading"><span class="pulse" aria-hidden="true"></span>Looking up barcode ${esc(code)}…</div>`);
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
    render(`${bar()}
      <img class="photo" src="${dataUrl}" alt="Your photo">
      <div class="reading"><span class="pulse" aria-hidden="true"></span>Reading your photo…</div>`);
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
    render(`${bar()}<div class="reading"><span class="pulse" aria-hidden="true"></span>Looking for ${esc(q)}…</div>`);
    wireBar();
    try {
      const body = await api(`/api/product?q=${encodeURIComponent(q)}`);
      if (!body.found) return webLookup(seen);
      confirmProduct({ ...body.product, source: "search" }, q);
    } catch (err) {
      webLookup(seen);
    }
  }

  async function webLookup(seen) {
    const q = seen.barcode ? `barcode ${seen.barcode}` : productTitle(seen);
    render(`${bar()}<div class="reading"><span class="pulse" aria-hidden="true"></span>Searching the web for ${esc(q)}'s ingredients…</div>
      <p class="sub" style="margin-top:12px">It isn't in the product database, so this takes about 10 to 20 seconds.</p>`);
    wireBar();
    try {
      const body = await api("/api/web-ingredients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(seen) });
      if (!body.found) return notFound(`We couldn't find the ingredient list for ${q}, in the product database or on the web.`);
      confirmProduct({ ...body.product, source: "web" }, q);
    } catch (err) {
      notFound(friendly(err, `We couldn't find the ingredient list for ${q}.`));
    }
  }

  function confirmProduct(p, q) {
    render(`${bar()}
      <h1 class="title">Is this your product?</h1>
      <p class="sub">${p.source === "web"
        ? `We searched the web for ${esc(q)} and found this list on ${esc(p.sourceName || "a product page")}.`
        : `We read "${esc(q)}" from your photo and found this in the product database.`}</p>
      <div class="found">
        ${p.image ? `<img src="${esc(p.image)}" alt="" class="found-img">` : ""}
        <div><strong>${esc(productTitle(p) || "Unnamed product")}</strong>
        <p>${esc(p.ingredients.slice(0, 140))}${p.ingredients.length > 140 ? "…" : ""}</p></div>
      </div>
      <button class="btn" data-yes>Yes, check it</button>
      <label class="btn ghost">No, photograph the ingredient list<input type="file" accept="image/*" data-photo hidden></label>`);
    wireBar(); wirePhoto();
    app.querySelector("[data-yes]").addEventListener("click", () => {
      state.product = p;
      state.text = p.ingredients;
      results();
    });
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
    const score = e && e.rating != null ? `${e.rating}/5` : "";
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
    const fromDb = p.source === "barcode" || p.source === "search";
    const note = fromDb
      ? `Ingredients from <a href="${esc(p.url || "https://world.openbeautyfacts.org")}">Open Beauty Facts</a>. Formulas change, so check they match your pack.`
      : p.source === "web"
        ? `Ingredients found on <a href="${esc(p.url)}">${esc(p.sourceName || "the web")}</a> by web search. Check they match your pack.`
        : "";
    return `<div class="product">
      <strong>${esc(productTitle(p))}</strong>
      ${note ? `<span>${note}</span>` : ""}
    </div>`;
  }

  function results(keep) {
    const all = PoreMatch.analyse(index, state.text);
    const byRisk = (a, b) => (RISK_ORDER[a.entry.risk] - RISK_ORDER[b.entry.risk]) || ((b.entry.rating ?? 0) - (a.entry.rating ?? 0)) || (a.position - b.position);
    const watch = all.filter((x) => x.entry && x.entry.kind === "watch");
    const proven = watch.filter((x) => ["High", "Medium", "Low"].includes(x.entry.risk)).sort(byRisk);
    const weak = watch.filter((x) => ["Disputed", "Unverified"].includes(x.entry.risk)).sort(byRisk);
    const flagged = state.strict ? [...proven, ...weak] : proven;
    const fine = all.filter((x) => x.entry && x.entry.kind === "fine");
    const unknown = all.filter((x) => !x.entry);
    const fungal = all.filter((x) => x.fungal);
    const n = flagged.length;

    const headline = n === 0
      ? (weak.length ? "Nothing proven to clog pores. A few ingredients have weaker warnings below." : "Nothing on our list of pore-cloggers.")
      : `${n === 1 ? "ingredient" : "ingredients"} may clog pores${flagged.some((x) => x.position <= 7) ? ", including some near the top of the label" : ""}.`;

    render(`${bar()}
      ${productHeader()}
      <div class="verdict ${n ? "" : "clear"}">
        <div class="num">${n}</div>
        <p>${esc(headline)}</p>
      </div>
      <div class="toggles">
        <label class="toggle"><input type="checkbox" data-t="strict" ${state.strict ? "checked" : ""}>Strict mode</label>
        <label class="toggle"><input type="checkbox" data-t="fungal" ${state.fungal ? "checked" : ""}>Fungal acne</label>
      </div>

      ${flagged.length ? `<section class="group"><h2>May clog pores</h2>
        <p class="hint">${state.strict ? "Strict mode is on, so weaker warnings are counted too." : "Backed by lab ratings. Tap one to see why."}</p>
        ${flagged.map(itemHTML).join("")}</section>` : ""}

      ${!state.strict && weak.length ? `<section class="group"><h2>Some sources say</h2>
        <p class="hint">These appear on pore-clogging lists without solid studies behind them. Worth knowing if your skin reacts to them.</p>
        ${weak.map(itemHTML).join("")}</section>` : ""}

      ${state.fungal ? `<section class="group"><h2>Fungal acne triggers</h2>
        <p class="hint">${fungal.length ? "Ingredients that can feed Malassezia, the yeast behind fungal acne." : "None found. Fungal acne is a yeast problem, separate from clogged pores."}</p>
        ${fungal.map(itemHTML).join("")}</section>` : ""}

      ${fine.length ? `<section class="group"><h2>Rated fine</h2>
        <p class="hint">Rated 0–1 in lab tests, or considered inert.</p>
        ${fine.map(itemHTML).join("")}</section>` : ""}

      ${unknown.length ? `<section class="group"><h2>Not rated</h2>
        <p class="hint">No rating found. That usually means nobody has tested it, not that it's a problem.</p>
        <ul class="plain">${unknown.map((x) => `<li>${esc(x.label)}</li>`).join("")}</ul></section>` : ""}

      <div class="again"><button class="btn" data-again>Check another product</button>
      <button class="btn ghost" data-editlist>Edit this list</button></div>
      <p class="foot">Ratings mostly come from rabbit-ear tests of single ingredients at full strength. A whole product can behave differently. Not medical advice; patch-test new products.</p>`, keep);
    wireBar();
    app.querySelectorAll("[data-t]").forEach((t) => t.addEventListener("change", () => {
      state[t.dataset.t] = t.checked; store.set(t.dataset.t, t.checked); results(true);
    }));
    app.querySelector("[data-again]").addEventListener("click", home);
    app.querySelector("[data-editlist]").addEventListener("click", () => edit(state.text, "edit"));
  }

  home();
})();
