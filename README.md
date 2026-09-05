# SEPA Payment QR

Turn bank-transfer details, a bill, or any link into a **scan-to-pay QR code**.
Point Revolut, SEB, Swedbank, N26, Wise — any bank app that reads the European
**EPC069-12** standard (*SEPA Credit Transfer QR* / *GiroCode*) — at the code and
it auto-fills the payment. No manual IBAN typing. Runs entirely in your browser.

### ▶ Live: https://paulius11.github.io/sepa-payment-qr/

## Features

- **Payment QR** — fill name + IBAN (amount, message optional) → scannable EPC069-12 code. One encoder works for every SEPA bank.
- **Pay a bill** — paste a bill's text or drop a `.txt`/PDF onto the box; it pulls out the IBAN (checksum-validated), amount, reference and payee. If the bill lists several accounts, pick yours.
- **Link / text mode** — encode any URL or text (e.g. a `revolut.me` tip link) as a QR in the same styles.
- **Styling** — module shapes (rounded / dots / square), styled finder eyes, brand colour or gradient, and an optional centre **logo**. Presets: Classic, Beautiful, Mono, Dots, Vivid. Every style stays scannable.
- **Saved payees** — save a recurring payment and reload it later; just change the amount.
- **Shareable link** — copy a link that reopens the app pre-filled (data lives in the URL hash, never sent to a server).
- **Privacy** — 100% client-side. Nothing you type leaves the page.
- **WebMCP** — exposes agent-callable tools (`fill_payment`, `parse_bill`, `get_payment`, `read_bill_document`, `make_link_qr`) so a browser AI agent can read a bill and fill the payment.

## Use it

Open the [live app](https://paulius11.github.io/sepa-payment-qr/), fill **name +
IBAN** (or paste a bill), then scan the QR with your bank app — it prefills the
transfer; you confirm and send. **Download PNG** to print/share.

Run locally (static, no build):

```
git clone https://github.com/Paulius11/sepa-payment-qr
cd sepa-payment-qr/app && python3 -m http.server 8000   # http://localhost:8000
```

Serving over http (not `file://`) is needed for reading PDF bills — pdf.js loads
a worker.

## How the payment QR works

Payments use **EPC069-12**, the one published standard EU bank apps scan (there is
no per-bank format). The payload is LF-separated fields — service tag `BCD`,
version, UTF-8 charset, `SCT`, optional BIC, beneficiary name, IBAN, `EUR` amount,
purpose, remittance/reference. Euro only; whole payload ≤ 331 bytes. The IBAN is
validated by ISO 7064 mod-97, and UTF-8 keeps accented names intact.

Refs: [EPC guidance](https://www.europeanpaymentscouncil.eu/document-library/guidance-documents/quick-response-code-guidelines-enable-data-capture-initiation)
· [Wikipedia](https://en.wikipedia.org/wiki/EPC_QR_code)

## Notes

Not affiliated with any bank. This generates a payment *request* QR only — it
never moves money; you always confirm the transfer in your own bank app. Always
check the details before paying, especially for auto-filled bills.

Built with vanilla JS. Vendored: [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)
(MIT) and [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0).
