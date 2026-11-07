// Public OAuth for Dropbox and OneDrive backups. Exchanges a PKCE code, or
// refreshes a token, using only the public client id. No client secret.
// The backup file and the backup password never come through here.

const DROPBOX_SCOPES = "files.content.read files.content.write files.metadata.read";
const ONEDRIVE_SCOPES = "offline_access Files.ReadWrite.AppFolder";

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

function sameOrigin(req) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host) return true;
  try { return new URL(origin).host === host; } catch { return false; }
}

function clientId(provider) {
  if (provider === "dropbox") return process.env.DROPBOX_CLIENT_ID || "";
  if (provider === "onedrive") return process.env.ONEDRIVE_CLIENT_ID || process.env.MICROSOFT_CLIENT_ID || "";
  return "";
}

function redirectOk(req, redirectUri) {
  let url;
  try { url = new URL(redirectUri); } catch { return false; }
  const host = req.headers.get("host") || "";
  if (url.host !== host) return false;
  if (url.pathname !== "/oauth-callback.html") return false;
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !local) return false;
  return true;
}

function form(obj) {
  return Object.entries(obj).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
}

async function tokenRequest(provider, body) {
  const url = provider === "dropbox"
    ? "https://api.dropboxapi.com/oauth2/token"
    : "https://login.microsoftonline.com/common/oauth2/v2.0/token";
  const resp = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form(body),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || !data.access_token) {
    console.error(`backup-oauth: ${provider} token ${resp.status}`);
    return null;
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || "",
    expiresIn: Number(data.expires_in) || 3600,
  };
}

export default async (req) => {
  if (!sameOrigin(req)) return json({ error: "forbidden" }, 403);
  if (req.method === "GET") {
    return json({
      dropboxClientId: clientId("dropbox"),
      onedriveClientId: clientId("onedrive"),
      dropboxScopes: DROPBOX_SCOPES,
      onedriveScopes: ONEDRIVE_SCOPES,
    });
  }
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: "Malformed request." }, 400); }
  const provider = body?.provider === "onedrive" ? "onedrive" : body?.provider === "dropbox" ? "dropbox" : "";
  if (!provider) return json({ error: "Unknown backup provider." }, 400);
  const id = clientId(provider);
  if (!id) return json({ error: "not_configured" }, 503);
  const grant = body?.grant === "refresh" ? "refresh" : "code";
  try {
    if (grant === "refresh") {
      const refreshToken = String(body?.refreshToken || "");
      if (!refreshToken || refreshToken.length > 4000) return json({ error: "Missing refresh." }, 400);
      const token = await tokenRequest(provider, {
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: id,
        scope: provider === "onedrive" ? ONEDRIVE_SCOPES : undefined,
      });
      if (!token) return json({ error: "Couldn't refresh the connection." }, 502);
      if (!token.refreshToken) token.refreshToken = refreshToken;
      return json(token);
    }
    const redirectUri = String(body?.redirectUri || "");
    const code = String(body?.code || "");
    const verifier = String(body?.codeVerifier || "");
    if (!redirectOk(req, redirectUri)) return json({ error: "Redirect not allowed." }, 400);
    if (!code || code.length > 2000 || !verifier || verifier.length > 200) return json({ error: "Missing code." }, 400);
    const token = await tokenRequest(provider, {
      grant_type: "authorization_code",
      code,
      client_id: id,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      scope: provider === "onedrive" ? ONEDRIVE_SCOPES : undefined,
    });
    if (!token) return json({ error: "Couldn't finish sign-in." }, 502);
    return json(token);
  } catch (e) {
    console.error("backup-oauth: request failed");
    return json({ error: "Couldn't reach the backup provider." }, 502);
  }
};

export { DROPBOX_SCOPES, ONEDRIVE_SCOPES };
