# SEPA Payment QR

Static, offline, vanilla-JS tool that turns transfer details (name, IBAN,
amount, message) into a **scan-to-pay QR code**. Point Revolut, SEB, Swedbank,
N26, Wise — any bank app that reads the European **EPC069-12** QR standard
(a.k.a. *SEPA Credit Transfer QR* / *GiroCode*) — at the code and it auto-fills
the payment. No manual typing of the IBAN.

**State:** `active` — verified end-to-end (Chrome render + QR decode round-trip).

## Why EPC069-12

Revolut's "scan QR" and most EU bank apps don't read a proprietary format —
they read the one published standard: **EPC069-12**, *"Quick Response Code:
Guidelines to Enable the Data Capture for the Initiation of a SEPA Credit
Transfer"*. So one encoder covers every SEPA bank; there is no per-bank code.

The payload is LF-separated fields (see [app/app.js](app/app.js#L4)):

```
BCD            service tag
002            version (002 = BIC optional)
1              character set (1 = UTF-8)
SCT            SEPA Credit Transfer
<BIC>          optional
<Name>         mandatory, max 70
<IBAN>         mandatory
<EURamount>    optional, e.g. EUR12.50, range 0.01–999999999.99
<Purpose>      optional, max 4
<Structured>   structured creditor reference,   max 35  ┐ one or
<Unstructured> unstructured free-text remittance, max 140 ┘ the other
<Info>         optional note, max 70
```

Constraints enforced by the app:
- **Euro only** — the standard is EUR-only by design.
- Whole payload **≤ 331 bytes** (byte counter shown; blocks over-limit).
- IBAN validated by **ISO 7064 mod-97** checksum, not just a length check
  ([app/app.js](app/app.js#L46)).
- UTF-8 (charset `1`) so Lithuanian/accented names (č, š, ž, ė, ą) survive —
  proven by the decode round-trip.

Field IDs, order, and the limits above are per **EPC069-12** (v2/"002"), the
same layout used by the [European Payments Council guidance][epc] and reference
generators like [epc-qr.eu][epcqr] / [Wikipedia's EPC QR page][wiki]. Verified
against those refs; the one deliberate gap is the **structured creditor reference
(ISO 11649 "RF…")** in field 10 — the app writes free-text remittance (field 11)
today, structured RF is on the backlog for Baltic-style bills.

[epc]: https://www.europeanpaymentscouncil.eu/document-library/guidance-documents/quick-response-code-guidelines-enable-data-capture-initiation
[epcqr]: https://epc-qr.eu/?help
[wiki]: https://en.wikipedia.org/wiki/EPC_QR_code

## Run

Pure static files, no build. Open [app/index.html](app/index.html) in a browser,
or serve the folder:

```
cd app && python3 -m http.server 8000   # then http://localhost:8000
```

Fill **name + IBAN** (minimum). Amount, message, BIC, purpose are optional. The
QR regenerates live; **Download PNG** to print/share, **Copy raw text** for the
EPC payload. Everything runs client-side — nothing you type leaves the page.

**Saved payees.** **Save** stores the current payment (keyed by beneficiary
name) in `localStorage`; the dropdown reloads it later so you can pay a recurring
recipient by just changing the amount. **✕** deletes the selected one.

**Shareable link.** **Copy link** gives a URL that reopens the app already
filled (`…/index.html#name=…&iban=…&amt=…`), so a business can send one link and
the recipient just scans. The data sits in the URL **hash**, so it is never sent
to a server — the IBAN stays on the client. The address bar stays in sync, so
reload and bookmark work too.

**Styling.** The **Style** panel restyles the QR: module shape (rounded / dots /
square), the finder "eyes" styled independently — **outer** (rounded / leaf /
circle / square) and **inner** pupil (rounded / circle / square) — a brand colour
or **linear/radial gradient**, and an optional **centre logo**. Presets:
**Classic** (default — plain black square modules, the most widely scannable),
*Beautiful* (rounded, navy→blue linear gradient, rounded eyes), *Mono*, *Dots*,
and *Vivid* (leaf eyes + purple radial), plus per-control Custom. Choices are
remembered in `localStorage` (the logo is session-only). Every preset stays dark-on-white
with a full quiet zone and is **decode-tested** so prettier never means
unscannable: dots and logos raise the error-correction level automatically (dots
"Q", logo "H"). The **Dots + centre logo** combination is the "event-card" look
(dot modules, rounded-square eyes, a logo in the middle).

## Link / text mode

A toggle at the top switches between **Payment (SEPA)** and **Link / text**. In
link mode you type any URL or text (e.g. `revolut.me/blakedesigner`, a form, a
video link) and get it as a QR in the same styles — dots, gradient, centre logo —
so you can make tip/booking/karaoke-style cards, not just bank transfers. The
choice is remembered in `localStorage`; the payment-only share link is hidden in
link mode.

## Pay a bill (auto-fill)

**Paste a bill's text** (it auto-fills as you paste) or **drop a `.txt`/PDF/photo**
onto the box, and the form is prefilled — no manual typing, no buttons. [bill.js](app/bill.js) heuristically pulls out the
**IBAN** (mod-97 validated), **amount** (labelled *Total / Suma / Mokėtina …*,
EU and US number formats, incl. a bare table cell like `85,00`), **reference**
(ISO 11649 `RF…`, a Lithuanian *ROIK / Unikalus mokėjimo kodas*, *Įmokos kodas*,
invoice no.) and **payee**, then builds the QR. If the bill lists **several
accounts** (e.g. a tax bill with one IBAN per bank), a **chooser** lets you pick
yours. It always shows *"check the details before paying."* — treat it as a
draft, not gospel.

Text PDFs are read in-browser with **pdf.js** (vendored, offline); this needs the
page served over http (`python3 -m http.server`) because pdf.js loads a worker.
A **scanned photo/PDF** has no text to extract, so the page hands it to a
connected AI agent instead (see WebMCP below). Worked example: a real Lithuanian
**VMI tax-fine PDF** → payee, `85,00 €`, ROIK reference, and all 7 payment
accounts, verified in the test suite.

## WebMCP

The page is a [WebMCP](https://github.com/webmachinelearning/webmcp) tool surface
([webmcp.js](app/webmcp.js), same `document.modelContext.registerTool` pattern as
the other tools in this repo). When a browser agent (Chrome WebMCP origin trial /
ChatGPT) is present it registers four tools; with no host the page is unchanged:

- **`fill_payment`** — set payee/IBAN/amount/reference/BIC/purpose and generate
  the QR; returns the EPC payload + validation errors.
- **`parse_bill`** — extract fields from a bill's text and fill the form.
- **`get_payment`** — read the current fields, EPC payload, validity, and the QR
  as a PNG data URL.
- **`read_bill_document`** — return the last uploaded document (text for `.txt`,
  or a base64 data URL for a PDF/photo) so a **multimodal agent can read what the
  page can't OCR** and then call `fill_payment`.

That closes the loop for any document: user uploads a bill → agent reads it via
`read_bill_document` → calls `fill_payment` → user scans and pays.

## Layout

```
sepa-payment-qr/
├── README.md
├── TASKS.md
├── LESSONS.md
├── package.json        test scripts + jsQR devDependency
├── app/
│   ├── index.html      form + output
│   ├── epc.js          pure EPC069-12 core (validation, assembly, links) — no DOM
│   ├── bill.js         pure bill-text parser (IBAN/amount/ref/payee) — no DOM
│   ├── app.js          DOM glue: read form, call EPC, render canvas QR, bill import
│   ├── webmcp.js       WebMCP tool layer (agent-callable fill/parse/get tools)
│   ├── style.css
│   └── lib/             vendored: qrcode-generator 1.4.4 (MIT) + pdf.js 3.11 (Apache-2.0)
└── test/
    ├── unit.test.mjs     node:test over epc.js
    ├── bill.test.mjs     node:test over bill.js (parser, amount formats, VMI fine)
    ├── roundtrip.test.mjs encode -> jsQR decode, byte-identical
    ├── integration.py    Selenium: drives the real index.html (+ http for PDF)
    └── fixtures/         logo, sample bills, a real VMI tax-fine PDF
```

## Tests

```
npm install          # dev-only: jsQR (for the decode round-trip)
npm test             # node unit + round-trip, then the Selenium integration test
npm run test:unit    # node --test only (no browser)
npm run test:e2e     # Selenium integration only
```

Three layers:
- **Unit** ([test/unit.test.mjs](test/unit.test.mjs), [test/bill.test.mjs](test/bill.test.mjs))
  — the pure cores in [app/epc.js](app/epc.js) and [app/bill.js](app/bill.js):
  IBAN mod-97 (valid DE/LT/BE/GB + tampered), `buildEpc` validation, field order +
  trailing-trim, amount formatting, char-vs-byte limits, 2000 random-IBAN checks,
  link build/parse round-trip, and the bill parser (LT + EN invoices, EU/US amount
  formats, IBAN extraction that won't swallow trailing words).
- **Round-trip** ([test/roundtrip.test.mjs](test/roundtrip.test.mjs)) — encode a
  payload with the vendored QR lib, decode the pixels with **jsQR**, assert
  byte-identical for ASCII, Lithuanian UTF-8 (`UAB Žėrutis Ą`), and amount-less.
- **Integration** ([test/integration.py](test/integration.py)) — headless Chrome
  (Selenium) drives the real `index.html`: demo button fills valid data + renders;
  invalid IBAN shows an error and blocks the QR; valid entry yields a correct EPC
  payload; an over-331-byte multibyte payload is blocked; a shareable link
  prefills fields, opens Advanced, and keeps the address bar in sync; **every
  style preset — plus a centre-logo code — is decoded back with an in-page jsQR**
  to prove it still scans; a **`.txt`/pasted bill auto-fills** the form; and the
  **WebMCP tools** are exercised against a polyfilled host (fill/parse/get/read);
  and a real **VMI tax-fine PDF** is uploaded (served over http) and parsed to
  amount + ROIK + all 7 accounts via pdf.js; and **link/text mode** encodes an
  arbitrary URL and decodes it back; and a **saved payee** round-trips through
  `localStorage` (save → clear → reload).

Latest run: **23/23** node tests, **55/55** integration checks.

**ChromeDriver note:** the integration test lets Selenium Manager fetch a driver
matching your Chrome. If a stale `chromedriver` on `PATH` shadows it (version
mismatch), point at a good one:
`CHROMEDRIVER=/path/to/chromedriver npm run test:e2e`.

## Scope / not-goals

Not affiliated with any bank. Generates the payment *request* QR only; it never
moves money — the user still confirms the transfer in their own bank app.
Non-euro and non-SEPA schemes are out of scope (the standard doesn't cover them).
