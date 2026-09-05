# Lessons — SEPA Payment QR

## The standard is EPC069-12, and it's the only one you need
Revolut / SEB / N26 / Wise "scan to pay" all read the **European Payments
Council** QR (EPC069-12, "GiroCode"). There is no Revolut-specific format —
build the EPC payload once and every SEPA bank app understands it. EUR-only by
design.

## Field order is load-bearing; only trailing empties may be dropped
The payload is positional LF-separated fields. If you want an unstructured
message (field 11) but no amount/purpose/structured-ref, fields 8–10 must still
be present as **empty lines** to hold the position. Rule: assemble all 12
fields, then pop only trailing empties. See [app/app.js](app/app.js#L119).

## UTF-8 in a QR: encode to bytes yourself, then use the default byte encoder
`qrcode-generator`'s default `stringToBytes` does `charCodeAt(i) & 0xff` — it
drops anything above U+00FF, so raw Lithuanian names (ž, ė, ą) corrupt. Fix
without pulling the extra multibyte module:

```js
const bin = unescape(encodeURIComponent(str)); // -> binary string, 1 char = 1 UTF-8 byte
qr.addData(bin, "Byte");                        // default encoder now emits real UTF-8
```

Set EPC charset field to `1` (UTF-8) to match. The decode round-trip proves it.

## Render from the matrix, not from `createSvgTag`/`createDataURL`
Drawing the modules onto a `<canvas>` via `getModuleCount()` + `isDark(r,c)`
uses only stable API (no library-version surprises), gives crisp control of
cell size + quiet-zone margin, and makes **Download PNG** a one-liner
(`canvas.toDataURL`). Quiet zone matters: scanners need ~4 modules of white
border or they won't lock on.

## Verify by decoding, not by eyeballing
A QR that *looks* right can still be wrong. Real verification = round-trip:

```
cd <scratchpad> && npm install jsqr
# build RGBA from qr.isDark(), feed jsQR(data, size, size), assert == payload
```

Round-trip caught nothing broken here only because the UTF-8 fix was already in
— without it, the Lithuanian case fails the assert loudly. Re-run after any
change to encoding or field assembly.

## Re-run the checks
`npm test` (unit + jsQR round-trip + Selenium integration). `npm run test:unit`
skips the browser. The one-off `--dump-dom` / screenshot harnesses used while
building are superseded by `test/integration.py`.

## Shareable link: put the data in the hash, not the query
Prefill params carry an IBAN. In the `?query`, that value is sent to the server
on every request and lands in access logs; in the `#hash` it never leaves the
browser. So the "Copy link" feature encodes fields into `location.hash`
(`readLink()` reads hash first, `?query` only as a paste-in fallback) and
`history.replaceState` keeps the bar in sync without flooding history. Round-trip
verified in Chrome including Lithuanian UTF-8 (`URLSearchParams` decodes %XX as
UTF-8, so `Žėrutis` survives).

## Per-field limits are characters; the byte cap is a separate total
The tests forced this straight. EPC per-field limits (name 70, message 140) are
**characters** — mirror them with input `maxlength`. Validating those fields in
*bytes* is wrong: it rejects legit multibyte input and mislabels the error
("characters" while counting bytes). The real byte constraint is the **331-byte
whole-payload** cap, and it *is* reachable — 70 + 140 chars of 2-byte Lithuanian
text is ~460 bytes. So: per-field checks in characters, one byte check on the
assembled payload. An earlier "the 331 guard can never fire" hunch was wrong; it
only holds if fields are byte-capped, which they shouldn't be.

## A hash-only URL change doesn't reload — add a `hashchange` listener
Prefill-from-link read the hash on load. But opening a share link in an
*already-open* tab changes only the fragment, so the page never reloads and the
read never runs — the recipient sees stale fields. Fix: re-read on `hashchange`.
`history.replaceState` (used to sync the bar while typing) does **not** fire
`hashchange`, so there's no feedback loop. Caught by the Selenium test navigating
between two same-path URLs.

## Refactor for tests: pull the pure logic out of the DOM glue
`app.js` began as validation + assembly + DOM all in one, so nothing was
unit-testable without a browser. Splitting the pure core into `app/epc.js` (a
tiny UMD: `module.exports` under node, `window.EPC` in the browser) let node
`--test` exercise every branch in milliseconds, leaving Selenium to cover only
what truly needs a DOM. Same source runs in both — no logic duplicated between
app and tests.

## Why the printed card looked prettier than our render (aesthetics fixes)
Investigated a real printed dot-style card vs our output. Four causes, three fixable:
1. **`image-rendering: pixelated`** on the canvas made every dot/curve jagged when
   scaled. Switching to smooth (`auto`) was the single biggest win.
2. **Low resolution** (cell=10). Bumped to cell=16 (supersampled — the CSS shrinks
   it to ~320px, so curves anti-alias smoothly). Also crisper for print/PNG.
3. **Boxy logo knockout** — a big white rounded rect. Now a snug knockout hugging
   the logo's actual drawn size (pad ~0.35 cell) reads much cleaner.
4. **Airy separated dots** (the card's look) — NOT fixable while keeping our decode
   guarantee. A browser sweep with real anti-aliasing showed **only radius 0.5
   (touching) decodes with jsQR**; 0.49 and below fail at any sane resolution
   (AA shaves ~1px off each dot; jsQR is far stricter than a phone camera, which
   reads the airy print fine). So dots stay at 0.5. Lesson: verify decodability in
   the *browser* (anti-aliased) — a hard-edged node rasterization is too optimistic
   (it "passed" 0.46).

## Pretty QR must be decode-tested, and "dots" are the trap
Rounded modules and styled finder eyes scan fine; **isolated dot modules do
not** — a gap around each circle breaks jsQR's module-grid sampling (it decoded
Beautiful/Mono/Classic but failed Dots on the first try). Two fixes together:
draw dots at radius = half-cell so orthogonal neighbours *touch* (grid stays
readable), and give the dots preset "Q" (25%) error correction for headroom.
The rule that made this safe: the integration test injects jsQR and **decodes
every preset's real canvas back to the exact payload** — so a style that looks
good but won't scan fails CI, not a customer at a till. Keep all presets
dark-on-white with the full 4-module quiet zone; ship a plain "Classic" preset
as the always-works fallback.

## Centre logo works because error correction pays for it
A logo knocks out modules under it. That only stays scannable if the lost data is
recoverable: bump error correction to **H** (30%) whenever a logo is set, keep the
logo small (~22% of the side ≈ 5% area), and put it on a white rounded knockout
so the boundary is clean. Verified by the integration test — it uploads a fixture
logo (`test/fixtures/logo.png`) via the file input and decodes the canvas back to
the payload. Note EC=H makes the QR denser (more modules); that's the trade for a
logo, and it's automatic, not a user knob.

## Selenium: file inputs ignore visibility, buttons don't
`send_keys(path)` to `<input type=file>` works even when the element is inside a
closed `<details>` (Selenium special-cases file inputs). A normal button in the
same closed `<details>` has no layout, so `.click()` throws
ElementNotInteractable — click it via `execute_script` instead (or open the
`<details>` first).

## WebMCP-native answer to "OCR the bill": expose the document, let the agent read
The page can't OCR a PDF/photo offline without a heavy dependency. Rather than
ship Tesseract, the WebMCP layer exposes `read_bill_document` (returns the file's
text or a base64 data URL) plus `fill_payment`. A multimodal agent reads what the
page can't and calls back to fill. The page stays light; the agent brings the
vision. For the digital-invoice common case, a small local text parser
(`bill.js`, `.txt`/paste) handles it with no agent at all. Two paths, same fill.

## Test WebMCP by polyfilling the host before the page loads
No WebMCP host exists in headless Chrome, so the tools never register. Inject a
tiny `document.modelContext.registerTool` polyfill via CDP
`Page.addScriptToEvaluateOnNewDocument` (runs before page scripts), then drive
the async `execute()` with Selenium `execute_async_script`. That tests the real
tool code against the real page. Feature-detection means the same tools are a
silent no-op when no host is present — the UI is unaffected.

## Parsing an IBAN out of prose: take the longest valid prefix
A regex that allows the IBAN's grouping spaces (`[A-Z0-9 ]+`) happily swallows
the next word too ("…1000 here" → invalid). The unit test caught it. Fix: match a
generous run, strip non-alphanumerics, then try decreasing-length prefixes
(34→15) and return the first that passes mod-97. The true IBAN is the longest
valid prefix; trailing words fall off.

## Bill amounts: last separator wins, and prefer the labelled total
Amounts come in "1.234,56", "1 234,56", "12,50", "1,234.56". Rule that covers
them: if both `.` and `,` appear, the **last** one is the decimal; a lone `,`/`.`
with exactly 3 trailing digits is thousands, else decimal. And pick the number on
a *Total / Suma / Mokėti* line over a bare number, so a subtotal doesn't win.

## Reading a real bill PDF: keep the lines, scan every IBAN start
Two bugs a screenshot/test caught on an actual VMI tax-fine PDF:
1. **Flattened lines.** Joining a pdf.js page's text items with spaces makes the
   whole page one line, so the payee heuristic grabbed a table row instead of
   "Valstybinė mokesčių inspekcija". Fix: honour each item's `hasEOL` flag to
   rebuild real line breaks. Line-based heuristics (payee, totals) depend on it.
2. **Bridged accounts.** The bill lists 7 IBANs, each followed by an ASCII bank
   name. A greedy `[A-Z0-9 ]+` run bridged two IBANs (e.g. "LT05 … AB SEB bankas
   … LT32"), and breaking after the first valid prefix dropped the second. Fix:
   scan from every `CCkk` start independently (bounded 40-char window, longest
   valid prefix) instead of matching greedy runs. Now all 7 are found and offered
   in a chooser.
Also: a table's amount often has no inline keyword ("Mokėtina suma" is a header
row, "85,00" a cell), so fall back to any money-shaped token (`\d…[.,]\d\d`) when
no labelled total is found. And prefer the Lithuanian **ROIK / Unikalus mokėjimo
kodas** as the reference over the generic *Įmokos kodas*.

## localStorage persistence bleeds between test sections on the same origin
The mode toggle (payment vs link) is saved to `localStorage`. The Selenium link
test flipped to link mode, and because every `file://` page shares one origin's
storage, the *next* section loaded in link mode and its payment assertions broke.
Fix: restore payment mode at the end of the link test. (The http-served PDF
section was unaffected — different origin, separate storage.) Lesson: any test
that changes persisted UI state must reset it, or use a fresh profile.

## pdf.js worker needs http, not file://
pdf.js loads its worker script; browsers block workers from `file://` (origin
`null`). So the app must be served (`python3 -m http.server`) for PDF reading,
and the Selenium PDF test spins up a localhost `http.server` for that one case
(the rest run fine from `file://`). The app catches the worker failure and falls
back to "paste the text / use your AI assistant".

## Stale chromedriver on PATH shadows Selenium Manager
Selenium 4 will fetch a driver matching the installed Chrome — unless an old
`chromedriver` sits on `PATH`, which it silently prefers (only a warning), then
fails with "only supports Chrome version 132 / current browser is 152". Fetch a
matching build from Chrome-for-Testing and pass it explicitly; the test honours a
`$CHROMEDRIVER` env override for exactly this.

## Attribution
QR encoder: `qrcode-generator` 1.4.4 © 2009 Kazuhiko Arase, MIT
(`app/lib/qrcode.js`). Vendored, not CDN-loaded, so the tool works fully offline.
