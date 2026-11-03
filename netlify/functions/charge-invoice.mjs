// Called by the app BEFORE showing an invoice preview.
// Rule: 1 credit on the FIRST preview of a new invoice number; re-previews and
// edits of the same invoice number are free. Enforced atomically by the
// charge_invoice_credit RPC in CREDIT-PACKS-MIGRATION.sql.
//
// Set in Netlify: Site configuration → Environment variables
//   SUPABASE_URL          same as stripe-webhook.mjs
//   SUPABASE_SERVICE_KEY  same as stripe-webhook.mjs (never sent to the browser)
//
// POST { clientReferenceId, invoiceNumber }
//   200 { charged: true, creditsRemaining: N }          new invoice number, credit spent
//   200 { charged: false, reason: "already_charged" }    free re-preview, show it
//   402 { error: "...", creditsRemaining: 0 }            block: don't generate/show
//   400 / 405 / 500 / 503 { error }

import { checkRequestLicence } from "../lib/licence.mjs";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

  const clientReferenceId = typeof body?.clientReferenceId === "string" ? body.clientReferenceId.trim() : "";
  const invoiceNumber = typeof body?.invoiceNumber === "string" ? body.invoiceNumber.trim() : "";
  if (!clientReferenceId || !invoiceNumber) {
    return json({ error: "clientReferenceId and invoiceNumber are required" }, 400);
  }
  if (clientReferenceId.length > 200 || invoiceNumber.length > 100) {
    return json({ error: "Field too long" }, 400);
  }

  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) return json({ error: "Billing not configured" }, 503);

  // Device licence holders (One device / Phone and computer) invoice without
  // credits. Checked server-side against the licence + active device list.
  if (req.headers.get("x-sf-licence")) {
    const lic = await checkRequestLicence(req, body).catch(() => null);
    if (lic?.ok) return json({ charged: false, reason: "licensed" });
  }

  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/charge_invoice_credit`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ p_account_id: clientReferenceId, p_invoice_number: invoiceNumber }),
    });
    if (!resp.ok) throw new Error(`Supabase ${resp.status}`);
    const result = await resp.json();

    if (result?.charged === true) {
      return json({ charged: true, creditsRemaining: Number(result.credits_remaining) || 0 });
    }
    if (result?.reason === "already_charged") {
      return json({ charged: false, reason: "already_charged" });
    }
    if (result?.reason === "no_credits") {
      return json({ error: "No credits remaining. Purchase a credit pack to continue invoicing.", creditsRemaining: 0 }, 402);
    }
    throw new Error("Unexpected RPC result");
  } catch (err) {
    console.error("charge-invoice failed:", err.message);
    // Fail closed: don't hand out a new invoice number we couldn't charge for.
    return json({ error: "Couldn't confirm credits. Please try again." }, 500);
  }
};
