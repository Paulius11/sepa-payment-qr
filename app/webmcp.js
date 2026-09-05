// WebMCP tool layer for SEPA Payment QR.
// Exposes the payment form as agent-callable tools so a browser agent (Chrome
// WebMCP origin trial / ChatGPT) can fill and read the payment QR directly —
// in particular, read a bill it uploaded (PDF/photo we can't OCR offline) and
// call fill_payment. Loaded AFTER app.js, so it shares app.js's global scope
// (fillFields, extractAndFill, paymentSnapshot, billDoc, els, EPC).
//
// Spec target: document.modelContext.registerTool (Chrome imperative API).
// Feature-detected; if WebMCP is absent the page works exactly as before.

(function () {
  const mc =
    (typeof document !== "undefined" && document.modelContext) ||
    (typeof navigator !== "undefined" && navigator.modelContext) ||
    null;
  if (!mc || typeof mc.registerTool !== "function") {
    console.info("[webmcp] no WebMCP host — tools not registered (UI unaffected)");
    return;
  }

  const ok = (obj) => JSON.stringify(obj);
  const err = (msg) => JSON.stringify({ error: msg });

  mc.registerTool({
    name: "fill_payment",
    description:
      "Fill the SEPA payment form and generate the scan-to-pay QR (EPC069-12). " +
      "Amounts are euro. Use this after reading a bill to set the payee, IBAN, " +
      "amount and reference. Returns the EPC payload and any validation errors.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Beneficiary / payee name (max 70 chars)" },
        iban: { type: "string", description: "Beneficiary IBAN" },
        amount: { type: "number", description: "Amount in EUR (optional; 0.01–999999999.99)" },
        message: { type: "string", description: "Payment reference / remittance (max 140 chars)" },
        bic: { type: "string", description: "Beneficiary BIC/SWIFT (optional)" },
        purpose: { type: "string", description: "4-char purpose code (optional)" },
      },
      required: ["name", "iban"],
    },
    execute: async (input) => {
      fillFields(input);
      const snap = paymentSnapshot();
      if (!snap.valid) {
        return err(
          "Payment not valid: " +
          (snap.tooLong ? "payload exceeds 331 bytes." : JSON.stringify(snap.errors))
        );
      }
      return ok({ filled: snap.fields, payload: snap.payload, bytes: snap.bytes });
    },
  });

  mc.registerTool({
    name: "parse_bill",
    description:
      "Extract payment details (IBAN, amount, reference, payee) from a bill's " +
      "plain text and fill the form. Pass the text of an invoice/bill you have " +
      "read or OCR'd. Returns what was extracted; verify the IBAN and amount.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "Full plain text of the bill/invoice" } },
      required: ["text"],
    },
    execute: async (input) => {
      if (!input.text || !input.text.trim()) return err("Provide the bill text.");
      const r = extractAndFill(input.text);
      const snap = paymentSnapshot();
      return ok({ extracted: { name: r.name, iban: r.iban, amount: r.amount, message: r.message }, found: r.found, valid: snap.valid, payload: snap.payload });
    },
  });

  mc.registerTool({
    name: "get_payment",
    description:
      "Return the current payment form state: normalised fields, whether it is a " +
      "valid EPC payment, the raw EPC payload, and the QR as a PNG data URL. Does " +
      "not change anything.",
    inputSchema: { type: "object", properties: {} },
    execute: async () => ok(paymentSnapshot()),
  });

  mc.registerTool({
    name: "read_bill_document",
    description:
      "Return the last uploaded bill document so you can read it: its mime type, " +
      "file name, extracted text (for .txt) or a base64 data URL (for a PDF/image " +
      "this page could not OCR offline). Read it, then call fill_payment.",
    inputSchema: { type: "object", properties: {} },
    execute: async () => {
      if (!billDoc) return err("No bill uploaded yet. Ask the user to upload one, or call parse_bill with text.");
      return ok({ mime: billDoc.mime, name: billDoc.name, text: billDoc.text || null, dataUrl: billDoc.dataUrl || null });
    },
  });

  mc.registerTool({
    name: "make_link_qr",
    description:
      "Switch to Link/Text mode and encode any URL or text as a styled QR code " +
      "(not a payment) — e.g. a revolut.me tip link, a form, or a video URL. " +
      "Returns the encoded text and its byte size.",
    inputSchema: {
      type: "object",
      properties: { text: { type: "string", description: "URL or text to encode" } },
      required: ["text"],
    },
    execute: async (input) => {
      if (!input.text || !input.text.trim()) return err("Provide a URL or text.");
      setMode("link");
      els.linktext.value = input.text.trim();
      build();
      const encoded = els.payload.textContent;
      if (!encoded) return err("Could not encode (too long?).");
      return ok({ encoded, bytes: EPC.utf8Len(encoded) });
    },
  });

  console.info("[webmcp] registered 5 tools: fill_payment, parse_bill, get_payment, read_bill_document, make_link_qr");
})();
