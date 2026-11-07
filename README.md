# SupportFlow™ — PWA test build

Installable web app. Splash page at `index.html`, the app itself at `app.html`.

## Files

| File | What it is |
|---|---|
| `index.html` | Splash and pricing page, with the install prompt |
| `app.html` | App shell — loads React and mounts the app |
| `app.jsx` | The app source — edit this, then re-inline it into `app.html` |
| `manifest.webmanifest` | Name, icons, colours, install behaviour |
| `sw.js` | Service worker — offline caching |
| `icon-*.png` | Icons, including a maskable one for Android |
| `LICENSING.md` | Owner guide to the one-off device licence (off until you switch it on) |

## Getting it online

A PWA **will not install over `file://` or plain `http://`**. It needs HTTPS
(or `localhost` for local testing). Any static host works — no build step, no
server code.

**Netlify Drop** — drag this folder onto https://app.netlify.com/drop. Live in
about ten seconds, HTTPS included. Easiest option for testers.

**GitHub Pages** — push the folder to a repo, then Settings → Pages → deploy
from branch.

**Cloudflare Pages / Vercel** — connect the repo, no framework preset, publish
directory is this folder.

**Locally, on your own machine:**

```bash
cd pwa
python3 -m http.server 8000
```

Then open `http://localhost:8000`. Service workers are permitted on localhost.

## Installing it

**Android / Chrome / Edge** — an install bar appears on the splash a couple of
seconds after load, or use the browser menu → *Install app*.

**iPhone / iPad** — iOS has no install prompt. Tap **Share**, then **Add to Home
Screen**. The splash detects iOS and says so.

**Desktop Chrome / Edge** — install icon in the address bar.

Once installed it opens without browser chrome, keeps its own icon, and runs
offline after the first successful load.

## What testers should try

1. Complete the three-step setup — your details, a plan manager, a participant.
2. Raise an invoice and generate the PDF.
3. Log a trip, then start a new invoice for that participant and attach it.
4. Turn on flight mode and reopen the app. It should still work.
5. Settings → Backup, then Restore, to confirm records survive.

## Known limitations in this build

- **Data lives on the device**, in that browser's storage. Clearing site data
  or deleting the app removes it. Back up from Settings. There is no account
  and no sync.
- **First load needs a connection** to fetch React. After that it runs offline.
  The first load also transpiles the app in the browser, which takes a moment
  on an older phone.
- **The two AI features need an API key.** See below.
- **Prices and rules** come from the NDIS Pricing Schedule 2026-27 and the
  2025-26 Pricing Arrangements. Verify before relying on them commercially.
- **Not tax or legal advice.** Records and arithmetic only.

## Updating the app

The app source is **inlined inside `app.html`** — in the `<script id="appsrc">`
block — so the page makes no second request that could fail. `app.jsx` is kept
as the readable copy for editing.

After editing `app.jsx`, paste its contents back into that block in `app.html`,
then bump `CACHE` in `sw.js` (e.g. `supportflow-v305`) and redeploy. Without the
bump, installed testers keep the cached old version.

**Unzip before uploading.** Netlify Drop wants the folder itself, with
`index.html` at the top level.


---

## Switching on the AI features

Two features use a language model: the **deduction checker** (Summary →
Claimable), which searches the ATO and cites the pages it used, and the
**note tidier** in shift notes.

They call `netlify/functions/assist.mjs`, a small server-side function. The API
key lives there as an environment variable and never reaches the browser — if
it sat in the app, anyone could open the page and spend your credit.

### Setting it up

2. In Netlify: **Site configuration → Environment variables → Add a variable**
   - Key: `ANTHROPIC_API_KEY`
   - Value: your key
   - Scope: leave as all
3. **Redeploy.** Environment variables are read at deploy time, so an existing
   deploy won't pick it up.
4. Open the app → Summary → Claimable, and ask something like "steel cap boots".

Optionally set `ASSIST_MODEL` to change the model. It defaults to

### If it doesn't work

- *"The checker isn't switched on for this site yet"* — the key isn't set, or
  the site hasn't been redeployed since you set it.
- Nothing happens at all — check **Netlify → Functions → assist** for logs.
- Deploying by drag-and-drop? Functions need the `netlify/functions` folder to
  be inside what you upload. It's in this package; don't unzip selectively.

### Cost and abuse

Each deduction check is one model call plus a web search, so a few cents at
most. The note tidier is cheaper.

**The endpoint is public.** The function limits requests to POST, caps the
prompt length, and rejects cross-origin calls, which stops casual misuse — but
someone determined could still call it. Watch your API usage for the first
delete the `ANTHROPIC_API_KEY` variable and redeploy: the app carries on
working, with both AI features cleanly switched off.

### Turning them off

Empty the `endpoint` string in the `AI` block near the top of `app.jsx` (and
re-inline it into `app.html`). Both features hide themselves — the Claimable tab
shows ATO links instead, and the tidy button disappears.


## Early Access tester activity

Before deploying build 257, run `EARLY-ACCESS-TESTER-MIGRATION.sql` once in the existing Supabase project. The tester system uses the existing `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, and `RESEND_API_KEY` Netlify environment variables. Optional `AUTO_RELEASE_TESTER_SPOTS=true` enables automatic recycling after 10 inactive days; leave it unset/false initially to mark testers release-eligible without automatically recycling their code. The daily lifecycle function runs at 02:15 UTC.

## Cloud backup (Google Drive, Dropbox, OneDrive)

Backups are encrypted on the device (AES-256) before upload. The backup password and the recovery key are not sent to SupportFlow or to the storage provider. The user chooses one provider. Disconnect does not delete files already stored.

- **Google Drive.** Set `GOOGLE_CLIENT_ID` in Netlify to the OAuth 2.0 Web application Client ID. Enable the Google Drive API and add `https://supportflow.work` as an Authorized JavaScript origin. Scope: `https://www.googleapis.com/auth/drive.file`.
- **Dropbox.** Set `DROPBOX_CLIENT_ID` to the app key (public). Create the app with **App folder** access, not Full Dropbox. Scopes: `files.content.read`, `files.content.write`, `files.metadata.read`. Redirect URI: `https://supportflow.work/oauth-callback.html`.
- **OneDrive.** Set `ONEDRIVE_CLIENT_ID` (or `MICROSOFT_CLIENT_ID`) to the Application (client) ID. Do not put a client secret in the app. Scopes: `offline_access` and `Files.ReadWrite.AppFolder`. Redirect URI: `https://supportflow.work/oauth-callback.html`, registered as a **Single-page application** platform. Supported account types must include personal Microsoft accounts. Production stays off until the owner registers the app and sets the env var.

No client secrets are committed. Token exchange is PKCE through `/.netlify/functions/backup-oauth`.


---

**SupportFlow™** · © 2026 SupportFlow. All rights reserved.

SupportFlow is an independent software product and is not affiliated with, endorsed by, or operated by the NDIA or NDIS.


**Domain transition:** All new-user links use `supportflow.work`. The former domain remains only for existing-user compatibility/redirects during transition.

## Device licensing (off by default)

One-off A$49 "One device" / A$69 "Phone and computer" licences tied to a
Google account, behind an owner switch. Nothing changes for anyone until the
switch is turned on. Setup, testing and the exact steps to turn it on are in
[`LICENSING.md`](LICENSING.md).
