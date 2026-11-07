import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword, normaliseAccountEmail, passwordOk } from "../netlify/lib/password-account.mjs";
import backupOauth, { DROPBOX_SCOPES, ONEDRIVE_SCOPES } from "../netlify/functions/backup-oauth.mjs";

test("password hash verifies and is not the password", async () => {
  const hash = await hashPassword("a-long-secret-phrase");
  assert.equal(hash.includes("a-long-secret-phrase"), false);
  assert.match(hash, /^scrypt\$/);
  assert.equal(await verifyPassword("a-long-secret-phrase", hash), true);
  assert.equal(await verifyPassword("wrong-secret-phrase", hash), false);
  assert.equal(normaliseAccountEmail("  Ada@Example.com "), "ada@example.com");
  assert.equal(passwordOk("short"), false);
  assert.equal(passwordOk("long-enough-password"), true);
});

test("backup oauth exchanges PKCE codes without a client secret and rejects a foreign redirect", async () => {
  process.env.DROPBOX_CLIENT_ID = "dbx_public";
  process.env.ONEDRIVE_CLIENT_ID = "ms_public";
  delete process.env.MICROSOFT_CLIENT_ID;
  const calls = [];
  const previous = globalThis.fetch;
  globalThis.fetch = async (url, opt = {}) => {
    calls.push({ url: String(url), body: String(opt.body || "") });
    assert.equal(String(opt.body || "").includes("client_secret"), false);
    return new Response(JSON.stringify({ access_token: "tok", refresh_token: "ref", expires_in: 3600 }), { status: 200 });
  };
  try {
    const fn = backupOauth;
    const bad = await fn(new Request("https://sf.test/.netlify/functions/backup-oauth", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: "https://sf.test", host: "sf.test" },
      body: JSON.stringify({ provider: "onedrive", grant: "code", code: "abc", codeVerifier: "ver", redirectUri: "https://evil.test/oauth-callback.html" }),
    }));
    assert.equal(bad.status, 400);
    const ok = await fn(new Request("https://sf.test/.netlify/functions/backup-oauth", {
      method: "POST",
      headers: { "Content-Type": "application/json", origin: "https://sf.test", host: "sf.test" },
      body: JSON.stringify({ provider: "dropbox", grant: "code", code: "abc", codeVerifier: "ver", redirectUri: "https://sf.test/oauth-callback.html" }),
    }));
    assert.equal(ok.status, 200);
    const body = await ok.json();
    assert.equal(body.accessToken, "tok");
    assert.match(calls[0].url, /dropboxapi/);
    assert.match(calls[0].body, /code_verifier=ver/);
    assert.equal(ONEDRIVE_SCOPES, "offline_access Files.ReadWrite.AppFolder");
    assert.match(DROPBOX_SCOPES, /files\.content\.write/);
  } finally {
    globalThis.fetch = previous;
  }
});
