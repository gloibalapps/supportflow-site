// Minimal local server: static files + /.netlify/functions/<name> (v2 default-export handlers).
// Usage: STATS_FIXTURE=... ADMIN_DASHBOARD_TOKEN=... node preview/dev-server.mjs
import http from "node:http"; import fs from "node:fs"; import path from "node:path";
const root = path.resolve(new URL("..", import.meta.url).pathname), port = process.env.PORT || 8888;
const types = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".svg": "image/svg+xml", ".json": "application/json", ".webmanifest": "application/manifest+json" };
http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const fn = u.pathname.match(/^\/\.netlify\/functions\/([\w-]+)$/);
  if (fn) {
    const mod = await import(path.join(root, "netlify/functions", fn[1] + ".mjs"));
    const r = await mod.default(new Request("http://localhost" + req.url, { method: req.method, headers: req.headers }));
    res.writeHead(r.status, Object.fromEntries(r.headers)); return res.end(await r.text());
  }
  const pathName = u.pathname;
  if (pathName === "/admin/dashboard" || pathName === "/admin/dashboard.html" || pathName === "/admin/dasboard") {
    res.writeHead(301, { Location: "/admin" + u.search }); return res.end();
  }
  let p = pathName === "/" ? "/index.html" : pathName === "/admin" ? "/admin.html" : pathName;
  const f = path.join(root, p);
  if (!f.startsWith(root) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end("404"); }
  res.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(port, () => console.log("http://localhost:" + port));
