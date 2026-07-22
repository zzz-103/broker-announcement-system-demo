import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const outputRoot = resolve(projectRoot, "out");
const port = Number(process.env.PORT || 3000);
const contentTypes = { ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".csv": "text/csv; charset=utf-8" };

if (!existsSync(outputRoot)) {
  console.error("out/ not found. Run pnpm build first.");
  process.exit(1);
}

createServer((request, response) => {
  const pathname = decodeURIComponent((request.url || "/").split("?")[0]);
  const relative = normalize(pathname).replace(/^([/\\])+/, "");
  const requested = join(outputRoot, relative);
  const candidates = [requested, pathname.endsWith("/") ? join(requested, "index.html") : requested + ".html", join(requested, "index.html")];
  const filePath = candidates.find((candidate) => {
    try { return statSync(candidate).isFile(); } catch { return false; }
  });
  if (!filePath) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, { "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream", "Cache-Control": "no-cache" });
  createReadStream(filePath).pipe(response);
}).listen(port, "0.0.0.0", () => {
  console.log("Static Coze demo listening on http://localhost:" + port);
});
