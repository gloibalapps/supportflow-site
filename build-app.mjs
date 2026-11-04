// Build step for the app shell. Usage: node build-app.mjs
//  1. Copies payment-tracker-rules.js (the shared tracker rules, also used by
//     the Netlify functions) into app.jsx between the @@TRACKER_RULES markers,
//     without its `export` keywords (app.jsx is a classic in-browser script).
//  2. Re-inlines app.jsx into app.html's <script id="appsrc"> block
//     (README: "paste app.jsx back into that block").
// Then syntax-check with: node build-app.mjs --check  (needs @babel/core + @babel/preset-react resolvable)
import fs from "node:fs";

const START = "/* @@TRACKER_RULES_START */", END = "/* @@TRACKER_RULES_END */";
let src = fs.readFileSync("app.jsx", "utf8");
const a0 = src.indexOf(START), b0 = src.indexOf(END);
if (a0 < 0 || b0 < a0) throw new Error("tracker rules markers not found in app.jsx");
const rules = fs.readFileSync("payment-tracker-rules.js", "utf8").replace(/^export\s+/gm, "").trim();
src = src.slice(0, a0 + START.length) + "\n" + rules + "\n" + src.slice(b0);
fs.writeFileSync("app.jsx", src);

const html = fs.readFileSync("app.html", "utf8");
const open = '<script id="appsrc" type="text/plain">\n';
const a = html.indexOf(open);
if (a < 0) throw new Error("appsrc block not found");
const b = html.indexOf("</script>", a + open.length);
if (/<\/script/i.test(src)) throw new Error("app.jsx must not contain </script");
const out = html.slice(0, a + open.length) + src.replace(/\n?$/, "\n") + html.slice(b);
fs.writeFileSync("app.html", out);
console.log("app.html rebuilt:", out.split("\n").length, "lines");

if (process.argv.includes("--check")) {
  const { createRequire } = await import("node:module");
  const req = createRequire(process.env.BABEL_FROM || import.meta.url);
  const babel = req("@babel/core");
  babel.transformSync(src, { presets: [req.resolve("@babel/preset-react")], filename: "app.jsx", compact: true });
  console.log("app.jsx JSX syntax OK");
}
