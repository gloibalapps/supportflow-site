export default async () => {
  const clientId = process.env.MICROSOFT_CLIENT_ID || "";
  if (!clientId) return new Response(JSON.stringify({ error: "not_configured" }), { status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  return new Response(JSON.stringify({ clientId }), { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
};
