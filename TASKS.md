# SEPA Payment QR — tasks

## Done
- [x] Vendor a QR encoder offline — `qrcode-generator` 1.4.4 (MIT).
- [x] EPC069-12 payload builder (LF fields, trailing-empty trim, ≤331 B guard).
- [x] IBAN ISO 7064 mod-97 validation; BIC + amount + purpose validation.
- [x] UTF-8 charset `1` encoding (Lithuanian/accented names).
- [x] Live form, canvas render, Download PNG, Copy raw text.
- [x] Demo-data button (checksum-valid random IBANs, LT/DE/EE/LV).
- [x] **Shareable payment link** — fields in URL hash (`#name=…&iban=…&amt=…`),
      read on load, "Copy link" button, address bar kept in sync. Hash keeps
      the IBAN client-side (never sent to a server).
- [x] Verify: jsQR decode round-trip + headless-Chrome render + link read/sync.
- [x] **Refactor**: pure EPC core split into `app/epc.js` (no DOM), shared by
      the app and the tests; `app.js` is now DOM glue.
- [x] **Test suite** (`npm test`): node unit + jsQR round-trip (17 tests) +
      Selenium integration driving the real page (20 checks). All green.
- [x] Fixed via tests: per-field limits are characters (not bytes) to match the
      spec + `maxlength`; the 331-byte cap is the real guard (multibyte-reachable).
- [x] Fixed via tests: `hashchange` listener so a shared link pasted into an
      already-open tab still prefills (hash-only nav doesn't reload).
- [x] **Beautiful QR styling** — rounded/dot/square modules, styled finder eyes,
      brand colour/gradient. Default "Beautiful" preset; Mono/Dots/Classic +
      Custom; remembered in `localStorage`. Every preset decode-tested (in-page
      jsQR) so styling never breaks scanning; dots use "Q" error correction.
- [x] **Styling v2** (from EPC/pretty-qr refs) — independent **outer + inner eye**
      shapes (rounded/leaf/circle/square), **linear & radial** gradients, new
      **Vivid** preset, and an optional **centre logo** (auto EC→"H", white
      knockout). Logo + Vivid added to the decode tests (30 integration checks).
- [x] Spec-checked payload against EPC069-12 / epc-qr.eu / Wikipedia — fields,
      order, limits, charsets all match.
- [x] **Bill auto-fill** — upload a `.txt` bill or paste its text; `bill.js`
      parses IBAN (mod-97) / amount (labelled total, EU+US formats) / reference
      (RF, Įmokos kodas, invoice) / payee and fills the form. Unit-tested (LT +
      EN) + integration (upload + paste). Honest "check before paying" note.
- [x] **WebMCP compatible** — `webmcp.js` registers `fill_payment`, `parse_bill`,
      `get_payment`, `read_bill_document`, `make_link_qr` via `document.modelContext`
      (same pattern as the inflation tool). Integration-tested against a polyfilled
      host. Closes the loop for PDFs/photos: agent reads the doc, calls fill.
- [x] **Link / text mode** — a mode toggle (Payment vs Link/text) to encode any
      URL/text (e.g. `revolut.me/…`) in the same styles incl. dots + centre logo,
      i.e. the "event-card" look. Remembered in `localStorage`; WebMCP
      `make_link_qr` tool. Encode→decode verified in the integration test.

- [x] **PDF bill reading** — vendored pdf.js reads text PDFs in-browser (served
      over http), incl. a real **VMI tax-fine PDF**: table amount `85,00`, ROIK
      reference, payee, and a **multi-account chooser** for its 7 IBANs. Parser
      rewritten to scan from every IBAN start (bridged accounts) and use pdf.js
      `hasEOL` to keep line structure. Unit + integration tested.

- [x] **Render quality** — smooth (not `pixelated`) canvas, supersampled at
      cell=16, and a snug logo knockout. Closes most of the gap to a printed card.
- [x] **Saved payees** — Save/load/delete recurring payments via `localStorage`
      (reload one, change the amount). Removed the "Pay a bill" heading. Fixed a
      `hidden`-vs-`display` bug that showed the empty account chooser on load.

## Backlog
- [ ] **Opt-in "airy dots"** — smaller separated dots like the printed card. They
      scan on phones but fail our jsQR check (AA + jsQR strictness), so they'd ship
      as an explicitly-unverified style with a warning, outside the decode test.
- [ ] **Scanned-image OCR** — Tesseract.js for photo/scanned bills so they
      auto-fill without a WebMCP agent. Text PDFs already work via pdf.js;
      scanned ones still rely on the agent via `read_bill_document`.
- [ ] Detect a structured `RF…`/`Įmokos kodas` from a bill and route it to the
      structured remittance field (field 10) instead of unstructured (field 11).
- [ ] Test WebMCP against a real host (Chrome origin trial) — current test uses a
      `document.modelContext` polyfill.
- [ ] **Structured creditor reference (RF / ISO 11649)** input — Baltic bills
      use the structured remittance line (field 10), not free text. Add a
      toggle: message vs structured ref, with RF check-digit validation.
- [ ] Country-specific IBAN length table for a friendlier error than "checksum
      failed" (e.g. "LT IBAN is 20 chars, you have 18").
- [ ] Optional logo in the QR centre (needs higher error-correction level `H`).
- [ ] Print stylesheet — clean A4 QR + details for taping to an invoice.
- [ ] Real-device confirmation: scan a generated code with the actual Revolut
      and SEB apps and record which fields each auto-fills.

## Open questions
- Do we want ISO 8859-1/-4 charsets as a fallback, or is UTF-8 (charset `1`)
  universally accepted by target apps? Current assumption: UTF-8 only.
