export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supaUrl = process.env.SUPABASE_URL;
  const supaKey = process.env.SUPABASE_SERVICE_KEY;
  if (!supaUrl || !supaKey) {
    return new Response(JSON.stringify({ error: "Feedback isn't fully configured on this site yet." }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Malformed request." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const message = body?.message ? String(body.message).slice(0, 4000).trim() : "";
  if (!message) {
    return new Response(JSON.stringify({ error: "Message is required." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const row = {
    name: body?.name ? String(body.name).slice(0, 200) : null,
    email: body?.email ? String(body.email).slice(0, 200) : null,
    phone: body?.phone ? String(body.phone).slice(0, 60) : null,
    device_ref: body?.deviceRef ? String(body.deviceRef).slice(0, 200) : null,
    app_version: body?.appVersion ? String(body.appVersion).slice(0, 40) : null,
    message,
    screen: body?.screen ? String(body.screen).slice(0, 60) : null,
    browser: body?.browser ? String(body.browser).slice(0, 400) : null,
    record_counts: body?.recordCounts ? String(body.recordCounts).slice(0, 400) : null,
  };

  try {
    const resp = await fetch(`${supaUrl}/rest/v1/feedback`, {
      method: "POST",
      headers: {
        apikey: supaKey,
        Authorization: `Bearer ${supaKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(row),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      throw new Error(detail);
    }
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: "server_error", detail: String(e?.message || e) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
