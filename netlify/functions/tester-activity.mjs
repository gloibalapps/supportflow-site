// Privacy-safe Early Access activity endpoint.
// Stores tester/app telemetry only — never participant names, NDIS numbers,
// note text, invoice contents, addresses, amounts, or other client records.
const ALLOWED = new Set(["app_opened", "section_shifts", "section_notes", "section_travel", "section_invoices", "section_expenses", "section_tax", "section_help","section_incidents", "shift_created", "trip_created", "invoice_created", "expense_created", "note_created", "feedback_submitted","incident_created"]);
const json = (body, status=200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type":"application/json", "Cache-Control":"no-store" } });
export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status:405 });
  const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return json({ok:false,error:"unconfigured"},503);
  let b; try { b=await req.json(); } catch { return json({ok:false,error:"bad_request"},400); }
  const deviceRef=String(b?.deviceRef||"").slice(0,200);
  const event=String(b?.event||"");
  const appVersion=String(b?.appVersion||"").slice(0,40);
  const deviceType=String(b?.deviceType||"").slice(0,30);
  if (!deviceRef || !ALLOWED.has(event)) return json({ok:false,error:"invalid"},400);
  const h={apikey:key,Authorization:`Bearer ${key}`,"Content-Type":"application/json",Prefer:"return=minimal"};
  const c=await fetch(`${url}/rest/v1/early_access_codes?device_ref=eq.${encodeURIComponent(deviceRef)}&status=eq.claimed&select=code&limit=1`,{headers:h});
  if (!c.ok) return json({ok:false,error:"lookup_failed"},500);
  const codes=await c.json(); if (!codes?.[0]) return json({ok:true,tracked:false});
  const r=await fetch(`${url}/rest/v1/tester_activity_events`,{method:"POST",headers:h,body:JSON.stringify({
    device_ref:deviceRef, access_code:codes[0].code, event_name:event,
    app_version:appVersion, device_type:deviceType
  })});
  if (!r.ok) return json({ok:false,error:"write_failed"},500);
  return json({ok:true,tracked:true});
};