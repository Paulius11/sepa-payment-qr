/* SEPA Payment QR — DOM glue. All EPC069-12 validation/assembly lives in
 * epc.js (pure, unit-tested); this file reads the form, calls EPC.buildEpc,
 * and renders the QR to a canvas. See epc.js for the payload spec.
 */
"use strict";

const $ = (id) => document.getElementById(id);
const els = {
  name: $("name"), iban: $("iban"), amount: $("amount"), message: $("message"),
  bic: $("bic"), purpose: $("purpose"),
  canvas: $("qr"), qrbox: $("qrbox"), payload: $("payload"), bytes: $("bytes"),
  download: $("download"), copy: $("copy"), demo: $("demo"), link: $("link"),
  sPreset: $("s-preset"), sShape: $("s-shape"),
  sOuter: $("s-outer"), sInner: $("s-inner"),
  sGradient: $("s-gradient"), sGradType: $("s-gradtype"),
  sColor1: $("s-color1"), sColor2: $("s-color2"), sEyeColor: $("s-eyecolor"),
  sLogo: $("s-logo"), sLogoClear: $("s-logo-clear"),
  billFile: $("bill-file"), billText: $("bill-text"), billStatus: $("bill-status"),
  billIban: $("bill-iban"), billIbanRow: $("bill-iban-row"),
  linktext: $("linktext"), linkInput: $("link-input"), paymentFields: $("payment-fields"),
  savedSelect: $("saved-select"), savedSave: $("saved-save"), savedDel: $("saved-del"),
};

const MAX = EPC.MAX_PAYLOAD_BYTES;
const ERROR_FIELDS = ["name", "iban", "amount", "message", "bic"];
let lastPayload = "";

/* ---- mode: SEPA payment vs arbitrary link/text ------------------------- */
const MODE_KEY = "sepaqr.mode";
let mode = "payment";
try { if (localStorage.getItem(MODE_KEY) === "link") mode = "link"; } catch { /* ignore */ }

function setMode(m) {
  mode = m === "link" ? "link" : "payment";
  try { localStorage.setItem(MODE_KEY, mode); } catch { /* ignore */ }
  const link = mode === "link";
  els.linkInput.hidden = !link;
  els.paymentFields.hidden = link;
  els.link.style.display = link ? "none" : "";   // share-prefill link is payment-only
  document.querySelectorAll(".mode-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === mode));
  build();
}

// Link/text mode: encode whatever the user types, styled like the payment QR.
function buildLink() {
  els.download.disabled = true;
  els.copy.disabled = true;
  setErr("linktext", "");
  const text = els.linktext.value.trim();
  if (!text) {
    els.payload.textContent = "";
    els.bytes.textContent = "";
    els.bytes.classList.remove("over");
    clearQr("Enter a link or text to generate a code.");
    return;
  }
  const bytes = EPC.utf8Len(text);
  els.payload.textContent = text;
  els.bytes.textContent = `${bytes} bytes`;
  const over = bytes > 1200;                       // keep well inside QR capacity
  els.bytes.classList.toggle("over", over);
  if (over) {
    setErr("linktext", "Too long for a reliable QR (max ~1200 bytes).");
    clearQr("Shorten the text.");
    return;
  }
  renderQr(text);
  lastPayload = text;
  els.download.disabled = false;
  els.copy.disabled = false;
}

/* ---- QR styling -------------------------------------------------------- */
// Every preset stays dark-on-white with a full quiet zone so it still scans;
// the integration test decodes each one to prove it. "classic" is the plainest.
// Outer/inner eye and module shapes are styled independently (per pretty-qr /
// EPC069 design refs). Error correction is derived, not stored: a centre logo
// forces "H" (30% recovery) and dot modules use "Q" for headroom; else "M".
const PRESETS = {
  beautiful: { moduleShape: "rounded", outerEye: "rounded", innerEye: "rounded", gradient: true,  gradientType: "linear", color1: "#14235c", color2: "#2f57b5", eyeColor: "#0f1e47" },
  mono:      { moduleShape: "rounded", outerEye: "rounded", innerEye: "rounded", gradient: false, gradientType: "linear", color1: "#12244d", color2: "#12244d", eyeColor: "#12244d" },
  dots:      { moduleShape: "dot",     outerEye: "rounded", innerEye: "rounded", gradient: false, gradientType: "linear", color1: "#0f1e47", color2: "#0f1e47", eyeColor: "#0f1e47" },
  vivid:     { moduleShape: "rounded", outerEye: "leaf",    innerEye: "circle",  gradient: true,  gradientType: "radial", color1: "#2b0a5e", color2: "#5a189a", eyeColor: "#2b0a5e" },
  classic:   { moduleShape: "square",  outerEye: "square",  innerEye: "square",  gradient: false, gradientType: "linear", color1: "#000000", color2: "#000000", eyeColor: "#000000" },
};
const STYLE_KEY = "sepaqr.style";
let style = loadStyle();
let logoImg = null; // in-memory only (not persisted — could be large)

function styleEcc() {
  if (logoImg) return "H";                       // logo knockout needs max recovery
  if (style.moduleShape === "dot") return "Q";   // isolated modules read harder
  return "M";                                    // EPC's recommended default
}

function loadStyle() {
  // Default = Classic: plain black square modules, the most widely scannable.
  const base = { preset: "classic", ...PRESETS.classic };
  try {
    const saved = JSON.parse(localStorage.getItem(STYLE_KEY) || "{}");
    delete saved.logo; // never trust/keep a persisted logo blob
    return { ...base, ...saved };
  } catch {
    return base;
  }
}
function saveStyle() {
  try { localStorage.setItem(STYLE_KEY, JSON.stringify(style)); } catch { /* ignore */ }
}

function setErr(field, msg) {
  const el = document.querySelector(`.err[data-for="${field}"]`);
  if (el) el.textContent = msg || "";
}

function readInputs() {
  return {
    name: els.name.value, iban: els.iban.value, amount: els.amount.value,
    message: els.message.value, bic: els.bic.value, purpose: els.purpose.value,
  };
}

/* ---- build + render ---------------------------------------------------- */

function build() {
  if (mode === "link") { buildLink(); return; }
  els.download.disabled = true;
  els.copy.disabled = true;
  els.link.disabled = true;
  ERROR_FIELDS.forEach((f) => setErr(f, ""));

  const res = EPC.buildEpc(readInputs());
  for (const [field, msg] of Object.entries(res.errors)) setErr(field, msg);

  if (res.payload) {
    els.payload.textContent = res.payload;
    els.bytes.textContent = `${res.bytes} / ${MAX} bytes`;
    els.bytes.classList.toggle("over", res.tooLong);
  } else {
    els.payload.textContent = "";
    els.bytes.textContent = "";
    els.bytes.classList.remove("over");
  }

  if (!res.ok) {
    let msg = "";
    if (res.tooLong) {
      msg = `Payload ${res.bytes} B exceeds the ${MAX} B EPC limit — shorten the message.`;
    } else if (!els.name.value.trim() && !els.iban.value.trim()) {
      msg = "Fill name + IBAN to generate a code.";
    }
    clearQr(msg);
    return;
  }

  renderQr(res.payload);
  lastPayload = res.payload;
  els.download.disabled = false;
  els.copy.disabled = false;
  els.link.disabled = false;
  // Keep the address bar shareable/bookmarkable without spamming history.
  history.replaceState(null, "", currentLink());
}

function clearQr(msg) {
  els.canvas.hidden = true;
  let ph = els.qrbox.querySelector(".placeholder");
  if (!ph) {
    ph = document.createElement("p");
    ph.className = "placeholder";
    els.qrbox.appendChild(ph);
  }
  ph.textContent = msg || "Fix the errors above to generate a code.";
  ph.hidden = !msg;
}

function renderQr(payload) {
  // typeNumber 0 = auto-fit version; error correction per style (default "M").
  const qr = qrcode(0, styleEcc());
  qr.addData(EPC.toUtf8Bytes(payload), "Byte");
  qr.make();

  const count = qr.getModuleCount();
  const cell = 16, margin = 4;               // hi-res (supersampled) + 4-module quiet zone
  const size = (count + margin * 2) * cell;
  const cv = els.canvas;
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext("2d");

  // White background — non-negotiable for scanning (dark modules on light).
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);

  // The three 7x7 finder patterns (the "eyes"): drawn separately as styled
  // shapes, so skip their modules in the main loop.
  const finders = [[0, 0], [0, count - 7], [count - 7, 0]];
  const inFinder = (r, c) =>
    finders.some(([fr, fc]) => r >= fr && r < fr + 7 && c >= fc && c < fc + 7);

  // Module fill: solid colour, or a diagonal/radial gradient (both ends kept
  // dark for contrast). The gradient is in canvas coords so every module samples
  // the same field.
  let fill = style.color1;
  if (style.gradient) {
    const g = style.gradientType === "radial"
      ? ctx.createRadialGradient(size / 2, size / 2, size * 0.05, size / 2, size / 2, size * 0.7)
      : ctx.createLinearGradient(0, 0, size, size);
    g.addColorStop(0, style.color1);
    g.addColorStop(1, style.color2);
    fill = g;
  }
  ctx.fillStyle = fill;
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c) && !inFinder(r, c)) {
        drawModule(ctx, (c + margin) * cell, (r + margin) * cell, cell, style.moduleShape);
      }
    }
  }

  for (const [fr, fc] of finders) {
    drawEye(ctx, (fc + margin) * cell, (fr + margin) * cell, cell,
      style.outerEye, style.innerEye, style.eyeColor);
  }

  if (logoImg) drawLogo(ctx, size, cell);

  cv.hidden = false;
  const ph = els.qrbox.querySelector(".placeholder");
  if (ph) ph.hidden = true;
}

function drawModule(ctx, x, y, cell, shape) {
  if (shape === "square") {
    ctx.fillRect(x, y, cell, cell);
  } else if (shape === "dot") {
    // Half-cell so orthogonal neighbours just touch. Airier (separated) dots
    // look nicer in print but jsQR won't decode them with anti-aliased edges
    // (browser sweep: only 0.5 passes), so we keep the scannable size.
    ctx.beginPath();
    ctx.arc(x + cell / 2, y + cell / 2, cell * 0.5, 0, Math.PI * 2);
    ctx.fill();
  } else { // rounded — full cell footprint so neighbours merge into soft blobs
    ctx.beginPath();
    ctx.roundRect(x, y, cell, cell, cell * 0.35);
    ctx.fill();
  }
}

// Trace a size×size shape at (x,y): square, rounded, circle, or "leaf" (two
// opposite corners rounded). Caller fills.
function eyePath(ctx, x, y, s, shape) {
  ctx.beginPath();
  if (shape === "circle") {
    ctx.arc(x + s / 2, y + s / 2, s / 2, 0, Math.PI * 2);
  } else if (shape === "leaf") {
    ctx.roundRect(x, y, s, s, [s * 0.45, 0, s * 0.45, 0]);
  } else if (shape === "rounded") {
    ctx.roundRect(x, y, s, s, s * 0.28);
  } else {
    ctx.rect(x, y, s, s);
  }
}

// Styled finder pattern: outer frame (7x7) with a white 5x5 gap and a 3x3 pupil,
// outer and inner shaped independently.
function drawEye(ctx, x, y, cell, outer, inner, color) {
  const gapShape = outer === "leaf" ? "rounded" : outer; // cleaner inner cut
  ctx.fillStyle = color;
  eyePath(ctx, x, y, 7 * cell, outer); ctx.fill();
  ctx.fillStyle = "#ffffff";
  eyePath(ctx, x + cell, y + cell, 5 * cell, gapShape); ctx.fill();
  ctx.fillStyle = color;
  eyePath(ctx, x + 2 * cell, y + 2 * cell, 3 * cell, inner); ctx.fill();
}

// Centre logo over a white rounded knockout. Kept small (~22% of the side, ~5%
// of the area) and paired with "H" error correction so the code still decodes.
function drawLogo(ctx, size, cell) {
  const iw = logoImg.naturalWidth || logoImg.width;
  const ih = logoImg.naturalHeight || logoImg.height;
  const box = size * 0.22;
  // contain the image within the box, centred
  const scale = Math.min(box / iw, box / ih);
  const dw = iw * scale, dh = ih * scale;
  const x = (size - dw) / 2, y = (size - dh) / 2;
  // A snug rounded knockout hugging the logo (not a big square) reads cleaner.
  const pad = cell * 0.35;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.roundRect(x - pad, y - pad, dw + 2 * pad, dh + 2 * pad, cell);
  ctx.fill();
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, dw, dh, cell * 0.7);
  ctx.clip();
  ctx.drawImage(logoImg, x, y, dw, dh);
  ctx.restore();
}

/* ---- actions ----------------------------------------------------------- */

els.download.addEventListener("click", () => {
  const a = document.createElement("a");
  const who = els.name.value.trim().replace(/[^\w-]+/g, "_").slice(0, 40) || "payment";
  a.download = `sepa-qr-${who}.png`;
  a.href = els.canvas.toDataURL("image/png");
  a.click();
});

function flash(btn, text, restore) {
  btn.textContent = text;
  setTimeout(() => (btn.textContent = restore), 1200);
}

els.copy.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(lastPayload);
    flash(els.copy, "Copied!", "Copy raw text");
  } catch {
    flash(els.copy, "Copy failed", "Copy raw text");
  }
});

/* ---- demo data --------------------------------------------------------- */

const DEMO_NAMES = [
  "Jonas Petrauskas", "UAB Žaliakalnio Kavinė", "Vilniaus Vandenys",
  "Aistė Kazlauskienė", "Tomas Balčiūnas", "Ruta's Flower Shop",
];
const DEMO_MSGS = [
  "Invoice 2026-014", "Sąskaita Nr. 2026/07", "Rent — October",
  "Table for 4, Saturday", "Freelance work Q3", "Birthday gift",
];
// [country code, BBAN length] — total IBAN length = cc(2) + check(2) + BBAN.
const DEMO_IBAN_SPECS = [["LT", 16], ["DE", 18], ["EE", 16], ["LV", 17]];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function fillDemo() {
  const [cc, len] = pick(DEMO_IBAN_SPECS);
  els.name.value = pick(DEMO_NAMES);
  els.iban.value = EPC.randomIban(cc, len).replace(/(.{4})/g, "$1 ").trim();
  els.amount.value = (Math.random() * 200 + 1).toFixed(2);
  els.message.value = pick(DEMO_MSGS);
  els.bic.value = "";
  els.purpose.value = "";
  build();
}

els.demo.addEventListener("click", fillDemo);

/* ---- bill import ------------------------------------------------------- */
// The last uploaded document, exposed to a WebMCP agent (which can read a PDF or
// photo we can't OCR offline and then call fill_payment). Held in memory only.
let billDoc = null;

const FIELD_INPUTS = { name: "name", iban: "iban", amount: "amount", message: "message", bic: "bic", purpose: "purpose" };

// Set any provided fields on the form, then rebuild the QR.
function fillFields(f) {
  for (const [key, id] of Object.entries(FIELD_INPUTS)) {
    if (f[key] !== undefined && f[key] !== null) els[id].value = String(f[key]);
  }
  build();
}

function setBillStatus(msg, kind) {
  if (!els.billStatus) return;
  els.billStatus.textContent = msg || "";
  els.billStatus.className = "bill-status" + (kind ? " " + kind : "");
}

// Parse bill text, fill the form, report what was found. Returns the parse.
function extractAndFill(text) {
  const r = BILL.parse(text || "");
  fillFields({ name: r.name, iban: r.iban, amount: r.amount, message: r.message });
  // If the bill lists several accounts (e.g. a tax bill), offer a chooser.
  if (els.billIbanRow) {
    if (r.ibans && r.ibans.length > 1) {
      els.billIban.innerHTML = "";
      for (const ib of r.ibans) {
        const o = document.createElement("option");
        o.value = ib;
        o.textContent = ib.replace(/(.{4})/g, "$1 ").trim();
        els.billIban.appendChild(o);
      }
      els.billIban.value = r.iban;
      els.billIbanRow.hidden = false;
    } else {
      els.billIbanRow.hidden = true;
    }
  }
  const got = Object.entries(r.found).filter(([, v]) => v).map(([k]) => k);
  if (r.iban) setBillStatus(`Filled: ${got.join(", ")}. Check the details before paying.`, "ok");
  else setBillStatus("No valid IBAN found in the text. Paste more of the bill, or let your AI assistant read it.", "warn");
  return r;
}

if (els.billIban) els.billIban.addEventListener("change", () => {
  els.iban.value = els.billIban.value;
  build();
});

async function pdfToText(arrayBuffer) {
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = "lib/pdf.worker.min.js";
  const doc = await pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) }).promise;
  let out = "";
  for (let p = 1; p <= doc.numPages; p++) {
    const content = await (await doc.getPage(p)).getTextContent();
    // Preserve line breaks (hasEOL) so line-based heuristics (payee, totals)
    // work — joining a whole page with spaces would flatten the layout.
    out += content.items.map((i) => i.str + (i.hasEOL ? "\n" : " ")).join("") + "\n";
  }
  return out;
}

function handleBillFile(file) {
  if (!file) return;
  const name = file.name || "";
  const isText = file.type === "text/plain" || /\.txt$/i.test(name);
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(name);
  const reader = new FileReader();

  if (isText) {
    reader.onload = () => {
      const text = String(reader.result);
      billDoc = { mime: "text/plain", name, text };
      extractAndFill(text);
    };
    reader.readAsText(file);
  } else if (isPdf && window.pdfjsLib) {
    setBillStatus("Reading PDF…");
    reader.onload = async () => {
      try {
        const text = await pdfToText(reader.result);
        billDoc = { mime: "application/pdf", name, text };
        if (text.trim()) extractAndFill(text);
        else setBillStatus("This PDF has no selectable text (looks scanned). Ask your AI assistant to read it (WebMCP), or paste the text.", "warn");
      } catch {
        billDoc = { mime: "application/pdf", name };
        setBillStatus("Couldn't read this PDF in the browser (try serving over http). Paste the text, or let your AI assistant read it (WebMCP).", "warn");
      }
    };
    reader.readAsArrayBuffer(file);
  } else {
    // image / other: no offline OCR — hand it to a WebMCP agent.
    reader.onload = () => {
      billDoc = { mime: file.type || "application/octet-stream", name, dataUrl: String(reader.result) };
      setBillStatus(`${name} uploaded. Offline reading works for .txt and text PDFs — for a photo, ask your AI assistant to read it (WebMCP), or paste the text.`, "warn");
    };
    reader.readAsDataURL(file);
  }
}

if (els.billFile) els.billFile.addEventListener("change", () => handleBillFile(els.billFile.files && els.billFile.files[0]));

// Pasted/typed text auto-fills (debounced) — no button.
let billTypeT;
if (els.billText) els.billText.addEventListener("input", () => {
  clearTimeout(billTypeT);
  billTypeT = setTimeout(() => {
    const text = els.billText.value.trim();
    if (text) { billDoc = { mime: "text/plain", name: "pasted", text }; extractAndFill(text); }
  }, 400);
});

// Drop a bill file (PDF / image / .txt) anywhere on the box.
const billBox = document.getElementById("billbox");
if (billBox) {
  ["dragenter", "dragover"].forEach((e) => billBox.addEventListener(e, (ev) => {
    ev.preventDefault();
    billBox.classList.add("drag");
  }));
  ["dragleave", "drop"].forEach((e) => billBox.addEventListener(e, (ev) => {
    ev.preventDefault();
    billBox.classList.remove("drag");
  }));
  billBox.addEventListener("drop", (ev) => {
    const file = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (file) handleBillFile(file);
  });
}

// Snapshot of the current payment for WebMCP get_payment.
function paymentSnapshot() {
  const res = EPC.buildEpc(readInputs());
  return {
    fields: res.normalized,
    valid: res.ok,
    payload: res.payload,
    bytes: res.bytes,
    errors: res.errors,
    tooLong: res.tooLong,
    qrPngDataUrl: res.ok && !els.canvas.hidden ? els.canvas.toDataURL("image/png") : null,
  };
}

/* ---- saved payees ------------------------------------------------------ */
// Store recurring payments in localStorage so you can reload one and just change
// the amount. Keyed by beneficiary name.
const SAVED_KEY = "sepaqr.saved";

function currentPaymentFields() {
  return {
    name: els.name.value, iban: els.iban.value, amount: els.amount.value,
    message: els.message.value, bic: els.bic.value, purpose: els.purpose.value,
  };
}
function loadSavedStore() { try { return JSON.parse(localStorage.getItem(SAVED_KEY) || "{}"); } catch { return {}; } }
function persistSavedStore(o) { try { localStorage.setItem(SAVED_KEY, JSON.stringify(o)); } catch { /* ignore */ } }

function refreshSavedSelect() {
  const store = loadSavedStore();
  const keys = Object.keys(store).sort();
  const cur = els.savedSelect.value;
  els.savedSelect.innerHTML = "";
  const first = document.createElement("option");
  first.value = "";
  first.textContent = keys.length ? "Load saved payee…" : "No saved payees yet";
  els.savedSelect.appendChild(first);
  for (const k of keys) {
    const o = document.createElement("option");
    o.value = k; o.textContent = k;
    els.savedSelect.appendChild(o);
  }
  if (keys.includes(cur)) els.savedSelect.value = cur;
  els.savedDel.hidden = !els.savedSelect.value;
}

els.savedSave.addEventListener("click", () => {
  const name = els.name.value.trim();
  if (!name) { flash(els.savedSave, "Enter a name first", "Save"); return; }
  const store = loadSavedStore();
  store[name] = currentPaymentFields();
  persistSavedStore(store);
  refreshSavedSelect();
  els.savedSelect.value = name;
  els.savedDel.hidden = false;
  flash(els.savedSave, "Saved!", "Save");
});

els.savedSelect.addEventListener("change", () => {
  const key = els.savedSelect.value;
  els.savedDel.hidden = !key;
  if (key) {
    const store = loadSavedStore();
    if (store[key]) fillFields(store[key]);
  }
});

els.savedDel.addEventListener("click", () => {
  const key = els.savedSelect.value;
  if (!key) return;
  const store = loadSavedStore();
  delete store[key];
  persistSavedStore(store);
  refreshSavedSelect();
});

/* ---- shareable link ---------------------------------------------------- */

// A link that reopens the app pre-filled. Data lives in the hash, so it is
// never sent to a server (privacy: IBAN stays client-side).
function currentLink() {
  const base = location.href.split("#")[0].split("?")[0];
  const q = EPC.buildLinkQuery({
    name: els.name.value, iban: els.iban.value, amt: els.amount.value,
    msg: els.message.value, bic: els.bic.value, purpose: els.purpose.value,
  });
  return q ? `${base}#${q}` : base;
}

// Populate fields from the hash (or ?query fallback) on load.
function readLink() {
  const raw = location.hash.slice(1) || location.search.slice(1);
  if (!raw) return;
  const f = EPC.parseLinkQuery(raw);
  const map = { name: "name", iban: "iban", amt: "amount", msg: "message", bic: "bic", purpose: "purpose" };
  for (const [key, id] of Object.entries(map)) {
    if (key in f) els[id].value = f[key];
  }
  if ("bic" in f || "purpose" in f) {
    const d = document.querySelector("details");
    if (d) d.open = true;
  }
}

els.link.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(currentLink());
    flash(els.link, "Link copied!", "Copy link");
  } catch {
    flash(els.link, "Copy failed", "Copy link");
  }
});

/* ---- style controls ---------------------------------------------------- */

function applyStyleToControls() {
  els.sPreset.value = style.preset;
  els.sShape.value = style.moduleShape;
  els.sOuter.value = style.outerEye;
  els.sInner.value = style.innerEye;
  els.sGradient.checked = style.gradient;
  els.sGradType.value = style.gradientType;
  els.sGradType.disabled = !style.gradient;
  els.sColor1.value = style.color1;
  els.sColor2.value = style.color2;
  els.sEyeColor.value = style.eyeColor;
}

els.sPreset.addEventListener("change", () => {
  const p = els.sPreset.value;
  style = p !== "custom" && PRESETS[p]
    ? { preset: p, ...PRESETS[p] }
    : { ...style, preset: "custom" };
  applyStyleToControls();
  saveStyle();
  build();
});

// Editing any individual control switches the preset to "custom".
function onGranularChange() {
  style = {
    preset: "custom",
    moduleShape: els.sShape.value,
    outerEye: els.sOuter.value,
    innerEye: els.sInner.value,
    gradient: els.sGradient.checked,
    gradientType: els.sGradType.value,
    color1: els.sColor1.value,
    color2: els.sColor2.value,
    eyeColor: els.sEyeColor.value,
  };
  els.sPreset.value = "custom";
  els.sGradType.disabled = !style.gradient;
  saveStyle();
  build();
}
[els.sShape, els.sOuter, els.sInner, els.sGradient, els.sGradType,
  els.sColor1, els.sColor2, els.sEyeColor]
  .forEach((el) => el.addEventListener("change", onGranularChange));

// Centre logo: read the file to an <img>, re-render (error correction bumps to
// "H" while a logo is set). The logo is not persisted.
els.sLogo.addEventListener("change", () => {
  const file = els.sLogo.files && els.sLogo.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => { logoImg = img; els.sLogoClear.hidden = false; build(); };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
});
els.sLogoClear.addEventListener("click", () => {
  logoImg = null;
  els.sLogo.value = "";
  els.sLogoClear.hidden = true;
  build();
});

/* ---- wire up ----------------------------------------------------------- */

let t;
$("form").addEventListener("input", () => {
  clearTimeout(t);
  t = setTimeout(build, 150);
});

// A hash-only change doesn't reload the page, so re-read when someone opens a
// shared link in an already-open tab. (replaceState during build() doesn't fire
// this event, so there's no loop.)
window.addEventListener("hashchange", () => {
  readLink();
  build();
});

document.querySelectorAll(".mode-btn").forEach((b) =>
  b.addEventListener("click", () => setMode(b.dataset.mode)));

applyStyleToControls();
refreshSavedSelect();
readLink();
setMode(mode); // sets visibility + active tab, then builds
