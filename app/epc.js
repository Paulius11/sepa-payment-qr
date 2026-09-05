/* EPC069-12 core logic — pure, no DOM. Shared by the browser app (app.js) and
 * the node test suite (test/). Exposes `EPC` on the global in a browser and via
 * module.exports under node.
 *
 * EPC069-12 payload (LF-separated fields):
 *   BCD / 002 / 1 / SCT / <BIC> / <Name> / <IBAN> / <EURamount> / <Purpose> /
 *   <Structured> / <Unstructured> / <Info>
 * Trailing empty fields may be dropped; whole payload must be <= 331 bytes.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.EPC = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_PAYLOAD_BYTES = 331;
  const MAX_AMOUNT = 999999999.99;

  // ISO 7064 mod-97 over a string, letters A=10..Z=35, fed digit-wise.
  function mod97(str) {
    let rem = 0;
    for (const ch of str.toUpperCase()) {
      const v = ch >= "A" ? ch.charCodeAt(0) - 55 : ch.charCodeAt(0) - 48;
      rem = v > 9 ? (rem * 100 + v) % 97 : (rem * 10 + v) % 97;
    }
    return rem;
  }

  // IBAN: shape + rearranged mod-97 == 1.
  function ibanValid(raw) {
    const s = raw.replace(/\s+/g, "").toUpperCase();
    if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(s)) return false;
    return mod97(s.slice(4) + s.slice(0, 4)) === 1;
  }

  const bicValid = (s) => /^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(s);

  // Build a checksum-valid IBAN with a random numeric BBAN (for demo data).
  function randomIban(cc, bbanLen) {
    let bban = "";
    for (let i = 0; i < bbanLen; i++) bban += Math.floor(Math.random() * 10);
    const check = 98 - mod97(bban + cc + "00");
    return cc + String(check).padStart(2, "0") + bban;
  }

  // UTF-8 byte length of a string.
  function utf8Len(str) {
    return unescape(encodeURIComponent(str)).length;
  }

  // String -> binary string, one char per UTF-8 byte (0–255), so a QR byte
  // encoder that does charCodeAt&0xff emits real UTF-8 (EPC charset "1").
  function toUtf8Bytes(str) {
    return unescape(encodeURIComponent(str));
  }

  // Validate + assemble. `input` holds raw field strings (as typed).
  // Returns { ok, errors:{field:msg}, missing, tooLong, payload, bytes, normalized }.
  function buildEpc(input) {
    const name = (input.name || "").trim().replace(/[\r\n]+/g, " ");
    const iban = (input.iban || "").replace(/\s+/g, "").toUpperCase();
    const amountRaw = (input.amount || "").trim().replace(",", ".");
    const message = (input.message || "").trim().replace(/[\r\n]+/g, " ");
    const bic = (input.bic || "").replace(/\s+/g, "").toUpperCase();
    const purpose = (input.purpose || "").trim().toUpperCase();

    const errors = {};
    let amount = "";

    // Per-field limits are in CHARACTERS (EPC spec; the inputs' maxlength mirrors
    // these). The byte budget is enforced once on the whole payload below.
    if (name.length > 70) errors.name = "Max 70 characters.";
    if (iban && !ibanValid(iban)) errors.iban = "Invalid IBAN (checksum failed).";
    if (amountRaw) {
      const n = Number(amountRaw);
      if (!Number.isFinite(n) || n <= 0) errors.amount = "Enter a positive number.";
      else if (n < 0.01 || n > MAX_AMOUNT) errors.amount = "Range 0.01–999999999.99.";
      else amount = "EUR" + n.toFixed(2);
    }
    if (bic && !bicValid(bic)) errors.bic = "BIC must be 8 or 11 letters/digits.";
    if (message.length > 140) errors.message = "Max 140 characters.";

    const normalized = { name, iban, amount, message, bic, purpose };
    const missing = !name || !iban;

    if (Object.keys(errors).length || missing) {
      return { ok: false, errors, missing, tooLong: false, payload: "", bytes: 0, normalized };
    }

    // Assemble the 12 fields, then drop only trailing empties.
    const fields = ["BCD", "002", "1", "SCT", bic, name, iban, amount, purpose, "", message, ""];
    while (fields.length && fields[fields.length - 1] === "") fields.pop();
    const payload = fields.join("\n");
    const bytes = utf8Len(payload);

    if (bytes > MAX_PAYLOAD_BYTES) {
      return { ok: false, errors: {}, missing: false, tooLong: true, payload, bytes, normalized };
    }
    return { ok: true, errors: {}, missing: false, tooLong: false, payload, bytes, normalized };
  }

  const LINK_KEYS = ["name", "iban", "amt", "msg", "bic", "purpose"];

  // Fields {name,iban,amt,msg,bic,purpose} (raw) -> normalized query string.
  function buildLinkQuery(f) {
    const p = new URLSearchParams();
    const set = (k, v) => { if (v) p.set(k, v); };
    set("name", (f.name || "").trim());
    set("iban", (f.iban || "").replace(/\s+/g, "").toUpperCase());
    set("amt", (f.amt || "").trim().replace(",", "."));
    set("msg", (f.msg || "").trim());
    set("bic", (f.bic || "").replace(/\s+/g, "").toUpperCase());
    set("purpose", (f.purpose || "").trim().toUpperCase());
    return p.toString();
  }

  // Query/hash string -> object with only the keys present.
  function parseLinkQuery(raw) {
    const p = new URLSearchParams(raw);
    const out = {};
    for (const k of LINK_KEYS) if (p.has(k)) out[k] = p.get(k);
    return out;
  }

  return {
    MAX_PAYLOAD_BYTES, MAX_AMOUNT, LINK_KEYS,
    mod97, ibanValid, bicValid, randomIban, utf8Len, toUtf8Bytes,
    buildEpc, buildLinkQuery, parseLinkQuery,
  };
});
