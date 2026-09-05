/* Bill text -> payment fields. Pure, no DOM. Best-effort heuristics to pull an
 * IBAN, amount, payment reference and payee name out of an invoice/bill's text,
 * so the QR can be prefilled. Shared by the browser app and the node tests.
 *
 * Exposes `BILL` on the global (browser) / module.exports (node).
 * IBAN validation is self-contained (small mod-97) so this file stands alone.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BILL = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function mod97(str) {
    let rem = 0;
    for (const ch of str.toUpperCase()) {
      const v = ch >= "A" ? ch.charCodeAt(0) - 55 : ch.charCodeAt(0) - 48;
      rem = v > 9 ? (rem * 100 + v) % 97 : (rem * 10 + v) % 97;
    }
    return rem;
  }
  function ibanValid(s) {
    if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(s)) return false;
    return mod97(s.slice(4) + s.slice(0, 4)) === 1;
  }

  // "1.234,56" | "1 234,56" | "12,50" | "1,234.56" | "89.00" | "500" -> Number.
  function parseAmount(raw) {
    let s = String(raw).replace(/[^\d.,]/g, "");
    if (!s) return NaN;
    const hasDot = s.includes("."), hasComma = s.includes(",");
    if (hasDot && hasComma) {
      const dec = s.lastIndexOf(",") > s.lastIndexOf(".") ? "," : ".";
      const tho = dec === "," ? "." : ",";
      s = s.split(tho).join("").replace(dec, ".");
    } else if (hasComma) {
      const after = s.slice(s.lastIndexOf(",") + 1);
      s = after.length === 3 && s.indexOf(",") === s.lastIndexOf(",")
        ? s.replace(/,/g, "") : s.replace(/,/g, ".");
    } else if (hasDot) {
      const after = s.slice(s.lastIndexOf(".") + 1);
      if (after.length === 3 && s.indexOf(".") === s.lastIndexOf(".")) s = s.replace(/\./g, "");
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  // Every valid IBAN, in order, de-duplicated. Scans from every "CCkk" start so
  // adjacent accounts bridged by text (grouping spaces, a bank name in between)
  // are each found; from each start it takes the longest valid prefix, so a
  // trailing word ("…1000 here") isn't swallowed.
  function findAllIbans(text) {
    const up = text.toUpperCase();
    const out = [];
    const startRe = /[A-Z]{2}[0-9]{2}/g;
    let m;
    while ((m = startRe.exec(up))) {
      const window = up.slice(m.index, m.index + 40).replace(/[^A-Z0-9]/g, "");
      for (let len = Math.min(34, window.length); len >= 15; len--) {
        const cand = window.slice(0, len);
        if (ibanValid(cand)) { if (!out.includes(cand)) out.push(cand); break; }
      }
    }
    return out;
  }
  const findIban = (text) => findAllIbans(text)[0] || "";

  const AMOUNT_KEYS = /(?:iš\s*viso|is\s*viso|mok[ėe]tin\w*|suma|mok[ėe]ti|ap?mok[ėe]ti|[įi]moka|grand\s*total|total\s*due|amount\s*due|balance\s*due|total|amount|to\s*pay)/i;
  // A money token with a 2-digit fraction, e.g. "85,00" or "1.234,56".
  const MONEY = /(?<![\d.,])(?:\d{1,3}(?:[ .]\d{3})*|\d+)[.,]\d{2}(?![\d])/g;

  function stripIbans(s) { return s.replace(/[A-Z]{2}\d{2}[A-Z0-9 ]{10,}/gi, ""); }

  function findAmount(text) {
    const plausible = (n) => Number.isFinite(n) && n > 0 && n <= 999999999.99;
    const keyed = [];
    for (const line of text.split(/\r?\n/)) {
      if (!AMOUNT_KEYS.test(line)) continue;
      const money = stripIbans(line).match(MONEY);   // decimal amount on a total line
      if (money) keyed.push(...money.map(parseAmount).filter(plausible));
    }
    if (keyed.length) return keyed[keyed.length - 1];

    const tagged = [];
    for (const line of text.split(/\r?\n/)) {
      const cur = stripIbans(line).match(/(?:€|EUR)\s*([\d .,]+)|([\d .,]+)\s*(?:€|EUR)/i);
      if (cur) { const n = parseAmount(cur[1] || cur[2]); if (plausible(n)) tagged.push(n); }
    }
    if (tagged.length) return Math.max(...tagged);

    // Fallback: any money-shaped token in the doc (e.g. a table cell "85,00").
    const tokens = (stripIbans(text).match(MONEY) || []).map(parseAmount).filter(plausible);
    if (tokens.length) return tokens.length === 1 ? tokens[0] : Math.max(...tokens);
    return NaN;
  }

  function findReference(text) {
    const up = text.toUpperCase();
    const rf = up.match(/\bRF\d{2}[A-Z0-9]{1,21}\b/);
    if (rf) return rf[0];
    // Lithuanian "unique payment code" / ROIK (goes in the payment reference).
    if (/ROIK|UNIKALUS\s+MOK[ĖE]JIMO\s+KODAS|IDENTIFIKACIN\w*\s+KOD/i.test(text)) {
      const roik = text.match(/\b\d{10,13}\b/);
      if (roik) return roik[0];
    }
    const m = text.match(/(?:[įi]mokos\s*kodas|mok[ėe]jimo\s*kodas|payment\s*(?:code|reference)|s[ąa]skait\w*\s*(?:serija\s*)?nr\.?|invoice\s*(?:no\.?|number|#)?)\s*[:#]?\s*([A-Za-z0-9][A-Za-z0-9\-\/]{2,34})/i);
    return m && /\d/.test(m[1]) ? m[1].trim() : "";   // require a digit — avoids grabbing a stray word
  }

  function findName(text, iban) {
    const lines = text.split(/\r?\n/).map((l) => l.trim());
    const key = /(?:gav[ėe]jas|beneficiary|payee|pay\s*to|recipient|supplier|seller|pardav[ėe]jas)/i;
    const cut = (s) => {
      let out = s.split(/,\s*(?:juridinio|[įi]mon[ėe]s|asmens|kodas)/i)[0].split(",")[0];
      return out.trim().slice(0, 70);
    };
    for (let i = 0; i < lines.length; i++) {
      if (!key.test(lines[i])) continue;
      const after = lines[i].split(/[:\-–—―]/).slice(1).join(" ").trim();
      if (after) { const c = cut(after); if (c) return c; }
      for (let j = i + 1; j < lines.length; j++) if (lines[j]) return cut(lines[j]);
    }
    if (iban) {
      const idx = lines.findIndex((l) => l.replace(/\s+/g, "").toUpperCase().includes(iban));
      for (let j = idx - 1; j >= 0; j--) if (lines[j]) return cut(lines[j]);
    }
    const co = lines.find((l) => /\b(UAB|AB|MB|IĮ|VšĮ|Ltd|LLC|GmbH|OÜ|SIA|Oy)\b/i.test(l));
    return co ? cut(co) : "";
  }

  // Returns { iban, ibans[], amount:Number|null, message, name, found:{...} }.
  function parse(text) {
    const t = String(text || "");
    const ibans = findAllIbans(t);
    const iban = ibans[0] || "";
    const amount = findAmount(t);
    const message = findReference(t);
    const name = findName(t, iban);
    return {
      iban, ibans,
      amount: Number.isFinite(amount) ? amount : null,
      message, name,
      found: { iban: !!iban, amount: Number.isFinite(amount), message: !!message, name: !!name },
    };
  }

  return { parse, parseAmount, findIban, findAllIbans, findAmount, findReference, findName, ibanValid };
});
