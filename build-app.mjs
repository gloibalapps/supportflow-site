// Re-inlines app.jsx into app.html's <script id="appsrc"> block and syntax-checks it.
// Usage: node build-app.mjs   (README: "paste app.jsx back into that block")
import fs from "node:fs";
const html = fs.readFileSync("app.html", "utf8");
const src = fs.readFileSync("app.jsx", "utf8");
const open = '<script id="appsrc" type="text/plain">\n';
const a = html.indexOf(open);
if (a < 0) throw new Error("appsrc block not found");
const b = html.indexOf("</script>", a + open.length);
if (src.includes("</script")) throw new Error("app.jsx must not contain </script");
const out = html.slice(0, a + open.length) + src.replace(/\n?$/, "\n") + html.slice(b);
fs.writeFileSync("app.html", out);
console.log("app.html rebuilt:", out.split("\n").length, "lines");
